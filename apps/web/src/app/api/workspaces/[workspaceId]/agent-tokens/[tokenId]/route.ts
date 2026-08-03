import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresAgentAccessTokenRepository } from '@appsea/db/agent-access-token'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  mfaReauthenticationRequiredResponse,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; tokenId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, tokenId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedTokenId = appseaIdentifierSchema.safeParse(tokenId)
  if (!parsedWorkspaceId.success || !parsedTokenId.success) {
    return invalidRequest('Invalid agent access token')
  }
  const workspace = session.workspaces.find(
    (candidate) =>
      candidate.workspaceId === parsedWorkspaceId.data &&
      candidate.visibility === 'private' &&
      candidate.role === 'owner'
  )
  if (!workspace) return forbiddenResponse()
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  if (!(await authRepository().hasRecentReauthentication(token))) {
    return reauthenticationRequiredResponse()
  }
  if (!(await authRepository().hasRecentMfaReauthentication(token))) {
    return mfaReauthenticationRequiredResponse()
  }

  try {
    const revoked = await new PostgresAgentAccessTokenRepository(getDatabasePool()).revoke(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedTokenId.data
    )
    if (!revoked) {
      return Response.json(
        { error: 'Agent access token was not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: { revoked: true } }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea agent access token revocation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to revoke agent access token' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
