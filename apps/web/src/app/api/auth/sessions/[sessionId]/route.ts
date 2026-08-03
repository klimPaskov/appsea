import { appseaIdentifierSchema } from '@appsea/contracts'
import { AuthSessionConflictError, AuthSessionNotFoundError } from '@appsea/db/auth'
import {
  authRepository,
  invalidRequest,
  mfaReauthenticationRequiredResponse,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )

  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()

  const { sessionId } = await context.params
  const parsedSessionId = appseaIdentifierSchema.safeParse(sessionId)
  if (!parsedSessionId.success) return invalidRequest('Invalid authentication session')

  try {
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    await authRepository().revokeSessionById(token, parsedSessionId.data)
    return Response.json({ data: { revoked: true } }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthSessionConflictError) {
      return Response.json(
        { error: 'The current session cannot be revoked' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof AuthSessionNotFoundError) {
      return Response.json(
        { error: 'Authentication session was not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea authentication session revocation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to revoke authentication session' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
