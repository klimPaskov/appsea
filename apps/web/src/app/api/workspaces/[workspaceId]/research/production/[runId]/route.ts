import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresProductionCollectionRepository } from '@appsea/db/production-collection'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; runId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, runId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedRunId = appseaIdentifierSchema.safeParse(runId)
  if (!parsedWorkspaceId.success || !parsedRunId.success) {
    return Response.json({ error: 'Invalid production collection path' }, { status: 400 })
  }
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) return forbiddenResponse()
  const data = await new PostgresProductionCollectionRepository(getDatabasePool()).readForUser(
    session.user.userId,
    parsedWorkspaceId.data,
    parsedRunId.data
  )
  if (!data) {
    return Response.json({ error: 'Production collection was not found' }, { status: 404 })
  }
  return Response.json({ data }, { headers: privateResponseHeaders })
}
