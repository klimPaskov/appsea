import { AuthExternalIdentityPermissionError } from '@appsea/db/auth'
import {
  authRepository,
  mfaReauthenticationRequiredResponse,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ identityId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()
  const { identityId } = await context.params
  try {
    const unlinked = await authRepository().unlinkExternalIdentity(token, identityId)
    return Response.json(
      { data: { unlinked } },
      { headers: { 'cache-control': 'private, no-store' } }
    )
  } catch (error) {
    if (error instanceof AuthExternalIdentityPermissionError) {
      if (!(await authRepository().hasRecentReauthentication(token))) {
        return reauthenticationRequiredResponse()
      }
      return mfaReauthenticationRequiredResponse()
    }
    console.error('AppSea OIDC identity unlink failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to unlink identity' }, { status: 500 })
  }
}
