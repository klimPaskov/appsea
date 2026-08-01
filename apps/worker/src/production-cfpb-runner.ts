import { CfpbConnector, SourceQuotaReservationReplayError } from '@appsea/connectors'
import {
  productionCollectionRequestSchema,
  type ProductionCollectionRequest,
  type ProductionCollectionResult
} from '@appsea/contracts'
import {
  contentHash,
  PostgresProductionCollectionRepository,
  PostgresSourcePolicyRepository,
  PostgresSourceQuotaRepository,
  PostgresSourceCollectionLeaseRepository,
  SourceCollectionLeasePolicyDeniedError,
  SourceCollectionLeaseTerminalError,
  type SourceCollectionLeaseResult
} from '@appsea/db'
import type { Pool } from 'pg'

export class ProductionCollectionPolicyDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionCollectionPolicyDeniedError'
  }
}

export class ProductionCollectionReconciliationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProductionCollectionReconciliationError'
  }
}

export interface ProductionCfpbCollectionOptions {
  /** Workflow/server-observed timestamp used to make capture provenance stable across retries. */
  observedAt?: string
}

/**
 * Run one approved CFPB collection. A completed database result is checked
 * before touching the connector so a replay never spends a second source
 * request or quota reservation. The connector and persistence boundaries both
 * retain their own idempotency checks for concurrent callers.
 */
export async function runProductionCfpbCollection(
  pool: Pool,
  request: ProductionCollectionRequest,
  options: ProductionCfpbCollectionOptions = {}
): Promise<ProductionCollectionResult> {
  const parsedRequest = productionCollectionRequestSchema.parse(request)
  if (!/^[a-f0-9]{64}$/.test(parsedRequest.idempotencyKey)) {
    throw new Error(
      'Production collection runner requires the canonical idempotency digest; hash raw keys at the gateway'
    )
  }
  const effectiveRequest = parsedRequest
  const repository = new PostgresProductionCollectionRepository(pool)
  const completed = await repository.readCompletedIdentity(
    effectiveRequest.workspaceId,
    effectiveRequest.runId
  )
  if (completed) {
    const matches =
      completed.requestHash === contentHash(effectiveRequest) &&
      completed.idempotencyKey === effectiveRequest.idempotencyKey &&
      completed.campaignId === effectiveRequest.campaignId &&
      completed.sourceId === effectiveRequest.sourceId &&
      completed.policyVersion === effectiveRequest.policyVersion &&
      completed.query === effectiveRequest.query &&
      completed.limit === effectiveRequest.limit &&
      completed.purpose === effectiveRequest.purpose &&
      completed.requestedDisplayMode === effectiveRequest.requestedDisplayMode
    if (!matches) {
      throw new Error('Production collection run identity conflicts with a completed result')
    }
    return { ...completed.result, replayed: true }
  }

  const policyRepository = new PostgresSourcePolicyRepository(pool)
  const collectible = await policyRepository.readCollectible(
    effectiveRequest.sourceId,
    effectiveRequest.policyVersion
  )
  if (!collectible) {
    throw new ProductionCollectionPolicyDeniedError(
      'No approved, active CFPB policy snapshot is available; register and approve it through the operator review boundary first'
    )
  }
  if (collectible.policy.sourceId !== 'cfpb-consumer-complaints') {
    throw new ProductionCollectionPolicyDeniedError(
      'The production worker has no connector for this source'
    )
  }
  const observedAt = new Date(options.observedAt ?? new Date().toISOString())
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error('Production collection observedAt must be a valid timestamp')
  }
  const leaseId = `lease:source-collection:${effectiveRequest.idempotencyKey}`
  const requestHash = contentHash(effectiveRequest)
  const leaseRepository = new PostgresSourceCollectionLeaseRepository(pool)
  let lease: SourceCollectionLeaseResult
  try {
    lease = await leaseRepository.acquire({
      workspaceId: effectiveRequest.workspaceId,
      leaseId,
      sourceId: effectiveRequest.sourceId,
      policyVersion: effectiveRequest.policyVersion,
      inputHash: requestHash,
      observedAt: observedAt.toISOString()
    })
  } catch (error) {
    if (error instanceof SourceCollectionLeasePolicyDeniedError) {
      throw new ProductionCollectionPolicyDeniedError(
        'No approved, active source collection lease policy is available; operator review is required'
      )
    }
    if (error instanceof SourceCollectionLeaseTerminalError) {
      throw new ProductionCollectionReconciliationError(
        `Source collection lease is ${error.state} without a completed result; operator reconciliation is required`,
        { cause: error }
      )
    }
    throw error
  }
  const stableObservedAt = lease.observedAt
  const connector = new CfpbConnector({
    policy: collectible.policy,
    quotaLedger: new PostgresSourceQuotaRepository(pool),
    now: () => stableObservedAt
  })
  try {
    const collected = await connector.collect({
      query: parsedRequest.query,
      limit: effectiveRequest.limit,
      purpose: effectiveRequest.purpose,
      requestedDisplayMode: effectiveRequest.requestedDisplayMode,
      workspaceId: effectiveRequest.workspaceId,
      runId: effectiveRequest.runId,
      policyVersion: effectiveRequest.policyVersion,
      idempotencyKey: effectiveRequest.idempotencyKey
    })
    if (!(await leaseRepository.assertActive(effectiveRequest.workspaceId, leaseId, requestHash))) {
      throw new ProductionCollectionReconciliationError(
        'Source collection lease became inactive before persistence; operator reconciliation is required'
      )
    }
    const persisted = await repository.persist({
      request: effectiveRequest,
      observedAt: stableObservedAt,
      policy: collected.policy,
      complaints: collected.complaints,
      deletions: collected.deletions,
      warnings: collected.warnings
    })
    if (!(await leaseRepository.release(effectiveRequest.workspaceId, leaseId, requestHash))) {
      throw new ProductionCollectionReconciliationError(
        'Source collection result persisted but its lease could not be released; replay is required'
      )
    }
    return persisted
  } catch (error) {
    if (error instanceof SourceQuotaReservationReplayError) {
      const replayed = await repository.readCompletedIdentity(
        effectiveRequest.workspaceId,
        effectiveRequest.runId
      )
      if (replayed) return { ...replayed.result, replayed: true }
      throw new ProductionCollectionReconciliationError(
        'CFPB quota was already settled but no completed collection result exists; operator reconciliation is required before retry',
        { cause: error }
      )
    }
    if (error instanceof ProductionCollectionReconciliationError) throw error
    try {
      await leaseRepository.release(effectiveRequest.workspaceId, leaseId, requestHash)
    } catch (releaseError) {
      throw new ProductionCollectionReconciliationError(
        'Source collection failed and its lease could not be released; operator reconciliation is required',
        { cause: releaseError }
      )
    }
    throw error
  }
}
