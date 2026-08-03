import { appseaIdentifierSchema } from '@appsea/contracts'
import {
  ManualImportPermissionError,
  ManualImportUnavailableError,
  PostgresManualImportRepository
} from '@appsea/db'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function workspaceForSession(
  session: Awaited<ReturnType<typeof readSession>>,
  workspaceId: string
) {
  return session?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; batchId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, batchId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedBatchId = appseaIdentifierSchema.safeParse(batchId)
  if (!parsedWorkspaceId.success || !parsedBatchId.success) {
    return invalidRequest('Invalid import path')
  }
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (!workspace || workspace.visibility !== 'private') return forbiddenResponse()
  try {
    const batch = await new PostgresManualImportRepository(getDatabasePool()).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedBatchId.data
    )
    if (!batch)
      return Response.json(
        { error: 'Import batch not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    return Response.json({ data: batch }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea manual import read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read private import' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

/** Delete a staged or consumed batch; downstream source/evidence rows are tombstoned. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; batchId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, batchId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedBatchId = appseaIdentifierSchema.safeParse(batchId)
  if (!parsedWorkspaceId.success || !parsedBatchId.success) {
    return invalidRequest('Invalid import path')
  }
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (!workspace || workspace.visibility !== 'private' || workspace.role !== 'owner') {
    return forbiddenResponse()
  }
  try {
    const result = await new PostgresManualImportRepository(
      getDatabasePool()
    ).requestDeletionForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedBatchId.data,
      new Date().toISOString()
    )
    return Response.json({ data: result }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ManualImportPermissionError) return forbiddenResponse()
    if (error instanceof ManualImportUnavailableError) {
      return Response.json(
        { error: error.message },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea manual import deletion failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to delete private import' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
