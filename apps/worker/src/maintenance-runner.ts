import {
  appseaIdentifierSchema,
  authRetentionResultSchema,
  sourceMaintenanceInputSchema,
  sourceMaintenanceResultSchema,
  authRetentionInputSchema,
  type AuthRetentionInput,
  type AuthRetentionResult,
  type MaintenanceSchedulerFence,
  type SourceSnapshotReconciliationReadModel,
  type SourceMaintenanceInput,
  type SourceMaintenanceResult
} from '@appsea/contracts'
import type {
  PostgresAuthRepository,
  PostgresDeletionPropagationRepository,
  PostgresProductionAnalysisAdmissionRepository,
  PostgresProductionAnalysisObjectPurgeRepository,
  PostgresProductionWorkflowAdmissionRepository,
  PostgresSourceCollectionLeaseRepository,
  PostgresSourceQuotaRepository,
  PostgresManualImportRepository
} from '@appsea/db'
import type { CampaignRefreshResult } from './campaign-refresh-runner'
import type { CampaignOrchestrationResult } from './campaign-orchestration-runner'
import type { ProductionWorkflowCancellationResult } from './production-workflow-cancellation-runner'

const millisecondsPerDay = 24 * 60 * 60 * 1_000
const maximumWorkspaceCount = 10_000
const maximumAffectedObjects = 10_000_000

export interface SourceMaintenanceDependencies {
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
  quota: Pick<
    PostgresSourceQuotaRepository,
    'listActiveWorkspaceIds' | 'expireStale' | 'purgeSettled'
  >
  deletion: Pick<PostgresDeletionPropagationRepository, 'listActiveWorkspaceIds' | 'processNext'> &
    Pick<PostgresDeletionPropagationRepository, 'enqueueExpired'>
  /** Production entry points provide this; legacy fixture test doubles may omit it. */
  admission?: Pick<PostgresProductionWorkflowAdmissionRepository, 'purge'>
  /** Production entry points provide this; legacy fixture test doubles may omit it. */
  analysisAdmission?: Pick<PostgresProductionAnalysisAdmissionRepository, 'purge'>
  /** Production entry points provide this; legacy fixture test doubles may omit it. */
  leases?: Pick<PostgresSourceCollectionLeaseRepository, 'purge'>
  /** Purge owner-import staging through the fenced source-policy retention path. */
  manualImports?: Pick<PostgresManualImportRepository, 'purgeExpired'>
  /** Production entry points provide this; legacy fixture test doubles may omit it. */
  objectPurge?: Pick<PostgresProductionAnalysisObjectPurgeRepository, 'processNext'>
  /**
   * Resume one due identifier-only source snapshot for a workspace. The
   * callback owns policy, lease, quota, checkpoint, and retry semantics.
   */
  snapshotReconciliation?: (
    workspaceId: string
  ) => Promise<SourceSnapshotReconciliationReadModel | null>
  /** Dispatch bounded, policy-gated refreshes for private production campaigns. */
  campaignRefresh?: () => Promise<CampaignRefreshResult>
  /** Dispatch bounded, policy-gated children for multi-source campaigns. */
  campaignOrchestration?: () => Promise<CampaignOrchestrationResult>
  /** Retry durable one-source workflow cancellation intents. */
  productionWorkflowCancellation?: () => Promise<ProductionWorkflowCancellationResult>
}

export interface AuthRetentionDependencies {
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
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
  const assertLease = dependencies.assertLease ?? (async () => undefined)
  await assertLease()
  const quotaWorkspaceIds = sortedWorkspaceIds(await dependencies.quota.listActiveWorkspaceIds())
  const deletionWorkspaceIds = parsed.workspaceId
    ? [appseaIdentifierSchema.parse(parsed.workspaceId)]
    : sortedWorkspaceIds(await dependencies.deletion.listActiveWorkspaceIds())
  const before = retentionBefore(parsed.occurredAt, parsed.quotaRetentionDays)

  let quotaReservationsExpired = 0
  for (const workspaceId of quotaWorkspaceIds) {
    if (quotaReservationsExpired >= parsed.quotaBatchSize) break
    const remaining = parsed.quotaBatchSize - quotaReservationsExpired
    await assertLease()
    const expired = countWithin(
      await dependencies.quota.expireStale(
        workspaceId,
        parsed.occurredAt,
        remaining,
        dependencies.fence
      ),
      'quotaReservationsExpired',
      remaining
    )
    quotaReservationsExpired += expired
  }

  let quotaReservationsPurged = 0
  for (const workspaceId of quotaWorkspaceIds) {
    if (quotaReservationsPurged >= parsed.quotaBatchSize) break
    const remaining = parsed.quotaBatchSize - quotaReservationsPurged
    await assertLease()
    const purged = countWithin(
      await dependencies.quota.purgeSettled(workspaceId, before, remaining, dependencies.fence),
      'quotaReservationsPurged',
      remaining
    )
    quotaReservationsPurged += purged
  }

  let deletionTombstonesProcessed = 0
  let deletionObjectsAffected = 0
  let deletionOpportunitiesInvalidated = 0
  let recomputationJobsQueued = 0
  let productionWorkflowAdmissionsPurged = 0
  let productionAnalysisAdmissionsPurged = 0
  let sourceCollectionLeasesPurged = 0
  let manualImportBatchesPurged = 0
  let productionAnalysisObjectsPurged = 0
  let sourceSnapshotReconciliationsProcessed = 0
  let sourceSnapshotReconciliationsCompleted = 0
  let sourceSnapshotReconciliationsIncomplete = 0
  let sourceSnapshotReconciliationsFailed = 0
  let sourceSnapshotReconciliationsRetried = 0
  let sourceSnapshotCoverageGaps = 0
  let retentionTombstonesQueued = 0
  let campaignRefreshClaims = 0
  let campaignRefreshDispatched = 0
  let campaignRefreshFailed = 0
  let campaignRefreshPolicyDenied = 0
  let campaignOrchestrationClaims = 0
  let campaignOrchestrationDispatched = 0
  let campaignOrchestrationFailed = 0
  let campaignOrchestrationPolicyDenied = 0
  let campaignOrchestrationReconciled = 0
  let productionWorkflowCancellationTargets = 0
  let productionWorkflowCancellationAttempted = 0
  let productionWorkflowCancellationDispatched = 0
  let productionWorkflowCancellationFailed = 0
  if (dependencies.admission) {
    for (const workspaceId of deletionWorkspaceIds) {
      if (productionWorkflowAdmissionsPurged >= parsed.retentionBatchSize) break
      const remaining = parsed.retentionBatchSize - productionWorkflowAdmissionsPurged
      await assertLease()
      const purged = countWithin(
        await dependencies.admission.purge(workspaceId, before, remaining, dependencies.fence),
        'productionWorkflowAdmissionsPurged',
        remaining
      )
      productionWorkflowAdmissionsPurged += purged
    }
  }
  if (dependencies.analysisAdmission) {
    for (const workspaceId of deletionWorkspaceIds) {
      if (productionAnalysisAdmissionsPurged >= parsed.retentionBatchSize) break
      const remaining = parsed.retentionBatchSize - productionAnalysisAdmissionsPurged
      await assertLease()
      const purged = countWithin(
        await dependencies.analysisAdmission.purge(
          workspaceId,
          before,
          remaining,
          dependencies.fence
        ),
        'productionAnalysisAdmissionsPurged',
        remaining
      )
      productionAnalysisAdmissionsPurged += purged
    }
  }
  if (dependencies.leases) {
    for (const workspaceId of deletionWorkspaceIds) {
      if (sourceCollectionLeasesPurged >= parsed.retentionBatchSize) break
      const remaining = parsed.retentionBatchSize - sourceCollectionLeasesPurged
      await assertLease()
      const purged = countWithin(
        await dependencies.leases.purge(workspaceId, before, remaining, dependencies.fence),
        'sourceCollectionLeasesPurged',
        remaining
      )
      sourceCollectionLeasesPurged += purged
    }
  }
  if (dependencies.manualImports) {
    if (!dependencies.fence) {
      throw new Error('manual import retention requires a maintenance scheduler fence')
    }
    for (const workspaceId of deletionWorkspaceIds) {
      if (manualImportBatchesPurged >= parsed.retentionBatchSize) break
      const remaining = parsed.retentionBatchSize - manualImportBatchesPurged
      await assertLease()
      const purged = countWithin(
        await dependencies.manualImports.purgeExpired(
          workspaceId,
          parsed.occurredAt,
          remaining,
          dependencies.fence
        ),
        'manualImportBatchesPurged',
        remaining
      )
      manualImportBatchesPurged += purged
    }
  }
  if (dependencies.snapshotReconciliation) {
    for (const workspaceId of deletionWorkspaceIds) {
      if (sourceSnapshotReconciliationsProcessed >= parsed.snapshotReconciliationBatchSize) break
      await assertLease()
      const result = await dependencies.snapshotReconciliation(workspaceId)
      if (!result) continue
      sourceSnapshotReconciliationsProcessed += 1
      const coverageGaps = countWithin(
        result.coverageGaps.length,
        'sourceSnapshotCoverageGaps',
        5_000 - sourceSnapshotCoverageGaps
      )
      sourceSnapshotCoverageGaps += coverageGaps
      if (result.state === 'completed') sourceSnapshotReconciliationsCompleted += 1
      if (result.state === 'incomplete') sourceSnapshotReconciliationsIncomplete += 1
      if (result.state === 'failed') sourceSnapshotReconciliationsFailed += 1
      if (result.state === 'queued' || result.state === 'running') {
        sourceSnapshotReconciliationsRetried += 1
      }
    }
  }
  for (const workspaceId of deletionWorkspaceIds) {
    if (retentionTombstonesQueued >= parsed.retentionBatchSize) break
    const remaining = parsed.retentionBatchSize - retentionTombstonesQueued
    await assertLease()
    const queued = countWithin(
      await dependencies.deletion.enqueueExpired(
        workspaceId,
        parsed.occurredAt,
        remaining,
        dependencies.fence
      ),
      'retentionTombstonesQueued',
      remaining
    )
    retentionTombstonesQueued += queued
  }
  for (const workspaceId of deletionWorkspaceIds) {
    while (deletionTombstonesProcessed < parsed.deletionBatchSize) {
      await assertLease()
      const result = await dependencies.deletion.processNext(workspaceId, dependencies.fence)
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
      const queuedRecomputations = countWithin(
        result.recomputationJobsQueued,
        'recomputationJobsQueued',
        maximumAffectedObjects - recomputationJobsQueued
      )
      recomputationJobsQueued += queuedRecomputations
    }
    if (deletionTombstonesProcessed >= parsed.deletionBatchSize) break
  }
  if (dependencies.objectPurge) {
    for (const workspaceId of deletionWorkspaceIds) {
      while (productionAnalysisObjectsPurged < parsed.retentionBatchSize) {
        await assertLease()
        const result = await dependencies.objectPurge.processNext(
          workspaceId,
          parsed.occurredAt,
          dependencies.fence
        )
        if (!result) break
        if (result.purged) productionAnalysisObjectsPurged += 1
      }
      if (productionAnalysisObjectsPurged >= parsed.retentionBatchSize) break
    }
  }

  if (dependencies.campaignRefresh && parsed.campaignRefreshBatchSize > 0) {
    await assertLease()
    const refresh = await dependencies.campaignRefresh()
    campaignRefreshClaims = countWithin(refresh.claims, 'campaignRefreshClaims', 100)
    campaignRefreshDispatched = countWithin(refresh.dispatched, 'campaignRefreshDispatched', 100)
    campaignRefreshFailed = countWithin(refresh.failed, 'campaignRefreshFailed', 100)
    campaignRefreshPolicyDenied = countWithin(
      refresh.policyDenied,
      'campaignRefreshPolicyDenied',
      100
    )
  }

  if (dependencies.campaignOrchestration && parsed.campaignOrchestrationBatchSize > 0) {
    await assertLease()
    const orchestration = await dependencies.campaignOrchestration()
    campaignOrchestrationClaims = countWithin(
      orchestration.claims,
      'campaignOrchestrationClaims',
      100
    )
    campaignOrchestrationDispatched = countWithin(
      orchestration.dispatched,
      'campaignOrchestrationDispatched',
      100
    )
    campaignOrchestrationFailed = countWithin(
      orchestration.failed,
      'campaignOrchestrationFailed',
      100
    )
    campaignOrchestrationPolicyDenied = countWithin(
      orchestration.policyDenied,
      'campaignOrchestrationPolicyDenied',
      100
    )
    campaignOrchestrationReconciled = countWithin(
      orchestration.reconciled,
      'campaignOrchestrationReconciled',
      100
    )
  }
  if (
    dependencies.productionWorkflowCancellation &&
    parsed.productionWorkflowCancellationBatchSize > 0
  ) {
    await assertLease()
    const cancellation = await dependencies.productionWorkflowCancellation()
    productionWorkflowCancellationTargets = countWithin(
      cancellation.targets,
      'productionWorkflowCancellationTargets',
      100
    )
    productionWorkflowCancellationAttempted = countWithin(
      cancellation.attempted,
      'productionWorkflowCancellationAttempted',
      100
    )
    productionWorkflowCancellationDispatched = countWithin(
      cancellation.dispatched,
      'productionWorkflowCancellationDispatched',
      100
    )
    productionWorkflowCancellationFailed = countWithin(
      cancellation.failed,
      'productionWorkflowCancellationFailed',
      100
    )
  }

  return sourceMaintenanceResultSchema.parse({
    jobId: parsed.jobId,
    quotaWorkspacesScanned: quotaWorkspaceIds.length,
    deletionWorkspacesScanned: deletionWorkspaceIds.length,
    quotaReservationsExpired,
    quotaReservationsPurged,
    manualImportBatchesPurged,
    productionWorkflowAdmissionsPurged,
    productionAnalysisAdmissionsPurged,
    sourceCollectionLeasesPurged,
    productionAnalysisObjectsPurged,
    sourceSnapshotReconciliationsProcessed,
    sourceSnapshotReconciliationsCompleted,
    sourceSnapshotReconciliationsIncomplete,
    sourceSnapshotReconciliationsFailed,
    sourceSnapshotReconciliationsRetried,
    sourceSnapshotCoverageGaps,
    campaignRefreshClaims,
    campaignRefreshDispatched,
    campaignRefreshFailed,
    campaignRefreshPolicyDenied,
    campaignOrchestrationClaims,
    campaignOrchestrationDispatched,
    campaignOrchestrationFailed,
    campaignOrchestrationPolicyDenied,
    campaignOrchestrationReconciled,
    productionWorkflowCancellationTargets,
    productionWorkflowCancellationAttempted,
    productionWorkflowCancellationDispatched,
    productionWorkflowCancellationFailed,
    retentionTombstonesQueued,
    deletionTombstonesProcessed,
    deletionObjectsAffected,
    deletionOpportunitiesInvalidated,
    recomputationJobsQueued
  })
}

/** Run bounded authentication cleanup with a scheduler-safe result shape. */
export async function runAuthRetention(
  input: AuthRetentionInput,
  dependencies: AuthRetentionDependencies
): Promise<AuthRetentionResult> {
  const parsed = authRetentionInputSchema.parse(input)
  await (dependencies.assertLease ?? (async () => undefined))()
  const result = await dependencies.auth.purgeExpiredSessions(
    parsed.retentionDays,
    parsed.batchSize,
    dependencies.fence
  )
  return authRetentionResultSchema.parse({
    jobId: parsed.jobId,
    sessionsDeleted: result.sessionsDeleted,
    rateLimitsDeleted: result.rateLimitsDeleted,
    passwordResetTokensDeleted: result.passwordResetTokensDeleted,
    workspaceInvitationsDeleted: result.workspaceInvitationsDeleted,
    mfaChallengesDeleted: result.mfaChallengesDeleted,
    mfaEventsDeleted: result.mfaEventsDeleted,
    mfaPendingEnrollmentsDeleted: result.mfaPendingEnrollmentsDeleted
  })
}
