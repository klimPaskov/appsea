import { authMfaDisableInputSchema, authMfaStatusReadModelSchema } from '@appsea/contracts'
import { AuthMfaNotEnabledError, AuthMfaVerificationError } from '@appsea/db/auth'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()
  if (!(await authRepository().hasRecentReauthentication(token))) {
    return reauthenticationRequiredResponse()
  }
  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = authMfaDisableInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Enter an authenticator or recovery code')
  if (!(await allowAuthAttempt(request, session.user.email, 'mfa'))) {
    return Response.json(
      { error: 'Too many MFA attempts; try again later' },
      { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
    )
  }
  try {
    const data = authMfaStatusReadModelSchema.parse(
      await authRepository().disableMfa(token, parsed.data)
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthMfaVerificationError) {
      return Response.json({ error: 'The MFA code is invalid or expired' }, { status: 422 })
    }
    if (error instanceof AuthMfaNotEnabledError) {
      return Response.json({ error: 'MFA is not enabled' }, { status: 409 })
    }
    console.error('AppSea MFA disable failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to disable MFA' }, { status: 500 })
  }
}
