import {
  appseaIdentifierSchema,
  authRetentionResultSchema,
  sourceMaintenanceInputSchema,
  sourceMaintenanceResultSchema,
  authRetentionInputSchema,
  type AuthRetentionInput,
  type AuthRetentionResult,
  type SourceMaintenanceInput,
  type SourceMaintenanceResult
} from '@appsea/contracts'
import type {
  PostgresAuthRepository,
  PostgresDeletionPropagationRepository,
  PostgresSourceQuotaRepository
} from '@appsea/db'

const millisecondsPerDay = 24 * 60 * 60 * 1_000
const maximumWorkspaceCount = 10_000
const maximumAffectedObjects = 10_000_000

export interface SourceMaintenanceDependencies {
  quota: Pick<
    PostgresSourceQuotaRepository,
    'listActiveWorkspaceIds' | 'expireStale' | 'purgeSettled'
  >
  deletion: Pick<PostgresDeletionPropagationRepository, 'listActiveWorkspaceIds' | 'processNext'> &
    Pick<PostgresDeletionPropagationRepository, 'enqueueExpired'>
}

export interface AuthRetentionDependencies {
  auth: Pick<PostgresAuthRepository, 'purgeExpiredSessions'>
}

function sortedWorkspaceIds(values: readonly string[]): string[] {
  const workspaceIds = [
    ...new Set(values.map((value) => appseaIdentifierSchema.parse(value)))
  ].sort()
  if (workspaceIds.length > maximumWorkspaceCount) {
    throw new Error('maintenance workspace count exceeded its bounded limit')
  }
  return workspaceIds
}

function countWithin(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} exceeded its bounded maintenance result`)
  }
  return value
}

function retentionBefore(occurredAt: string, retentionDays: number): string {
  const occurredAtMillis = Date.parse(occurredAt)
  if (!Number.isFinite(occurredAtMillis)) throw new Error('occurredAt is not a valid timestamp')
  return new Date(occurredAtMillis - retentionDays * millisecondsPerDay).toISOString()
}

/**
 * Runs quota expiry/purge and deletion propagation with independent bounded
 * budgets. Repository operations are idempotent, so a scheduler may safely
 * rerun the same time window after a worker interruption.
 */
export async function runSourceMaintenance(
  input: SourceMaintenanceInput,
  dependencies: SourceMaintenanceDependencies
): Promise<SourceMaintenanceResult> {
  const parsed = sourceMaintenanceInputSchema.parse(input)
  const quotaWorkspaceIds = sortedWorkspaceIds(await dependencies.quota.listActiveWorkspaceIds())
  const deletionWorkspaceIds = parsed.workspaceId
    ? [appseaIdentifierSchema.parse(parsed.workspaceId)]
    : sortedWorkspaceIds(await dependencies.deletion.listActiveWorkspaceIds())
  const before = retentionBefore(parsed.occurredAt, parsed.quotaRetentionDays)

  let quotaReservationsExpired = 0
  for (const workspaceId of quotaWorkspaceIds) {
    if (quotaReservationsExpired >= parsed.quotaBatchSize) break
    const remaining = parsed.quotaBatchSize - quotaReservationsExpired
    const expired = countWithin(
      await dependencies.quota.expireStale(workspaceId, parsed.occurredAt, remaining),
      'quotaReservationsExpired',
      remaining
    )
    quotaReservationsExpired += expired
  }

  let quotaReservationsPurged = 0
  for (const workspaceId of quotaWorkspaceIds) {
    if (quotaReservationsPurged >= parsed.quotaBatchSize) break
    const remaining = parsed.quotaBatchSize - quotaReservationsPurged
    const purged = countWithin(
      await dependencies.quota.purgeSettled(workspaceId, before, remaining),
      'quotaReservationsPurged',
      remaining
    )
    quotaReservationsPurged += purged
  }

  let deletionTombstonesProcessed = 0
  let deletionObjectsAffected = 0
  let deletionOpportunitiesInvalidated = 0
  let retentionTombstonesQueued = 0
  for (const workspaceId of deletionWorkspaceIds) {
    if (retentionTombstonesQueued >= parsed.retentionBatchSize) break
    const remaining = parsed.retentionBatchSize - retentionTombstonesQueued
    const queued = countWithin(
      await dependencies.deletion.enqueueExpired(workspaceId, parsed.occurredAt, remaining),
      'retentionTombstonesQueued',
      remaining
    )
    retentionTombstonesQueued += queued
  }
  for (const workspaceId of deletionWorkspaceIds) {
    while (deletionTombstonesProcessed < parsed.deletionBatchSize) {
      const result = await dependencies.deletion.processNext(workspaceId)
      if (!result) break
      deletionTombstonesProcessed += 1
      const affected = countWithin(
        result.affectedObjectCount,
        'deletionObjectsAffected',
        maximumAffectedObjects - deletionObjectsAffected
      )
      deletionObjectsAffected += affected
      const invalidated = countWithin(
        result.opportunityCount,
        'deletionOpportunitiesInvalidated',
        maximumAffectedObjects - deletionOpportunitiesInvalidated
      )
      deletionOpportunitiesInvalidated += invalidated
    }
    if (deletionTombstonesProcessed >= parsed.deletionBatchSize) break
  }

  return sourceMaintenanceResultSchema.parse({
    jobId: parsed.jobId,
    quotaWorkspacesScanned: quotaWorkspaceIds.length,
    deletionWorkspacesScanned: deletionWorkspaceIds.length,
    quotaReservationsExpired,
    quotaReservationsPurged,
    retentionTombstonesQueued,
    deletionTombstonesProcessed,
    deletionObjectsAffected,
    deletionOpportunitiesInvalidated
  })
}

/** Run bounded authentication cleanup with a scheduler-safe result shape. */
export async function runAuthRetention(
  input: AuthRetentionInput,
  dependencies: AuthRetentionDependencies
): Promise<AuthRetentionResult> {
  const parsed = authRetentionInputSchema.parse(input)
  const result = await dependencies.auth.purgeExpiredSessions(
    parsed.retentionDays,
    parsed.batchSize
  )
  return authRetentionResultSchema.parse({
    jobId: parsed.jobId,
    sessionsDeleted: result.sessionsDeleted,
    rateLimitsDeleted: result.rateLimitsDeleted,
    passwordResetTokensDeleted: result.passwordResetTokensDeleted,
    workspaceInvitationsDeleted: result.workspaceInvitationsDeleted
  })
}
