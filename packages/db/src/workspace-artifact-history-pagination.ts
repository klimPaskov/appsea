import {
  appseaIdentifierSchema,
  workspaceArtifactHistoryCursorSchema,
  type WorkspaceArtifactHistoryCursor
} from '@appsea/contracts'

export type WorkspaceArtifactHistoryCursorKind = 'reports' | 'plans'

export class WorkspaceArtifactHistoryCursorError extends Error {
  constructor() {
    super('Workspace artifact history cursor is invalid')
    this.name = 'WorkspaceArtifactHistoryCursorError'
  }
}

export function encodeWorkspaceArtifactHistoryCursor(
  workspaceId: string,
  opportunityId: string,
  kind: WorkspaceArtifactHistoryCursorKind,
  generatedAt: string,
  itemId: string
): string {
  const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
  const parsed = workspaceArtifactHistoryCursorSchema.parse({
    version: 1,
    generatedAt,
    itemId
  })
  return Buffer.from(
    JSON.stringify({
      ...parsed,
      workspaceId: parsedWorkspaceId,
      opportunityId: parsedOpportunityId,
      kind
    }),
    'utf8'
  ).toString('base64url')
}

export function decodeWorkspaceArtifactHistoryCursor(
  value: string,
  expectedWorkspaceId: string,
  expectedOpportunityId: string,
  expectedKind: WorkspaceArtifactHistoryCursorKind
): WorkspaceArtifactHistoryCursor {
  try {
    const workspaceId = appseaIdentifierSchema.parse(expectedWorkspaceId)
    const opportunityId = appseaIdentifierSchema.parse(expectedOpportunityId)
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const candidate = JSON.parse(decoded) as unknown
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      (candidate as { workspaceId?: unknown }).workspaceId !== workspaceId ||
      (candidate as { opportunityId?: unknown }).opportunityId !== opportunityId ||
      (candidate as { kind?: unknown }).kind !== expectedKind
    ) {
      throw new Error('Workspace artifact history cursor scope mismatch')
    }
    const payload = { ...(candidate as Record<string, unknown>) }
    delete payload.workspaceId
    delete payload.opportunityId
    delete payload.kind
    return workspaceArtifactHistoryCursorSchema.parse(payload)
  } catch {
    throw new WorkspaceArtifactHistoryCursorError()
  }
}
