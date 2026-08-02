import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresSourcePolicyRepository } from '@appsea/db/source-policy'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function workspaceForSession(
  session: Awaited<ReturnType<typeof readSession>>,
  workspaceId: string
) {
  return session?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

/** Read-only source-policy readiness for a private workspace. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (!workspace || workspace.visibility !== 'private') return forbiddenResponse()

  try {
    const sources = await new PostgresSourcePolicyRepository(getDatabasePool()).listForUser(
      session.user.userId,
      parsedWorkspaceId.data
    )
    return Response.json({ data: sources }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea source registry read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read source coverage' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
