import {
  authMfaEnrollmentConfirmInputSchema,
  authMfaStatusReadModelSchema
} from '@appsea/contracts'
import { AuthMfaVerificationError } from '@appsea/db/auth'
import {
  authRepository,
  allowAuthAttempt,
  reauthenticationRequiredResponse,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSessionToken,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = authMfaEnrollmentConfirmInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Enter the six-digit authenticator code')
  if (!(await authRepository().hasRecentReauthentication(token))) {
    return reauthenticationRequiredResponse()
  }
  if (!(await allowAuthAttempt(request, token, 'mfa'))) {
    return Response.json(
      { error: 'Too many MFA attempts; try again later' },
      { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
    )
  }
  try {
    const data = authMfaStatusReadModelSchema.parse(
      await authRepository().confirmMfaEnrollment(token, parsed.data)
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthMfaVerificationError) {
      return Response.json(
        { error: 'The authenticator code is invalid or expired' },
        { status: 422 }
      )
    }
    console.error('AppSea MFA enrollment confirmation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to confirm MFA enrollment' }, { status: 500 })
  }
}
