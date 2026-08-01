export interface WorkerEvent {
  event: string
  taskQueue: string
  jobId?: string
  workflowId?: string
  state?: string
  attempt?: number
  workspacesScanned?: number
  sourceItems?: number
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
  productionWorkflowAdmissionsPurged?: number
  sourceCollectionLeasesPurged?: number
  retentionTombstonesQueued?: number
  deletionTombstonesProcessed?: number
  deletionObjectsAffected?: number
  deletionOpportunitiesInvalidated?: number
  recomputationJobsQueued?: number
  failureCode?: string
}

function finiteInteger(value: number | undefined): number | undefined {
  return value === undefined || !Number.isSafeInteger(value) || value < 0 ? undefined : value
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
    ...(finiteInteger(event.productionWorkflowAdmissionsPurged) !== undefined
      ? {
          productionWorkflowAdmissionsPurged: finiteInteger(
            event.productionWorkflowAdmissionsPurged
          )
        }
      : {}),
    ...(finiteInteger(event.sourceCollectionLeasesPurged) !== undefined
      ? { sourceCollectionLeasesPurged: finiteInteger(event.sourceCollectionLeasesPurged) }
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
    ...(event.failureCode ? { failureCode: event.failureCode } : {})
  }
  console.log(JSON.stringify(payload))
}
