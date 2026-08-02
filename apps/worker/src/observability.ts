export interface WorkerEvent {
  event: string
  taskQueue: string
  schedulerName?: string
  jobId?: string
  workflowId?: string
  state?: string
  attempt?: number
  workspacesScanned?: number
  sourceItems?: number
  snapshotPagesScanned?: number
  snapshotSourceRecords?: number
  snapshotDeletionsQueued?: number
  snapshotCoverageGaps?: number
  costMicros?: number
  sessionsDeleted?: number
  rateLimitsDeleted?: number
  passwordResetTokensDeleted?: number
  workspaceInvitationsDeleted?: number
  passwordResetDeliveriesClaimed?: number
  passwordResetDeliveriesSent?: number
  passwordResetDeliveriesFailed?: number
  workspaceInvitationDeliveriesClaimed?: number
  workspaceInvitationDeliveriesSent?: number
  workspaceInvitationDeliveriesFailed?: number
  quotaReservationsExpired?: number
  quotaReservationsPurged?: number
  sourceQuotaReconciliationOpenCases?: number
  sourceQuotaReconciliationOldestAgeSeconds?: number
  sourceQuotaReconciliationTruncated?: boolean
  productionAnalysisRecomputeJobs?: number
  productionAnalysisRecomputeFailed?: number
  productionAnalysisRecomputeBlocked?: number
  productionAnalysisRecomputeStale?: number
  productionAnalysisRecomputeOldestAgeSeconds?: number
  productionAnalysisRecomputeTruncated?: boolean
  workspaceCostAlertRows?: number
  workspaceCostAlertEntries?: number
  workspaceCostAlertTargetRows?: number
  workspaceCostAlertUnsupportedRows?: number
  workspaceCostAlertWorkspacesOverActual?: number
  workspaceCostAlertWorkspacesOverEstimated?: number
  workspaceCostAlertTruncated?: boolean
  productionWorkflowAdmissionsPurged?: number
  productionAnalysisAdmissionsPurged?: number
  sourceCollectionLeasesPurged?: number
  productionAnalysisObjectsPurged?: number
  sourceSnapshotReconciliationsProcessed?: number
  sourceSnapshotReconciliationsCompleted?: number
  sourceSnapshotReconciliationsIncomplete?: number
  sourceSnapshotReconciliationsFailed?: number
  sourceSnapshotReconciliationsRetried?: number
  sourceSnapshotCoverageGaps?: number
  campaignRefreshClaims?: number
  campaignRefreshDispatched?: number
  campaignRefreshFailed?: number
  campaignRefreshPolicyDenied?: number
  campaignOrchestrationClaims?: number
  campaignOrchestrationDispatched?: number
  campaignOrchestrationFailed?: number
  campaignOrchestrationPolicyDenied?: number
  campaignOrchestrationReconciled?: number
  productionWorkflowCancellationTargets?: number
  productionWorkflowCancellationAttempted?: number
  productionWorkflowCancellationDispatched?: number
  productionWorkflowCancellationFailed?: number
  retentionTombstonesQueued?: number
  deletionTombstonesProcessed?: number
  deletionObjectsAffected?: number
  deletionOpportunitiesInvalidated?: number
  recomputationJobsQueued?: number
  maintenancePasses?: number
  maintenanceFailures?: number
  failureCode?: string
}

export const workerHeartbeatIntervalMs = 30_000

function finiteInteger(value: number | undefined): number | undefined {
  return value === undefined || !Number.isSafeInteger(value) || value < 0 ? undefined : value
}

function schedulerName(value: string | undefined): string | undefined {
  return value && /^[a-z][a-z0-9_-]{2,79}$/.test(value) ? value : undefined
}

/**
 * Emit a small, structured, secret-free event for log collection. Event
 * payloads deliberately accept only bounded counters and fixed identifiers;
 * raw workflow input, error messages, source text, and database URLs never
 * enter worker logs.
 */
export function emitWorkerEvent(event: WorkerEvent): void {
  const payload = {
    schemaVersion: 1,
    service: 'appsea-worker',
    observedAt: new Date().toISOString(),
    event: event.event,
    taskQueue: event.taskQueue,
    ...(schedulerName(event.schedulerName)
      ? { schedulerName: schedulerName(event.schedulerName) }
      : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.workflowId ? { workflowId: event.workflowId } : {}),
    ...(event.state ? { state: event.state } : {}),
    ...(finiteInteger(event.attempt) !== undefined
      ? { attempt: finiteInteger(event.attempt) }
      : {}),
    ...(finiteInteger(event.workspacesScanned) !== undefined
      ? { workspacesScanned: finiteInteger(event.workspacesScanned) }
      : {}),
    ...(finiteInteger(event.sourceItems) !== undefined
      ? { sourceItems: finiteInteger(event.sourceItems) }
      : {}),
    ...(finiteInteger(event.snapshotPagesScanned) !== undefined
      ? { snapshotPagesScanned: finiteInteger(event.snapshotPagesScanned) }
      : {}),
    ...(finiteInteger(event.snapshotSourceRecords) !== undefined
      ? { snapshotSourceRecords: finiteInteger(event.snapshotSourceRecords) }
      : {}),
    ...(finiteInteger(event.snapshotDeletionsQueued) !== undefined
      ? { snapshotDeletionsQueued: finiteInteger(event.snapshotDeletionsQueued) }
      : {}),
    ...(finiteInteger(event.snapshotCoverageGaps) !== undefined
      ? { snapshotCoverageGaps: finiteInteger(event.snapshotCoverageGaps) }
      : {}),
    ...(finiteInteger(event.costMicros) !== undefined
      ? { costMicros: finiteInteger(event.costMicros) }
      : {}),
    ...(finiteInteger(event.sessionsDeleted) !== undefined
      ? { sessionsDeleted: finiteInteger(event.sessionsDeleted) }
      : {}),
    ...(finiteInteger(event.rateLimitsDeleted) !== undefined
      ? { rateLimitsDeleted: finiteInteger(event.rateLimitsDeleted) }
      : {}),
    ...(finiteInteger(event.passwordResetTokensDeleted) !== undefined
      ? { passwordResetTokensDeleted: finiteInteger(event.passwordResetTokensDeleted) }
      : {}),
    ...(finiteInteger(event.workspaceInvitationsDeleted) !== undefined
      ? { workspaceInvitationsDeleted: finiteInteger(event.workspaceInvitationsDeleted) }
      : {}),
    ...(finiteInteger(event.passwordResetDeliveriesClaimed) !== undefined
      ? { passwordResetDeliveriesClaimed: finiteInteger(event.passwordResetDeliveriesClaimed) }
      : {}),
    ...(finiteInteger(event.passwordResetDeliveriesSent) !== undefined
      ? { passwordResetDeliveriesSent: finiteInteger(event.passwordResetDeliveriesSent) }
      : {}),
    ...(finiteInteger(event.passwordResetDeliveriesFailed) !== undefined
      ? { passwordResetDeliveriesFailed: finiteInteger(event.passwordResetDeliveriesFailed) }
      : {}),
    ...(finiteInteger(event.workspaceInvitationDeliveriesClaimed) !== undefined
      ? {
          workspaceInvitationDeliveriesClaimed: finiteInteger(
            event.workspaceInvitationDeliveriesClaimed
          )
        }
      : {}),
    ...(finiteInteger(event.workspaceInvitationDeliveriesSent) !== undefined
      ? {
          workspaceInvitationDeliveriesSent: finiteInteger(event.workspaceInvitationDeliveriesSent)
        }
      : {}),
    ...(finiteInteger(event.workspaceInvitationDeliveriesFailed) !== undefined
      ? {
          workspaceInvitationDeliveriesFailed: finiteInteger(
            event.workspaceInvitationDeliveriesFailed
          )
        }
      : {}),
    ...(finiteInteger(event.quotaReservationsExpired) !== undefined
      ? { quotaReservationsExpired: finiteInteger(event.quotaReservationsExpired) }
      : {}),
    ...(finiteInteger(event.quotaReservationsPurged) !== undefined
      ? { quotaReservationsPurged: finiteInteger(event.quotaReservationsPurged) }
      : {}),
    ...(finiteInteger(event.sourceQuotaReconciliationOpenCases) !== undefined
      ? {
          sourceQuotaReconciliationOpenCases: finiteInteger(
            event.sourceQuotaReconciliationOpenCases
          )
        }
      : {}),
    ...(finiteInteger(event.sourceQuotaReconciliationOldestAgeSeconds) !== undefined
      ? {
          sourceQuotaReconciliationOldestAgeSeconds: finiteInteger(
            event.sourceQuotaReconciliationOldestAgeSeconds
          )
        }
      : {}),
    ...(event.sourceQuotaReconciliationTruncated !== undefined
      ? { sourceQuotaReconciliationTruncated: event.sourceQuotaReconciliationTruncated }
      : {}),
    ...(finiteInteger(event.productionAnalysisRecomputeJobs) !== undefined
      ? { productionAnalysisRecomputeJobs: finiteInteger(event.productionAnalysisRecomputeJobs) }
      : {}),
    ...(finiteInteger(event.productionAnalysisRecomputeFailed) !== undefined
      ? {
          productionAnalysisRecomputeFailed: finiteInteger(event.productionAnalysisRecomputeFailed)
        }
      : {}),
    ...(finiteInteger(event.productionAnalysisRecomputeBlocked) !== undefined
      ? {
          productionAnalysisRecomputeBlocked: finiteInteger(
            event.productionAnalysisRecomputeBlocked
          )
        }
      : {}),
    ...(finiteInteger(event.productionAnalysisRecomputeStale) !== undefined
      ? { productionAnalysisRecomputeStale: finiteInteger(event.productionAnalysisRecomputeStale) }
      : {}),
    ...(finiteInteger(event.productionAnalysisRecomputeOldestAgeSeconds) !== undefined
      ? {
          productionAnalysisRecomputeOldestAgeSeconds: finiteInteger(
            event.productionAnalysisRecomputeOldestAgeSeconds
          )
        }
      : {}),
    ...(event.productionAnalysisRecomputeTruncated !== undefined
      ? { productionAnalysisRecomputeTruncated: event.productionAnalysisRecomputeTruncated }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertRows) !== undefined
      ? { workspaceCostAlertRows: finiteInteger(event.workspaceCostAlertRows) }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertEntries) !== undefined
      ? { workspaceCostAlertEntries: finiteInteger(event.workspaceCostAlertEntries) }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertTargetRows) !== undefined
      ? { workspaceCostAlertTargetRows: finiteInteger(event.workspaceCostAlertTargetRows) }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertUnsupportedRows) !== undefined
      ? {
          workspaceCostAlertUnsupportedRows: finiteInteger(event.workspaceCostAlertUnsupportedRows)
        }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertWorkspacesOverActual) !== undefined
      ? {
          workspaceCostAlertWorkspacesOverActual: finiteInteger(
            event.workspaceCostAlertWorkspacesOverActual
          )
        }
      : {}),
    ...(finiteInteger(event.workspaceCostAlertWorkspacesOverEstimated) !== undefined
      ? {
          workspaceCostAlertWorkspacesOverEstimated: finiteInteger(
            event.workspaceCostAlertWorkspacesOverEstimated
          )
        }
      : {}),
    ...(event.workspaceCostAlertTruncated !== undefined
      ? { workspaceCostAlertTruncated: event.workspaceCostAlertTruncated }
      : {}),
    ...(finiteInteger(event.productionWorkflowAdmissionsPurged) !== undefined
      ? {
          productionWorkflowAdmissionsPurged: finiteInteger(
            event.productionWorkflowAdmissionsPurged
          )
        }
      : {}),
    ...(finiteInteger(event.productionAnalysisAdmissionsPurged) !== undefined
      ? {
          productionAnalysisAdmissionsPurged: finiteInteger(
            event.productionAnalysisAdmissionsPurged
          )
        }
      : {}),
    ...(finiteInteger(event.sourceCollectionLeasesPurged) !== undefined
      ? { sourceCollectionLeasesPurged: finiteInteger(event.sourceCollectionLeasesPurged) }
      : {}),
    ...(finiteInteger(event.productionAnalysisObjectsPurged) !== undefined
      ? { productionAnalysisObjectsPurged: finiteInteger(event.productionAnalysisObjectsPurged) }
      : {}),
    ...(finiteInteger(event.sourceSnapshotReconciliationsProcessed) !== undefined
      ? {
          sourceSnapshotReconciliationsProcessed: finiteInteger(
            event.sourceSnapshotReconciliationsProcessed
          )
        }
      : {}),
    ...(finiteInteger(event.sourceSnapshotReconciliationsCompleted) !== undefined
      ? {
          sourceSnapshotReconciliationsCompleted: finiteInteger(
            event.sourceSnapshotReconciliationsCompleted
          )
        }
      : {}),
    ...(finiteInteger(event.sourceSnapshotReconciliationsIncomplete) !== undefined
      ? {
          sourceSnapshotReconciliationsIncomplete: finiteInteger(
            event.sourceSnapshotReconciliationsIncomplete
          )
        }
      : {}),
    ...(finiteInteger(event.sourceSnapshotReconciliationsFailed) !== undefined
      ? {
          sourceSnapshotReconciliationsFailed: finiteInteger(
            event.sourceSnapshotReconciliationsFailed
          )
        }
      : {}),
    ...(finiteInteger(event.sourceSnapshotReconciliationsRetried) !== undefined
      ? {
          sourceSnapshotReconciliationsRetried: finiteInteger(
            event.sourceSnapshotReconciliationsRetried
          )
        }
      : {}),
    ...(finiteInteger(event.sourceSnapshotCoverageGaps) !== undefined
      ? { sourceSnapshotCoverageGaps: finiteInteger(event.sourceSnapshotCoverageGaps) }
      : {}),
    ...(finiteInteger(event.campaignRefreshClaims) !== undefined
      ? { campaignRefreshClaims: finiteInteger(event.campaignRefreshClaims) }
      : {}),
    ...(finiteInteger(event.campaignRefreshDispatched) !== undefined
      ? { campaignRefreshDispatched: finiteInteger(event.campaignRefreshDispatched) }
      : {}),
    ...(finiteInteger(event.campaignRefreshFailed) !== undefined
      ? { campaignRefreshFailed: finiteInteger(event.campaignRefreshFailed) }
      : {}),
    ...(finiteInteger(event.campaignRefreshPolicyDenied) !== undefined
      ? { campaignRefreshPolicyDenied: finiteInteger(event.campaignRefreshPolicyDenied) }
      : {}),
    ...(finiteInteger(event.campaignOrchestrationClaims) !== undefined
      ? { campaignOrchestrationClaims: finiteInteger(event.campaignOrchestrationClaims) }
      : {}),
    ...(finiteInteger(event.campaignOrchestrationDispatched) !== undefined
      ? { campaignOrchestrationDispatched: finiteInteger(event.campaignOrchestrationDispatched) }
      : {}),
    ...(finiteInteger(event.campaignOrchestrationFailed) !== undefined
      ? { campaignOrchestrationFailed: finiteInteger(event.campaignOrchestrationFailed) }
      : {}),
    ...(finiteInteger(event.campaignOrchestrationPolicyDenied) !== undefined
      ? {
          campaignOrchestrationPolicyDenied: finiteInteger(event.campaignOrchestrationPolicyDenied)
        }
      : {}),
    ...(finiteInteger(event.campaignOrchestrationReconciled) !== undefined
      ? { campaignOrchestrationReconciled: finiteInteger(event.campaignOrchestrationReconciled) }
      : {}),
    ...(finiteInteger(event.productionWorkflowCancellationTargets) !== undefined
      ? {
          productionWorkflowCancellationTargets: finiteInteger(
            event.productionWorkflowCancellationTargets
          )
        }
      : {}),
    ...(finiteInteger(event.productionWorkflowCancellationAttempted) !== undefined
      ? {
          productionWorkflowCancellationAttempted: finiteInteger(
            event.productionWorkflowCancellationAttempted
          )
        }
      : {}),
    ...(finiteInteger(event.productionWorkflowCancellationDispatched) !== undefined
      ? {
          productionWorkflowCancellationDispatched: finiteInteger(
            event.productionWorkflowCancellationDispatched
          )
        }
      : {}),
    ...(finiteInteger(event.productionWorkflowCancellationFailed) !== undefined
      ? {
          productionWorkflowCancellationFailed: finiteInteger(
            event.productionWorkflowCancellationFailed
          )
        }
      : {}),
    ...(finiteInteger(event.retentionTombstonesQueued) !== undefined
      ? { retentionTombstonesQueued: finiteInteger(event.retentionTombstonesQueued) }
      : {}),
    ...(finiteInteger(event.deletionTombstonesProcessed) !== undefined
      ? { deletionTombstonesProcessed: finiteInteger(event.deletionTombstonesProcessed) }
      : {}),
    ...(finiteInteger(event.deletionObjectsAffected) !== undefined
      ? { deletionObjectsAffected: finiteInteger(event.deletionObjectsAffected) }
      : {}),
    ...(finiteInteger(event.deletionOpportunitiesInvalidated) !== undefined
      ? {
          deletionOpportunitiesInvalidated: finiteInteger(event.deletionOpportunitiesInvalidated)
        }
      : {}),
    ...(finiteInteger(event.recomputationJobsQueued) !== undefined
      ? { recomputationJobsQueued: finiteInteger(event.recomputationJobsQueued) }
      : {}),
    ...(finiteInteger(event.maintenancePasses) !== undefined
      ? { maintenancePasses: finiteInteger(event.maintenancePasses) }
      : {}),
    ...(finiteInteger(event.maintenanceFailures) !== undefined
      ? { maintenanceFailures: finiteInteger(event.maintenanceFailures) }
      : {}),
    ...(event.failureCode ? { failureCode: event.failureCode } : {})
  }
  console.log(JSON.stringify(payload))
}

export interface WorkerHeartbeatOptions {
  intervalMs?: number
  emit?: (event: WorkerEvent) => void
}

/**
 * Emit a bounded liveness signal while the long-lived worker is running.
 * Deployment log/metric collection can alert when this signal stops without
 * requiring a database write or exposing workflow/source content.
 */
export function startWorkerHeartbeat(
  taskQueue: string,
  options: WorkerHeartbeatOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? workerHeartbeatIntervalMs
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 3_600_000) {
    throw new Error('Worker heartbeat interval must be between 1000 and 3600000 milliseconds')
  }
  const emit = options.emit ?? emitWorkerEvent
  const timer = setInterval(() => {
    emit({ event: 'worker_heartbeat', taskQueue })
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
