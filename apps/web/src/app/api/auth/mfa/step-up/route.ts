import { authMfaStepUpInputSchema, authMfaStepUpResultSchema } from '@appsea/contracts'
import {
  AuthMfaConfigurationError,
  AuthMfaNotEnabledError,
  AuthMfaVerificationError
} from '@appsea/db/auth'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

/** Establish a short-lived MFA step-up for high-risk bearer-token actions. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = authMfaStepUpInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Enter an authenticator or recovery code')
  if (!(await allowAuthAttempt(request, session.user.email, 'mfa'))) {
    return Response.json(
      { error: 'Too many MFA attempts; try again later' },
      { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
    )
  }

  try {
    await authRepository().reauthenticateMfaSession(token, parsed.data)
    const data = authMfaStepUpResultSchema.parse({ verified: true })
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthMfaVerificationError) {
      return Response.json({ error: 'The MFA code is invalid or expired' }, { status: 422 })
    }
    if (error instanceof AuthMfaNotEnabledError) {
      return Response.json({ error: 'MFA is not enabled' }, { status: 409 })
    }
    if (error instanceof AuthMfaConfigurationError) {
      return Response.json({ error: 'MFA step-up is temporarily unavailable' }, { status: 503 })
    }
    console.error('AppSea MFA step-up failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to verify MFA step-up' }, { status: 500 })
  }
}
