import {
  CfpbConnector,
  SourceCollectionPreflightDeniedError,
  SourceQuotaReservationReplayError,
  type SourceQuotaLedger
} from '@appsea/connectors'
import {
  sourceSnapshotReconciliationInputSchema,
  sourceSnapshotReconciliationPageSchema,
  type SourcePolicy,
  type SourceSnapshotReconciliationInput,
  type SourceSnapshotReconciliationReadModel
} from '@appsea/contracts'
import {
  PostgresSourceCollectionLeaseRepository,
  PostgresSourcePolicyRepository,
  PostgresSourceQuotaRepository,
  PostgresSourceSnapshotReconciliationRepository,
  SourceCollectionLeasePolicyDeniedError,
  SourceCollectionLeaseTerminalError,
  SourceSnapshotReconciliationClaimError,
  SourceSnapshotReconciliationConflictError,
  SourceSnapshotReconciliationIncompleteError,
  SourceSnapshotReconciliationPolicyDeniedError,
  type SourceCollectionLeaseResult,
  type SourceSnapshotReconciliationClaim,
  type SourceSnapshotReconciliationFinishInput,
  type SourceSnapshotReconciliationLease
} from '@appsea/db'
import { contentHash } from '@appsea/db'
import type { Pool } from 'pg'

export class SourceSnapshotReconciliationRunnerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SourceSnapshotReconciliationRunnerError'
  }
}

export class SourceSnapshotReconciliationAlreadyRunningError extends Error {
  constructor() {
    super('Source snapshot reconciliation is already claimed by another worker')
    this.name = 'SourceSnapshotReconciliationAlreadyRunningError'
  }
}

type SnapshotJobRepository = Pick<
  PostgresSourceSnapshotReconciliationRepository,
  'enqueue' | 'read' | 'claimById' | 'claimNext' | 'appendPage' | 'finish' | 'reschedule' | 'fail'
>
type SnapshotPolicyRepository = Pick<PostgresSourcePolicyRepository, 'readCollectible'>
type SnapshotLeaseRepository = Pick<
  PostgresSourceCollectionLeaseRepository,
  'acquire' | 'assertActive' | 'release'
>
type SnapshotConnector = Pick<CfpbConnector, 'collectSnapshotPage'>

export interface SourceSnapshotReconciliationDependencies {
  jobs: SnapshotJobRepository
  policies: SnapshotPolicyRepository
  leases: SnapshotLeaseRepository
  quota: SourceQuotaLedger
  connectorFactory?: (
    policy: SourcePolicy,
    observedAt: string,
    quota: SourceQuotaLedger
  ) => SnapshotConnector
}

export interface SourceSnapshotReconciliationRunnerOptions {
  preclaimedClaim?: SourceSnapshotReconciliationClaim
}

function leaseIdentity(
  claim: SourceSnapshotReconciliationClaim
): SourceSnapshotReconciliationLease {
  return {
    leaseId: `lease:source-snapshot:${claim.reconciliationId}:attempt:${claim.attemptCount}`,
    inputHash: claim.inputHash
  }
}

function pageIdempotencyKey(claim: SourceSnapshotReconciliationClaim, offset: number): string {
  return contentHash({
    reconciliationId: claim.reconciliationId,
    inputHash: claim.inputHash,
    offset,
    pageSize: claim.pageSize
  })
}

function mergeMessages(current: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...current, ...additions])].slice(0, 50)
}

function policyDeniedSummary(): string {
  return 'The source policy is no longer approved, active, current, and deletion-eligible.'
}

function boundedFailureSummary(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0 && error.message.length <= 240) {
    return error.message
  }
  return fallback
}

function isPolicyDenied(error: unknown): boolean {
  return (
    error instanceof SourceSnapshotReconciliationPolicyDeniedError ||
    error instanceof SourceCollectionLeasePolicyDeniedError
  )
}

function isLeaseTerminal(error: unknown): boolean {
  return error instanceof SourceCollectionLeaseTerminalError
}

function asLeaseInput(lease: SourceSnapshotReconciliationLease): SourceSnapshotReconciliationLease {
  return { leaseId: lease.leaseId, inputHash: lease.inputHash }
}

async function releaseLease(
  dependencies: SourceSnapshotReconciliationDependencies,
  workspaceId: string,
  lease: SourceSnapshotReconciliationLease
): Promise<void> {
  if (!(await dependencies.leases.release(workspaceId, lease.leaseId, lease.inputHash))) {
    throw new SourceSnapshotReconciliationRunnerError(
      'Snapshot result was persisted but its source lease could not be released; operator reconciliation is required'
    )
  }
}

/**
 * Run one bounded, identifier-only CFPB snapshot. The job row and page
 * checkpoints are the durable resume boundary; a source request is never
 * retried blindly after a settled quota reservation.
 */
export async function runProductionCfpbSnapshotReconciliation(
  input: SourceSnapshotReconciliationInput,
  dependencies: SourceSnapshotReconciliationDependencies,
  options: SourceSnapshotReconciliationRunnerOptions = {}
): Promise<SourceSnapshotReconciliationReadModel> {
  const parsedInput = sourceSnapshotReconciliationInputSchema.parse(input)
  const parsed = {
    ...parsedInput,
    requestedAt: new Date(parsedInput.requestedAt).toISOString()
  }
  if (!/^[a-f0-9]{64}$/.test(parsed.idempotencyKey)) {
    throw new Error('Snapshot reconciliation requires a canonical idempotency digest')
  }
  let claim: SourceSnapshotReconciliationClaim | null = options.preclaimedClaim ?? null
  if (!claim) {
    const enqueued = await dependencies.jobs.enqueue(parsed)
    if (
      enqueued.state === 'completed' ||
      enqueued.state === 'incomplete' ||
      enqueued.state === 'failed'
    ) {
      return enqueued
    }
    claim = await dependencies.jobs.claimById(parsed.workspaceId, parsed.reconciliationId)
    if (!claim) {
      const existing = await dependencies.jobs.read(parsed.workspaceId, parsed.reconciliationId)
      if (existing && ['completed', 'incomplete', 'failed'].includes(existing.state))
        return existing
      throw new SourceSnapshotReconciliationAlreadyRunningError()
    }
  }
  if (
    claim.workspaceId !== parsed.workspaceId ||
    claim.reconciliationId !== parsed.reconciliationId ||
    claim.sourceId !== parsed.sourceId ||
    claim.policyVersion !== parsed.policyVersion ||
    claim.idempotencyKey !== parsed.idempotencyKey ||
    claim.pageSize !== parsed.pageSize ||
    claim.maxRecords !== parsed.maxRecords ||
    claim.inputHash !== contentHash(parsed)
  ) {
    throw new SourceSnapshotReconciliationConflictError(
      'Snapshot claim does not match the requested reconciliation input'
    )
  }
  const observedAt = claim.observedAt
  if (!observedAt)
    throw new SourceSnapshotReconciliationRunnerError('Snapshot claim has no observed timestamp')

  const collectible = await dependencies.policies.readCollectible(
    parsed.sourceId,
    parsed.policyVersion
  )
  if (
    !collectible ||
    collectible.policy.sourceId !== 'cfpb-consumer-complaints' ||
    collectible.policyVersion !== parsed.policyVersion
  ) {
    return dependencies.jobs.fail(
      parsed.workspaceId,
      parsed.reconciliationId,
      claim.claimToken,
      'policy_denied',
      policyDeniedSummary()
    )
  }

  const lease = leaseIdentity(claim)
  let acquiredLease: SourceCollectionLeaseResult
  try {
    acquiredLease = await dependencies.leases.acquire({
      workspaceId: parsed.workspaceId,
      leaseId: lease.leaseId,
      sourceId: parsed.sourceId,
      policyVersion: parsed.policyVersion,
      inputHash: claim.inputHash,
      observedAt
    })
  } catch (error) {
    if (isPolicyDenied(error)) {
      return dependencies.jobs.fail(
        parsed.workspaceId,
        parsed.reconciliationId,
        claim.claimToken,
        'policy_denied',
        policyDeniedSummary()
      )
    }
    if (isLeaseTerminal(error)) {
      return dependencies.jobs.fail(
        parsed.workspaceId,
        parsed.reconciliationId,
        claim.claimToken,
        'reconciliation_failed',
        'The source collection lease is terminal and requires operator reconciliation.'
      )
    }
    return dependencies.jobs.reschedule(
      parsed.workspaceId,
      parsed.reconciliationId,
      claim.claimToken,
      'reconciliation_failed',
      'The source collection lease could not be acquired.',
      30
    )
  }
  const stableObservedAt = acquiredLease.observedAt
  const sourceLease = asLeaseInput(lease)
  let connector: SnapshotConnector
  let current = claim
  let phase: 'source' | 'persistence' = 'source'
  let coverageGaps = [...current.coverageGaps]
  let warnings = [...current.warnings]
  let completeSnapshot = false
  let terminalPersisted = false
  const failTerminal = async (
    failureCode: 'reconciliation_failed',
    failureSummary: string
  ): Promise<SourceSnapshotReconciliationReadModel> => {
    const failed = await dependencies.jobs.fail(
      parsed.workspaceId,
      parsed.reconciliationId,
      current.claimToken,
      failureCode,
      failureSummary
    )
    await releaseLease(dependencies, parsed.workspaceId, sourceLease)
    return failed
  }
  try {
    connector =
      dependencies.connectorFactory?.(collectible.policy, stableObservedAt, dependencies.quota) ??
      new CfpbConnector({
        policy: collectible.policy,
        quotaLedger: dependencies.quota,
        now: () => stableObservedAt
      })
    while (current.nextOffset < parsed.maxRecords) {
      const pageSize = Math.min(parsed.pageSize, parsed.maxRecords - current.nextOffset)
      const page = sourceSnapshotReconciliationPageSchema.parse(
        await connector.collectSnapshotPage({
          offset: current.nextOffset,
          limit: pageSize,
          purpose: 'deletion-reconciliation',
          requestedDisplayMode: collectible.policy.displayMode,
          workspaceId: parsed.workspaceId,
          reconciliationId: parsed.reconciliationId,
          policyVersion: parsed.policyVersion,
          idempotencyKey: pageIdempotencyKey(current, current.nextOffset),
          beforeRequest: () =>
            dependencies.leases.assertActive(
              parsed.workspaceId,
              sourceLease.leaseId,
              sourceLease.inputHash
            )
        })
      )
      phase = 'persistence'
      current = {
        ...(await dependencies.jobs.appendPage(
          parsed.workspaceId,
          parsed.reconciliationId,
          current.claimToken,
          page
        )),
        claimToken: current.claimToken
      }
      warnings = mergeMessages(warnings, page.warnings)
      if (page.completeSnapshot && warnings.length === 0) {
        completeSnapshot = true
        break
      }
      if (page.shortPage) {
        coverageGaps = mergeMessages(coverageGaps, [
          'The source returned a malformed or otherwise unsafe short page; deletion absence was not inferred.'
        ])
        break
      }
      if (current.nextOffset >= parsed.maxRecords) {
        coverageGaps = mergeMessages(coverageGaps, [
          'The bounded snapshot reached maxRecords without observing a short page; deletion absence was not inferred.'
        ])
        break
      }
    }
    if (!completeSnapshot && current.nextOffset >= parsed.maxRecords) {
      coverageGaps = mergeMessages(coverageGaps, [
        'The bounded snapshot reached maxRecords without observing a short page; deletion absence was not inferred.'
      ])
    }
    phase = 'persistence'
    const finished = await dependencies.jobs.finish({
      workspaceId: parsed.workspaceId,
      reconciliationId: parsed.reconciliationId,
      claimToken: current.claimToken,
      fullSnapshot: completeSnapshot,
      coverageGaps,
      warnings,
      lease: sourceLease
    } satisfies SourceSnapshotReconciliationFinishInput)
    terminalPersisted = true
    await releaseLease(dependencies, parsed.workspaceId, sourceLease)
    return finished
  } catch (error) {
    if (terminalPersisted) {
      if (error instanceof SourceSnapshotReconciliationRunnerError) throw error
      throw new SourceSnapshotReconciliationRunnerError(
        'Snapshot result was persisted but post-commit lease handling failed; operator reconciliation is required',
        { cause: error }
      )
    }
    if (
      error instanceof SourceSnapshotReconciliationClaimError ||
      error instanceof SourceSnapshotReconciliationConflictError
    ) {
      throw error
    }
    if (error instanceof SourceQuotaReservationReplayError) {
      const failed = await failTerminal(
        'reconciliation_failed',
        'A source quota reservation was already settled without a matching page checkpoint; operator reconciliation is required.'
      )
      throw new SourceSnapshotReconciliationRunnerError(
        `Snapshot reconciliation entered ${failed.state} after an unsettled quota replay`,
        { cause: error }
      )
    }
    if (error instanceof SourceCollectionPreflightDeniedError) {
      const failed = await failTerminal('reconciliation_failed', policyDeniedSummary())
      throw new SourceSnapshotReconciliationRunnerError(
        `Snapshot reconciliation entered ${failed.state} after source policy preflight denial`,
        { cause: error }
      )
    }
    if (error instanceof SourceSnapshotReconciliationIncompleteError) {
      const failed = await failTerminal(
        'reconciliation_failed',
        'The database refused to finalize a snapshot without a durable short-page checkpoint.'
      )
      throw new SourceSnapshotReconciliationRunnerError(
        `Snapshot reconciliation entered ${failed.state} after an incomplete finalization attempt`,
        { cause: error }
      )
    }
    try {
      const retry = await dependencies.jobs.reschedule(
        parsed.workspaceId,
        parsed.reconciliationId,
        current.claimToken,
        phase === 'source' ? 'source_request_failed' : 'reconciliation_failed',
        boundedFailureSummary(
          error,
          phase === 'source'
            ? 'The source snapshot request failed before a durable page checkpoint.'
            : 'The snapshot page or finalization failed before a durable terminal result.'
        ),
        30
      )
      try {
        await releaseLease(dependencies, parsed.workspaceId, sourceLease)
      } catch (releaseError) {
        throw new SourceSnapshotReconciliationRunnerError(
          'Snapshot retry was recorded but its source lease could not be released; operator reconciliation is required',
          { cause: releaseError }
        )
      }
      return retry
    } catch (retryError) {
      if (retryError instanceof SourceSnapshotReconciliationClaimError) throw retryError
      throw new SourceSnapshotReconciliationRunnerError(
        'Snapshot failure could not be recorded safely; operator reconciliation is required',
        { cause: retryError }
      )
    }
  }
}

function inputFromClaim(
  claim: SourceSnapshotReconciliationClaim
): SourceSnapshotReconciliationInput {
  return sourceSnapshotReconciliationInputSchema.parse({
    workspaceId: claim.workspaceId,
    reconciliationId: claim.reconciliationId,
    sourceId: claim.sourceId,
    policyVersion: claim.policyVersion,
    idempotencyKey: claim.idempotencyKey,
    pageSize: claim.pageSize,
    maxRecords: claim.maxRecords,
    requestedAt: claim.requestedAt
  })
}

/** Process one due durable job, allowing a scheduler to resume without the raw caller key. */
export async function runNextProductionCfpbSnapshotReconciliation(
  workspaceId: string,
  dependencies: SourceSnapshotReconciliationDependencies
): Promise<SourceSnapshotReconciliationReadModel | null> {
  const claim = await dependencies.jobs.claimNext(workspaceId, 'cfpb-consumer-complaints')
  if (!claim) return null
  return runProductionCfpbSnapshotReconciliation(inputFromClaim(claim), dependencies, {
    preclaimedClaim: claim
  })
}

export function defaultSourceSnapshotReconciliationDependencies(
  pool: Pool
): SourceSnapshotReconciliationDependencies {
  return {
    jobs: new PostgresSourceSnapshotReconciliationRepository(pool),
    policies: new PostgresSourcePolicyRepository(pool),
    leases: new PostgresSourceCollectionLeaseRepository(pool),
    quota: new PostgresSourceQuotaRepository(pool)
  }
}
