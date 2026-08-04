import {
  CfpbConnector,
  ManualImportConnector,
  isProductionConnectorSourceId,
  SourceQuotaReservationReplayError,
  SourceCollectionPreflightDeniedError,
  StackExchangeConnector
} from '@appsea/connectors'
import type { ManualImportBatchReader, SourceQuotaLedger } from '@appsea/connectors'
import {
  productionCollectionRequestSchema,
  type SourcePolicy,
  type ProductionCollectionRequest,
  type ProductionCollectionResult
} from '@appsea/contracts'
import {
  contentHash,
  ProductionCollectionLeaseAssertionError,
  PostgresProductionCollectionRepository,
  PostgresManualImportRepository,
  PostgresSourcePolicyRepository,
  PostgresSourceQuotaRepository,
  PostgresSourceCollectionLeaseRepository,
  PostgresProductionWorkflowAdmissionRepository,
  ProductionWorkflowAdmissionRequiredError,
  SourceCollectionLeasePolicyDeniedError,
  SourceCollectionLeaseTerminalError,
  type SourceCollectionLeaseResult
} from '@appsea/db'
import type { Pool } from 'pg'

export class ProductionCollectionPolicyDeniedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProductionCollectionPolicyDeniedError'
  }
}

interface ProductionConnectorOptions {
  policy: SourcePolicy
  quotaLedger: SourceQuotaLedger
  now: () => string
  manualImportBatchReader?: ManualImportBatchReader
}

function createProductionConnector(
  options: ProductionConnectorOptions
): CfpbConnector | StackExchangeConnector | ManualImportConnector {
  switch (options.policy.sourceId) {
    case 'cfpb-consumer-complaints':
      return new CfpbConnector(options)
    case 'stackexchange-stackoverflow':
      return new StackExchangeConnector(options)
    case 'manual-owner-import':
      if (!options.manualImportBatchReader) {
        throw new ProductionCollectionPolicyDeniedError(
          'The manual import worker requires its staged batch reader'
        )
      }
      return new ManualImportConnector({
        policy: options.policy,
        quotaLedger: options.quotaLedger,
        now: options.now,
        batchReader: options.manualImportBatchReader
      })
    default:
      throw new ProductionCollectionPolicyDeniedError(
        'The production worker has no connector for this source'
      )
  }
}

export class ProductionCollectionReconciliationError extends Error {
  readonly reason: string

  constructor(message: string, options?: ErrorOptions, reason = 'unknown') {
    super(message, options)
    this.name = 'ProductionCollectionReconciliationError'
    this.reason = reason
  }
}

export class ProductionCollectionRecollectionUnavailableError extends Error {
  constructor() {
    super(
      'The requested source re-collection tombstone is not completed or does not match the source'
    )
    this.name = 'ProductionCollectionRecollectionUnavailableError'
  }
}

export class ProductionCollectionCostBudgetExceededError extends Error {
  readonly estimatedCostMicros: number

  constructor(estimatedCostMicros: number, maximumCostMicros: number) {
    super(
      `Production collection source cost ${estimatedCostMicros} micro-USD exceeds the approved ${maximumCostMicros} micro-USD budget`
    )
    this.name = 'ProductionCollectionCostBudgetExceededError'
    this.estimatedCostMicros = estimatedCostMicros
  }
}

export interface ProductionCollectionOptions {
  /** Workflow/server-observed timestamp used to make capture provenance stable across retries. */
  observedAt?: string
  /**
   * Direct commands must reserve and consume the same production admission
   * ledger used by the authenticated gateway before an external request.
   */
  serviceAdmission?: {
    idempotencyDigest: string
    inputHash: string
  }
  /** Test/hosting override for the narrow staged manual-import capability. */
  manualImportBatchReader?: ManualImportBatchReader
  /** Secret-free phase telemetry used by the durable activity boundary. */
  onPhase?: (phase: ProductionCollectionPhase) => void
}

export type ProductionCollectionPhase =
  'lease_acquired' | 'collecting' | 'collected' | 'persisting' | 'persisted' | 'lease_released'

/** Backwards-compatible name for the explicit CFPB command wrapper. */
export type ProductionCfpbCollectionOptions = ProductionCollectionOptions

/**
 * Run one approved source collection. A completed database result is checked
 * before touching the connector so a replay never spends a second source
 * request or quota reservation. The connector and persistence boundaries both
 * retain their own idempotency checks for concurrent callers.
 */
export async function runProductionCollection(
  pool: Pool,
  request: ProductionCollectionRequest,
  options: ProductionCollectionOptions = {}
): Promise<ProductionCollectionResult> {
  const parsedRequest = productionCollectionRequestSchema.parse(request)
  if (!/^[a-f0-9]{64}$/.test(parsedRequest.idempotencyKey)) {
    throw new Error(
      'Production collection runner requires the canonical idempotency digest; hash raw keys at the gateway'
    )
  }
  const effectiveRequest = parsedRequest
  if (
    options.serviceAdmission &&
    options.serviceAdmission.idempotencyDigest !== effectiveRequest.idempotencyKey
  ) {
    throw new Error('Direct production collection admission does not match the request digest')
  }
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
      completed.requestedDisplayMode === effectiveRequest.requestedDisplayMode &&
      completed.manualImportBatchId === (effectiveRequest.manualImportBatchId ?? null) &&
      completed.recollectionTombstoneId === (effectiveRequest.recollectionTombstoneId ?? null)
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
      'No approved, active source policy snapshot is available; register and approve it through the operator review boundary first'
    )
  }
  if (
    collectible.policy.sourceId !== effectiveRequest.sourceId ||
    !isProductionConnectorSourceId(collectible.policy.sourceId)
  ) {
    throw new ProductionCollectionPolicyDeniedError(
      'The production worker has no connector for this source'
    )
  }
  const estimatedCostMicros = collectible.policy.quota.costPerRequestMicros
  if (estimatedCostMicros > effectiveRequest.budget.maxCostMicros) {
    throw new ProductionCollectionCostBudgetExceededError(
      estimatedCostMicros,
      effectiveRequest.budget.maxCostMicros
    )
  }
  const recollectionTarget = effectiveRequest.recollectionTombstoneId
    ? await repository.readRecollectionTarget(
        effectiveRequest.workspaceId,
        effectiveRequest.recollectionTombstoneId,
        effectiveRequest.sourceId
      )
    : null
  if (effectiveRequest.recollectionTombstoneId && !recollectionTarget) {
    throw new ProductionCollectionRecollectionUnavailableError()
  }
  const observedAt = new Date(options.observedAt ?? new Date().toISOString())
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error('Production collection observedAt must be a valid timestamp')
  }
  const leaseId = `lease:source-collection:${effectiveRequest.idempotencyKey}`
  const requestHash = contentHash(effectiveRequest)
  const serviceAdmissionRepository = options.serviceAdmission
    ? new PostgresProductionWorkflowAdmissionRepository(pool)
    : null
  if (serviceAdmissionRepository && options.serviceAdmission) {
    await serviceAdmissionRepository.admitForService({
      workspaceId: effectiveRequest.workspaceId,
      idempotencyDigest: options.serviceAdmission.idempotencyDigest,
      inputHash: options.serviceAdmission.inputHash
    })
  }
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
        { cause: error },
        'lease_terminal'
      )
    }
    throw error
  }
  const stableObservedAt = lease.observedAt
  try {
    options.onPhase?.('lease_acquired')
    if (options.serviceAdmission) {
      const consumed = await serviceAdmissionRepository!.consumeForService(
        effectiveRequest.workspaceId,
        options.serviceAdmission.idempotencyDigest,
        options.serviceAdmission.inputHash
      )
      if (!consumed) {
        if (!(await leaseRepository.release(effectiveRequest.workspaceId, leaseId, requestHash))) {
          throw new ProductionCollectionReconciliationError(
            'Direct production admission expired and its source lease could not be released; operator reconciliation is required',
            undefined,
            'admission_release_failed'
          )
        }
        throw new ProductionWorkflowAdmissionRequiredError()
      }
    }
    const connectorOptions = {
      policy: collectible.policy,
      quotaLedger: new PostgresSourceQuotaRepository(pool),
      now: () => stableObservedAt,
      ...(options.manualImportBatchReader
        ? { manualImportBatchReader: options.manualImportBatchReader }
        : effectiveRequest.manualImportBatchId
          ? { manualImportBatchReader: new PostgresManualImportRepository(pool) }
          : {})
    }
    const connector = createProductionConnector(connectorOptions)
    options.onPhase?.('collecting')
    const collected = await connector.collect({
      query: parsedRequest.query,
      limit: effectiveRequest.limit,
      purpose: effectiveRequest.purpose,
      requestedDisplayMode: effectiveRequest.requestedDisplayMode,
      workspaceId: effectiveRequest.workspaceId,
      runId: effectiveRequest.runId,
      policyVersion: effectiveRequest.policyVersion,
      idempotencyKey: effectiveRequest.idempotencyKey,
      ...(effectiveRequest.manualImportBatchId
        ? { manualImportBatchId: effectiveRequest.manualImportBatchId }
        : {}),
      beforeRequest: () =>
        leaseRepository.assertActive(effectiveRequest.workspaceId, leaseId, requestHash),
      ...(recollectionTarget ? { sourceRecordId: recollectionTarget.sourceRecordId } : {})
    })
    options.onPhase?.('collected')
    let persisted: ProductionCollectionResult
    try {
      options.onPhase?.('persisting')
      persisted = await repository.persistWithLease(
        {
          request: effectiveRequest,
          observedAt: stableObservedAt,
          costMicros: collected.costMicros,
          policy: collected.policy,
          complaints: collected.complaints,
          deletions: collected.deletions,
          warnings: collected.warnings
        },
        { leaseId, inputHash: requestHash }
      )
      options.onPhase?.('persisted')
    } catch (error) {
      if (error instanceof ProductionCollectionLeaseAssertionError) {
        throw new ProductionCollectionReconciliationError(
          'Source collection lease became inactive before persistence; operator reconciliation is required',
          { cause: error },
          'persist_lease_inactive'
        )
      }
      throw error
    }
    if (!(await leaseRepository.release(effectiveRequest.workspaceId, leaseId, requestHash))) {
      throw new ProductionCollectionReconciliationError(
        'Source collection result persisted but its lease could not be released; replay is required',
        undefined,
        'release_after_persist_failed'
      )
    }
    options.onPhase?.('lease_released')
    return persisted
  } catch (error) {
    if (error instanceof SourceQuotaReservationReplayError) {
      const replayed = await repository.readCompletedIdentity(
        effectiveRequest.workspaceId,
        effectiveRequest.runId
      )
      if (replayed) return { ...replayed.result, replayed: true }
      throw new ProductionCollectionReconciliationError(
        'Source quota was already settled but no completed collection result exists; operator reconciliation is required before retry',
        { cause: error },
        'quota_settled_without_result'
      )
    }
    if (error instanceof SourceCollectionPreflightDeniedError) {
      try {
        const released = await leaseRepository.release(
          effectiveRequest.workspaceId,
          leaseId,
          requestHash
        )
        if (!released) {
          throw new Error('source collection lease release returned false', { cause: error })
        }
      } catch (releaseError) {
        throw new ProductionCollectionReconciliationError(
          'Source policy preflight was denied and its lease could not be released; operator reconciliation is required',
          { cause: releaseError },
          'preflight_release_failed'
        )
      }
      throw new ProductionCollectionPolicyDeniedError(
        'The source policy lease was revoked or expired before the external request',
        { cause: error }
      )
    }
    if (error instanceof ProductionCollectionReconciliationError) throw error
    if (error instanceof ProductionWorkflowAdmissionRequiredError) throw error
    try {
      await leaseRepository.release(effectiveRequest.workspaceId, leaseId, requestHash)
    } catch (releaseError) {
      throw new ProductionCollectionReconciliationError(
        'Source collection failed and its lease could not be released; operator reconciliation is required',
        { cause: releaseError },
        'release_after_error_failed'
      )
    }
    throw error
  }
}

/** Preserve the explicit CFPB CLI boundary while the workflow uses the generic registry-selected runner. */
export async function runProductionCfpbCollection(
  pool: Pool,
  request: ProductionCollectionRequest,
  options: ProductionCfpbCollectionOptions = {}
): Promise<ProductionCollectionResult> {
  if (request.sourceId !== 'cfpb-consumer-complaints') {
    throw new ProductionCollectionPolicyDeniedError(
      'The CFPB command accepts only the CFPB source identifier'
    )
  }
  return runProductionCollection(pool, request, options)
}
