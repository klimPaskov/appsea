import { randomUUID } from 'node:crypto'
import { isProductionConnectorSourceId } from '@appsea/connectors'
import {
  productionCollectionWorkflowStartRequestSchema,
  type MaintenanceSchedulerFence,
  type ResearchCampaignOrchestrationFailureCode
} from '@appsea/contracts'
import {
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError,
  type PostgresProductionWorkflowAdmissionRepository,
  type PostgresResearchCampaignOrchestrationRepository,
  type PostgresSourcePolicyRepository,
  type ResearchCampaignOrchestrationClaim,
  type ResearchCampaignOrchestrationFailure
} from '@appsea/db'
import { campaignSourceIdempotencyKey } from '@appsea/db/research-campaign-orchestration'
import { prepareProductionCollectionWorkflowStart } from '@appsea/workflows'

const maximumOrchestrationBatch = 100

export interface CampaignOrchestrationInput {
  batchSize: number
  claimOwner: string
  claimLeaseSeconds: number
  retryAfterSeconds: number
  occurredAt: string
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
}

export interface CampaignOrchestrationDependencies {
  orchestrations: Pick<
    PostgresResearchCampaignOrchestrationRepository,
    | 'listWorkspaceIdsForService'
    | 'listActiveOrchestrationIdsForService'
    | 'claimNextSourceForService'
    | 'markSourceDispatchedForService'
    | 'markSourceFailedForService'
    | 'reconcileForService'
  > &
    Partial<
      Pick<
        PostgresResearchCampaignOrchestrationRepository,
        'listCancellationTargetsForService' | 'prepareCancellationForService'
      >
    >
  policies: Pick<PostgresSourcePolicyRepository, 'readCollectible'>
  admission: Pick<PostgresProductionWorkflowAdmissionRepository, 'admitForService'>
  startWorkflow: (
    request: ReturnType<typeof productionCollectionWorkflowStartRequestSchema.parse>
  ) => Promise<{ workflowId: string }>
  /** Best-effort external cancellation; the durable request remains for retry. */
  cancelWorkflow?: (workflowId: string) => Promise<void>
}

export interface CampaignOrchestrationResult {
  workspacesScanned: number
  claims: number
  dispatched: number
  failed: number
  policyDenied: number
  reconciled: number
}

function safeFailureSummary(code: ResearchCampaignOrchestrationFailureCode): string {
  switch (code) {
    case 'source_policy_denied':
      return 'The current source policy is not approved for this campaign.'
    case 'source_unsupported':
      return 'The configured source has no enabled worker connector.'
    case 'input_invalid':
      return 'The persisted source request failed validation.'
    case 'admission_rate_limited':
      return 'The workspace collection admission rate limit delayed this source.'
    case 'admission_concurrency_limited':
      return 'The workspace collection concurrency limit delayed this source.'
    case 'temporal_unavailable':
      return 'The durable workflow service was unavailable; this source will retry.'
    case 'dispatch_failed':
      return 'The source workflow dispatch failed; this source will retry.'
    case 'attempts_exhausted':
      return 'The source dispatch exhausted its bounded retry limit.'
    case 'child_failed':
      return 'The source collection workflow reached a terminal failure.'
    case 'canceled':
      return 'The source collection was canceled.'
  }
}

function retrySeconds(error: unknown, fallback: number): number {
  if (
    error instanceof ProductionWorkflowRateLimitError ||
    error instanceof ProductionWorkflowConcurrencyLimitError
  ) {
    return Math.max(1, Math.min(86_400, error.retryAfterSeconds))
  }
  return fallback
}

function failureCode(error: unknown): ResearchCampaignOrchestrationFailureCode {
  if (error instanceof ProductionWorkflowRateLimitError) return 'admission_rate_limited'
  if (error instanceof ProductionWorkflowConcurrencyLimitError) {
    return 'admission_concurrency_limited'
  }
  if (
    error instanceof Error &&
    ['TemporalServiceError', 'ServiceError', 'TransportError', 'ConnectionError'].includes(
      error.name
    )
  ) {
    return 'temporal_unavailable'
  }
  if (error instanceof Error && error.name === 'ResearchCampaignOrchestrationPolicyDeniedError') {
    return 'source_policy_denied'
  }
  if (
    error instanceof Error &&
    error.name === 'ResearchCampaignOrchestrationSourceUnsupportedError'
  ) {
    return 'source_unsupported'
  }
  if (
    error instanceof Error &&
    (error.name === 'ZodError' || error.message.includes('source request'))
  ) {
    return 'input_invalid'
  }
  return 'dispatch_failed'
}

function terminalFor(
  code: ResearchCampaignOrchestrationFailureCode,
  attemptCount: number
): boolean {
  if (['source_policy_denied', 'source_unsupported', 'input_invalid', 'canceled'].includes(code)) {
    return true
  }
  return attemptCount >= 10
}

function policyDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResearchCampaignOrchestrationPolicyDeniedError'
}

function sourceRequest(claim: ResearchCampaignOrchestrationClaim, policyVersion: string) {
  const limit = Math.min(claim.configuration.maxEvidenceCount, claim.budget.maxSourceItems, 5_000)
  if (limit < 1) throw new Error('The campaign budget does not permit any source items')
  return productionCollectionWorkflowStartRequestSchema.parse({
    workspaceId: claim.workspaceId,
    campaignId: claim.campaignId,
    runId: claim.childRunId,
    idempotencyKey: campaignSourceIdempotencyKey(claim.orchestrationId, claim.sourceId),
    workflowVersion: 'production-collection-v1',
    sourceId: claim.sourceId,
    policyVersion,
    query: claim.configuration.query,
    limit,
    purpose: claim.purpose,
    requestedDisplayMode: claim.configuration.requestedDisplayMode,
    budget: claim.budget,
    requestedAt: claim.requestedAt,
    ...(claim.analysisSeedReviewId ? { analysisSeedReviewId: claim.analysisSeedReviewId } : {}),
    requestedBy: { actorType: 'service', actorId: 'appsea-worker' }
  })
}

export async function runCampaignOrchestration(
  input: CampaignOrchestrationInput,
  dependencies: CampaignOrchestrationDependencies
): Promise<CampaignOrchestrationResult> {
  if (
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 0 ||
    input.batchSize > maximumOrchestrationBatch
  ) {
    throw new Error('Campaign orchestration batch size must be an integer between 0 and 100')
  }
  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error('occurredAt is not a valid timestamp')
  }
  const assertLease = input.assertLease ?? (async () => undefined)
  const workspaceIds = [
    ...new Set(await dependencies.orchestrations.listWorkspaceIdsForService())
  ].sort()
  let claims = 0
  let dispatched = 0
  let failed = 0
  let policyDeniedCount = 0
  let reconciled = 0
  if (input.batchSize === 0) {
    return {
      workspacesScanned: workspaceIds.length,
      claims,
      dispatched,
      failed,
      policyDenied: 0,
      reconciled
    }
  }

  for (const workspaceId of workspaceIds) {
    const reconciledInWorkspace = new Set<string>()
    if (
      input.batchSize > 0 &&
      dependencies.orchestrations.listCancellationTargetsForService &&
      dependencies.orchestrations.prepareCancellationForService
    ) {
      const cancellationIds = await dependencies.orchestrations.listCancellationTargetsForService(
        workspaceId,
        Math.min(input.batchSize, maximumOrchestrationBatch)
      )
      for (const orchestrationId of cancellationIds) {
        if (reconciled >= maximumOrchestrationBatch) break
        await assertLease()
        const target = await dependencies.orchestrations.prepareCancellationForService(
          workspaceId,
          orchestrationId,
          input.fence
        )
        if (!target) continue
        if (dependencies.cancelWorkflow) {
          for (const workflowId of target.activeWorkflowIds) {
            await assertLease()
            try {
              await dependencies.cancelWorkflow(workflowId)
            } catch {
              // Keep the durable request pending. The next leased pass retries
              // the external cancellation without creating another run.
            }
          }
        }
        await assertLease()
        await dependencies.orchestrations.reconcileForService(
          workspaceId,
          orchestrationId,
          input.fence
        )
        reconciledInWorkspace.add(orchestrationId)
        reconciled += 1
      }
    }
    if (claims < input.batchSize) {
      await assertLease()
      const claimToken = `token:campaign-orchestration:${randomUUID()}`
      const claim = await dependencies.orchestrations.claimNextSourceForService(
        workspaceId,
        input.claimOwner,
        claimToken,
        input.claimLeaseSeconds,
        input.fence
      )
      if (claim) {
        claims += 1
        try {
          await assertLease()
          if (!isProductionConnectorSourceId(claim.sourceId)) {
            const error = new Error('The campaign source has no supported production connector')
            error.name = 'ResearchCampaignOrchestrationSourceUnsupportedError'
            throw error
          }
          const collectible = await dependencies.policies.readCollectible(claim.sourceId)
          if (!collectible || !isProductionConnectorSourceId(collectible.policy.sourceId)) {
            const error = new Error('The current source policy is not approved and collectible')
            error.name = 'ResearchCampaignOrchestrationPolicyDeniedError'
            throw error
          }
          if (!collectible.policy.permittedPurposes.includes(claim.purpose)) {
            const error = new Error('The source policy does not permit this campaign purpose')
            error.name = 'ResearchCampaignOrchestrationPolicyDeniedError'
            throw error
          }
          if (collectible.policy.displayMode !== claim.configuration.requestedDisplayMode) {
            const error = new Error('The source policy display mode does not permit this campaign')
            error.name = 'ResearchCampaignOrchestrationPolicyDeniedError'
            throw error
          }
          if (claim.policyVersion && claim.policyVersion !== collectible.policyVersion) {
            const error = new Error('The source policy changed while this child was dispatching')
            error.name = 'ResearchCampaignOrchestrationPolicyDeniedError'
            throw error
          }
          const request = sourceRequest(claim, collectible.policyVersion)
          const prepared = prepareProductionCollectionWorkflowStart(request)
          const handle = await dependencies.admission
            .admitForService({
              workspaceId: claim.workspaceId,
              idempotencyDigest: prepared.input.idempotencyDigest,
              inputHash: prepared.input.inputHash
            })
            .then(() => dependencies.startWorkflow(request))
          if (handle.workflowId !== prepared.workflowId) {
            throw new Error('The started source workflow conflicts with its durable child identity')
          }
          await dependencies.orchestrations.markSourceDispatchedForService({
            workspaceId: claim.workspaceId,
            orchestrationId: claim.orchestrationId,
            sourceId: claim.sourceId,
            childRunId: claim.childRunId,
            claimOwner: input.claimOwner,
            claimToken,
            workflowId: handle.workflowId,
            policyVersion: collectible.policyVersion,
            startedAt: new Date(Math.max(Date.now(), Date.parse(claim.requestedAt))).toISOString(),
            ...(input.fence ? { fence: input.fence } : {})
          })
          dispatched += 1
        } catch (error) {
          failed += 1
          if (policyDenied(error)) policyDeniedCount += 1
          const code = failureCode(error)
          const exhausted =
            !['source_policy_denied', 'source_unsupported', 'input_invalid', 'canceled'].includes(
              code
            ) && claim.attemptCount >= 10
          const persistedCode: ResearchCampaignOrchestrationFailureCode = exhausted
            ? 'attempts_exhausted'
            : code
          const failure: ResearchCampaignOrchestrationFailure = {
            workspaceId: claim.workspaceId,
            orchestrationId: claim.orchestrationId,
            sourceId: claim.sourceId,
            claimOwner: input.claimOwner,
            claimToken,
            failureCode: persistedCode,
            failureSummary: safeFailureSummary(persistedCode),
            retryAfterSeconds: retrySeconds(error, input.retryAfterSeconds),
            terminal: terminalFor(code, claim.attemptCount),
            ...(input.fence ? { fence: input.fence } : {})
          }
          try {
            await dependencies.orchestrations.markSourceFailedForService(failure)
          } catch (markError) {
            if (!(
              markError instanceof Error &&
              markError.name === 'ResearchCampaignOrchestrationClaimLostError'
            )) {
              throw markError
            }
          }
        } finally {
          await assertLease()
          await dependencies.orchestrations.reconcileForService(
            claim.workspaceId,
            claim.orchestrationId,
            input.fence
          )
          reconciledInWorkspace.add(claim.orchestrationId)
          reconciled += 1
        }
      }
    }
    if (reconciled >= maximumOrchestrationBatch) continue
    const activeIds = await dependencies.orchestrations.listActiveOrchestrationIdsForService(
      workspaceId,
      maximumOrchestrationBatch - reconciled
    )
    for (const activeId of activeIds) {
      if (reconciled >= maximumOrchestrationBatch) break
      if (reconciledInWorkspace.has(activeId)) continue
      await assertLease()
      await dependencies.orchestrations.reconcileForService(workspaceId, activeId, input.fence)
      reconciledInWorkspace.add(activeId)
      reconciled += 1
    }
  }
  return {
    workspacesScanned: workspaceIds.length,
    claims,
    dispatched,
    failed,
    policyDenied: policyDeniedCount,
    reconciled
  }
}
