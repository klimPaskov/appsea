import {
  appseaIdentifierSchema,
  productionCollectionWorkflowStartRequestSchema,
  type AuthSessionReadModel,
  type ProductionCollectionWorkflowStartRequest
} from '@appsea/contracts'

export function parseProductionWorkflowStartRequest(
  pathWorkspaceId: string,
  payload: unknown
): ProductionCollectionWorkflowStartRequest | null {
  const parsedPath = appseaIdentifierSchema.safeParse(pathWorkspaceId)
  if (!parsedPath.success) return null
  const parsedBody = productionCollectionWorkflowStartRequestSchema.safeParse(payload)
  if (!parsedBody.success || parsedBody.data.workspaceId !== parsedPath.data) return null
  return parsedBody.data
}

export function productionWorkspaceFromSession(
  session: AuthSessionReadModel,
  workspaceId: string
): AuthSessionReadModel['workspaces'][number] | undefined {
  return session.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

export function canStartProductionWorkflow(
  session: AuthSessionReadModel,
  workspaceId: string
): boolean {
  const workspace = productionWorkspaceFromSession(session, workspaceId)
  return (
    workspace?.fixtureOnly === false &&
    workspace.visibility === 'private' &&
    (workspace.role === 'owner' || workspace.role === 'editor')
  )
}

export function canReadProductionWorkflow(
  session: AuthSessionReadModel,
  workspaceId: string
): boolean {
  return productionWorkspaceFromSession(session, workspaceId) !== undefined
}

export function productionWorkflowBelongsToWorkspace(
  workflowId: string,
  workspaceId: string
): boolean {
  return workflowBelongsToWorkspaceWithPrefix(workflowId, workspaceId, 'workflow:production:')
}

export function productionAnalysisWorkflowBelongsToWorkspace(
  workflowId: string,
  workspaceId: string
): boolean {
  return workflowBelongsToWorkspaceWithPrefix(workflowId, workspaceId, 'workflow:analysis:')
}

function workflowBelongsToWorkspaceWithPrefix(
  workflowId: string,
  workspaceId: string,
  prefix: string
): boolean {
  if (!workflowId.startsWith(prefix)) return false
  const remainder = workflowId.slice(prefix.length)
  const separator = remainder.lastIndexOf(':')
  if (separator <= 0) return false
  const workflowWorkspaceId = remainder.slice(0, separator)
  const digest = remainder.slice(separator + 1)
  return workflowWorkspaceId === workspaceId && /^[a-f0-9]{32}$/.test(digest)
}
