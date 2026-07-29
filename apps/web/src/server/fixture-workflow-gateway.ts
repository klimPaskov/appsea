import {
  appseaIdentifierSchema,
  fixtureResearchWorkflowStartRequestSchema,
  type AuthSessionReadModel,
  type FixtureResearchWorkflowStartRequest,
  type WorkflowJobReadModel
} from '@appsea/contracts'

/**
 * Parse a workflow request at the web boundary. The path is authoritative and
 * the body must repeat the same workspace ID so callers cannot cross-wire a
 * durable workflow to another tenant.
 */
export function parseFixtureWorkflowStartRequest(
  pathWorkspaceId: string,
  payload: unknown
): FixtureResearchWorkflowStartRequest | null {
  const parsedPath = appseaIdentifierSchema.safeParse(pathWorkspaceId)
  if (!parsedPath.success) return null
  const parsedBody = fixtureResearchWorkflowStartRequestSchema.safeParse(payload)
  if (!parsedBody.success || parsedBody.data.workspaceId !== parsedPath.data) return null
  return parsedBody.data
}

export function workspaceFromSession(
  session: AuthSessionReadModel,
  workspaceId: string
): AuthSessionReadModel['workspaces'][number] | undefined {
  return session.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

export function canStartFixtureWorkflow(
  session: AuthSessionReadModel,
  workspaceId: string
): boolean {
  const workspace = workspaceFromSession(session, workspaceId)
  return (
    workspace?.fixtureOnly === true && (workspace.role === 'owner' || workspace.role === 'editor')
  )
}

export function canReadFixtureWorkflow(
  session: AuthSessionReadModel,
  workspaceId: string
): boolean {
  return workspaceFromSession(session, workspaceId) !== undefined
}

/** Return only stable, non-secret status fields to the browser. */
export function publicWorkflowStatus(status: WorkflowJobReadModel): {
  workflowId: string
  state: WorkflowJobReadModel['state']
  checkpoint: WorkflowJobReadModel['checkpoint']
  activityAttempts: number
  consumedSourceItems: number
  consumedCostMicros: number
  persistedRunId: string | null
  opportunityId: string | null
  scoreSnapshotId: string | null
  planPackageId: string | null
  failureCode: WorkflowJobReadModel['failureCode']
  failureSummary: string | null
  requestedAt: string
  startedAt: string
  updatedAt: string
  finishedAt: string | null
} {
  return {
    workflowId: status.workflowId,
    state: status.state,
    checkpoint: status.checkpoint,
    activityAttempts: status.activityAttempts,
    consumedSourceItems: status.consumedSourceItems,
    consumedCostMicros: status.consumedCostMicros,
    persistedRunId: status.persistedRunId,
    opportunityId: status.opportunityId,
    scoreSnapshotId: status.scoreSnapshotId,
    planPackageId: status.planPackageId,
    failureCode: status.failureCode,
    failureSummary: status.failureSummary,
    requestedAt: status.requestedAt,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    finishedAt: status.finishedAt
  }
}
