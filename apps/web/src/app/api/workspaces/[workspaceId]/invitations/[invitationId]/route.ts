import { appseaIdentifierSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspaceInvitationError,
  WorkspaceMembershipManagementError
} from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  mfaReauthenticationRequiredResponse,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; invitationId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.APPSEA_AUTH_INVITATIONS_ENABLED !== 'true'
  ) {
    return Response.json(
      { error: 'Workspace invitations are temporarily unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const params = await context.params
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const invitationId = appseaIdentifierSchema.safeParse(params.invitationId)
  if (!workspaceId.success || !invitationId.success) return invalidRequest('Invalid invitation')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    await authRepository().revokeWorkspaceInvitation(
      session.user.userId,
      workspaceId.data,
      invitationId.data
    )
    return Response.json({ data: { revoked: true } }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspaceMembershipManagementError
    ) {
      return forbiddenResponse()
    }
    if (error instanceof WorkspaceInvitationError) {
      return Response.json(
        { error: 'That invitation is no longer pending' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea workspace invitation revocation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to revoke workspace invitation' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
