import {
  agentAccessTokenCreateInputSchema,
  appseaIdentifierSchema,
  type AuthSessionReadModel
} from '@appsea/contracts'
import { PostgresAgentAccessTokenRepository } from '@appsea/db/agent-access-token'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function ownerWorkspace(session: AuthSessionReadModel, workspaceId: string) {
  return session.workspaces.find(
    (workspace) =>
      workspace.workspaceId === workspaceId &&
      workspace.visibility === 'private' &&
      workspace.role === 'owner'
  )
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')
  if (!ownerWorkspace(session, parsedWorkspaceId.data)) return forbiddenResponse()

  try {
    const data = await new PostgresAgentAccessTokenRepository(getDatabasePool()).listForOwner(
      session.user.userId,
      parsedWorkspaceId.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea agent access token listing failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read agent access tokens' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')
  if (!ownerWorkspace(session, parsedWorkspaceId.data)) return forbiddenResponse()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = agentAccessTokenCreateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid token label, scopes, and expiry are required')

  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  if (!(await authRepository().hasRecentReauthentication(token))) {
    return reauthenticationRequiredResponse()
  }

  try {
    const data = await new PostgresAgentAccessTokenRepository(getDatabasePool()).create(
      session.user.userId,
      parsedWorkspaceId.data,
      parsed.data
    )
    return Response.json({ data }, { status: 201, headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea agent access token creation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to create agent access token' },
      { status: 409, headers: privateResponseHeaders }
    )
  }
}
