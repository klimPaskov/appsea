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
  PostgresSourceQuotaRepository
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

/**
 * Run one approved CFPB collection. A completed database result is checked
 * before touching the connector so a replay never spends a second source
 * request or quota reservation. The connector and persistence boundaries both
 * retain their own idempotency checks for concurrent callers.
 */
export async function runProductionCfpbCollection(
  pool: Pool,
  request: ProductionCollectionRequest
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
  const connector = new CfpbConnector({
    policy: collectible.policy,
    quotaLedger: new PostgresSourceQuotaRepository(pool)
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
    return await repository.persist({
      request: effectiveRequest,
      policy: collected.policy,
      complaints: collected.complaints,
      deletions: collected.deletions,
      warnings: collected.warnings
    })
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
    throw error
  }
}
