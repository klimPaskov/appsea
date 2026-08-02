import { randomUUID } from 'node:crypto'
import { isProductionConnectorSourceId } from '@appsea/connectors'
import {
  productionCollectionWorkflowStartRequestSchema,
  type ResearchCampaignConfiguration,
  type ResearchCampaignRefreshFailureCode,
  type ResearchJobBudget
} from '@appsea/contracts'
import {
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError,
  type PostgresProductionWorkflowAdmissionRepository,
  type PostgresResearchCampaignRepository,
  type PostgresSourcePolicyRepository,
  type ResearchCampaignRefreshClaim,
  type ResearchCampaignRefreshRequestBinding
} from '@appsea/db'
import type { MaintenanceSchedulerFence } from '@appsea/contracts'
import { prepareProductionCollectionWorkflowStart } from '@appsea/workflows'

const maximumRefreshBatch = 100

export interface CampaignRefreshInput {
  batchSize: number
  claimOwner: string
  claimLeaseSeconds: number
  retryAfterSeconds: number
  occurredAt: string
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
}

export interface CampaignRefreshDependencies {
  campaigns: Pick<
    PostgresResearchCampaignRepository,
    | 'listRefreshWorkspaceIds'
    | 'claimNextRefreshForService'
    | 'bindRefreshRequestForService'
    | 'markRefreshDispatchedForService'
    | 'markRefreshFailedForService'
  >
  policies: Pick<PostgresSourcePolicyRepository, 'readCollectible'>
  admission: Pick<PostgresProductionWorkflowAdmissionRepository, 'admitForService'>
  startWorkflow: (
    request: ReturnType<typeof productionCollectionWorkflowStartRequestSchema.parse>
  ) => Promise<{ workflowId: string }>
}

export interface CampaignRefreshResult {
  workspacesScanned: number
  claims: number
  dispatched: number
  failed: number
  policyDenied: number
}

function safeFailureSummary(code: ResearchCampaignRefreshFailureCode): string {
  switch (code) {
    case 'APPSEA_REFRESH_POLICY_DENIED':
      return 'The current source policy is not approved for this campaign.'
    case 'APPSEA_REFRESH_SOURCE_UNSUPPORTED':
      return 'The scheduled campaign source has no enabled worker connector.'
    case 'APPSEA_REFRESH_INPUT_INVALID':
      return 'The persisted scheduled refresh request failed validation.'
    case 'APPSEA_REFRESH_ADMISSION_RATE_LIMITED':
      return 'The workspace refresh admission rate limit delayed dispatch.'
    case 'APPSEA_REFRESH_ADMISSION_CONCURRENCY_LIMITED':
      return 'The workspace refresh concurrency limit delayed dispatch.'
    case 'APPSEA_REFRESH_TEMPORAL_UNAVAILABLE':
      return 'The durable workflow service was unavailable; refresh will retry.'
    case 'APPSEA_REFRESH_CLAIM_LOST':
      return 'Another maintenance worker owns the refresh claim.'
    case 'APPSEA_REFRESH_FAILED':
      return 'The scheduled refresh failed and will retry within its bounded policy.'
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

function failureCode(error: unknown): ResearchCampaignRefreshFailureCode {
  if (error instanceof ProductionWorkflowRateLimitError) {
    return 'APPSEA_REFRESH_ADMISSION_RATE_LIMITED'
  }
  if (error instanceof ProductionWorkflowConcurrencyLimitError) {
    return 'APPSEA_REFRESH_ADMISSION_CONCURRENCY_LIMITED'
  }
  if (
    error instanceof Error &&
    ['TemporalServiceError', 'ServiceError', 'TransportError', 'ConnectionError'].includes(
      error.name
    )
  ) {
    return 'APPSEA_REFRESH_TEMPORAL_UNAVAILABLE'
  }
  return 'APPSEA_REFRESH_FAILED'
}

function inputInvalid(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'ZodError' ||
    error.message.includes('refresh request') ||
    error.message.includes('Scheduled production refresh')
  )
}

function refreshRequest(
  claim: ResearchCampaignRefreshClaim,
  configuration: ResearchCampaignConfiguration,
  budget: ResearchJobBudget,
  policyVersion: string
) {
  const sourceId = configuration.sourceIds[0]
  const limit = Math.min(configuration.maxEvidenceCount, budget.maxSourceItems, 5_000)
  if (configuration.sourceIds.length !== 1) {
    throw new Error('Scheduled production refresh requires exactly one approved source')
  }
  if (!sourceId || limit < 1)
    throw new Error('Scheduled production refresh has no usable source budget')
  return productionCollectionWorkflowStartRequestSchema.parse({
    workspaceId: claim.workspaceId,
    campaignId: claim.campaignId,
    runId: claim.runId,
    idempotencyKey: claim.idempotencyKey,
    workflowVersion: 'production-collection-v1',
    sourceId,
    policyVersion,
    query: configuration.query,
    limit,
    purpose: claim.purpose,
    requestedDisplayMode: configuration.requestedDisplayMode,
    budget,
    requestedAt: claim.dueAt,
    requestedBy: { actorType: 'service', actorId: 'appsea-worker' }
  })
}

function isPolicyDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResearchCampaignRefreshPolicyDeniedError'
}

function isSourceUnsupported(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResearchCampaignRefreshSourceUnsupportedError'
}

export async function runCampaignRefresh(
  input: CampaignRefreshInput,
  dependencies: CampaignRefreshDependencies
): Promise<CampaignRefreshResult> {
  if (
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 0 ||
    input.batchSize > maximumRefreshBatch
  ) {
    throw new Error('Campaign refresh batch size must be an integer between 0 and 100')
  }
  if (!Number.isFinite(Date.parse(input.occurredAt)))
    throw new Error('occurredAt is not a valid timestamp')
  const assertLease = input.assertLease ?? (async () => undefined)
  const workspaceIds = [...new Set(await dependencies.campaigns.listRefreshWorkspaceIds())].sort()
  let claims = 0
  let dispatched = 0
  let failed = 0
  let policyDenied = 0
  if (input.batchSize === 0)
    return { workspacesScanned: workspaceIds.length, claims, dispatched, failed, policyDenied }

  for (const workspaceId of workspaceIds) {
    if (claims >= input.batchSize) break
    await assertLease()
    const claimToken = `token:campaign-refresh:${randomUUID()}`
    const claim = await dependencies.campaigns.claimNextRefreshForService(
      workspaceId,
      input.claimOwner,
      claimToken,
      input.claimLeaseSeconds,
      input.fence
    )
    if (!claim) continue
    claims += 1
    try {
      await assertLease()
      const sourceId = claim.configuration.sourceIds[0]
      if (
        claim.configuration.sourceIds.length !== 1 ||
        !sourceId ||
        !isProductionConnectorSourceId(sourceId)
      ) {
        const error = new Error('Scheduled refresh has no supported legally permitted source')
        error.name = 'ResearchCampaignRefreshSourceUnsupportedError'
        throw error
      }
      const collectible = await dependencies.policies.readCollectible(sourceId)
      if (!collectible || !isProductionConnectorSourceId(collectible.policy.sourceId)) {
        const error = new Error('The current source policy is not approved and collectible')
        error.name = 'ResearchCampaignRefreshPolicyDeniedError'
        throw error
      }
      if (!collectible.policy.permittedPurposes.includes(claim.purpose)) {
        const error = new Error('The source policy does not permit this campaign purpose')
        error.name = 'ResearchCampaignRefreshPolicyDeniedError'
        throw error
      }
      if (collectible.policy.displayMode !== claim.configuration.requestedDisplayMode) {
        const error = new Error('The source policy display mode does not permit this campaign')
        error.name = 'ResearchCampaignRefreshPolicyDeniedError'
        throw error
      }

      const request = claim.pendingRequest
        ? productionCollectionWorkflowStartRequestSchema.parse(claim.pendingRequest)
        : refreshRequest(claim, claim.configuration, claim.budget, collectible.policyVersion)
      if (request.policyVersion !== collectible.policyVersion) {
        const error = new Error('The pending refresh request uses a stale source policy version')
        error.name = 'ResearchCampaignRefreshPolicyDeniedError'
        throw error
      }
      const prepared = prepareProductionCollectionWorkflowStart(request)
      if (
        prepared.workflowId !== claim.workflowId ||
        (claim.pendingIdempotencyDigest !== null &&
          claim.pendingIdempotencyDigest !== prepared.input.idempotencyDigest) ||
        (claim.pendingInputHash !== null && claim.pendingInputHash !== prepared.input.inputHash)
      ) {
        throw new Error('The durable refresh request conflicts with its campaign identity')
      }
      if (!claim.pendingRequest) {
        const binding: ResearchCampaignRefreshRequestBinding = {
          workspaceId: claim.workspaceId,
          campaignId: claim.campaignId,
          claimOwner: input.claimOwner,
          claimToken,
          request,
          workflowId: prepared.workflowId,
          idempotencyDigest: prepared.input.idempotencyDigest,
          inputHash: prepared.input.inputHash,
          ...(input.fence ? { fence: input.fence } : {})
        }
        await dependencies.campaigns.bindRefreshRequestForService(binding)
      }
      await dependencies.admission.admitForService({
        workspaceId: claim.workspaceId,
        idempotencyDigest: prepared.input.idempotencyDigest,
        inputHash: prepared.input.inputHash
      })
      const handle = await dependencies.startWorkflow(request)
      if (handle.workflowId !== prepared.workflowId) {
        throw new Error('The started workflow conflicts with the durable campaign identity')
      }
      await dependencies.campaigns.markRefreshDispatchedForService({
        workspaceId: claim.workspaceId,
        campaignId: claim.campaignId,
        claimOwner: input.claimOwner,
        claimToken,
        runId: claim.runId,
        workflowId: handle.workflowId,
        startedAt: new Date().toISOString(),
        ...(input.fence ? { fence: input.fence } : {})
      })
      dispatched += 1
    } catch (error) {
      failed += 1
      if (isPolicyDenied(error)) policyDenied += 1
      const code: ResearchCampaignRefreshFailureCode = isPolicyDenied(error)
        ? 'APPSEA_REFRESH_POLICY_DENIED'
        : isSourceUnsupported(error)
          ? 'APPSEA_REFRESH_SOURCE_UNSUPPORTED'
          : inputInvalid(error)
            ? 'APPSEA_REFRESH_INPUT_INVALID'
            : failureCode(error)
      const clearPending =
        code === 'APPSEA_REFRESH_POLICY_DENIED' ||
        code === 'APPSEA_REFRESH_SOURCE_UNSUPPORTED' ||
        code === 'APPSEA_REFRESH_INPUT_INVALID'
      try {
        await dependencies.campaigns.markRefreshFailedForService({
          workspaceId: claim.workspaceId,
          campaignId: claim.campaignId,
          claimOwner: input.claimOwner,
          claimToken,
          failureCode: code,
          failureSummary: safeFailureSummary(code),
          retryAfterSeconds: retrySeconds(error, input.retryAfterSeconds),
          clearPending,
          ...(input.fence ? { fence: input.fence } : {})
        })
      } catch (markError) {
        // A lost claim is safe: another scheduler owns the durable retry.
        if (!(
          markError instanceof Error && markError.name === 'ResearchCampaignRefreshClaimLostError'
        )) {
          throw markError
        }
      }
    }
  }
  return { workspacesScanned: workspaceIds.length, claims, dispatched, failed, policyDenied }
}
