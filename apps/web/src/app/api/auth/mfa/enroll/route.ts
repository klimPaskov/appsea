import { authMfaEnrollmentReadModelSchema } from '@appsea/contracts'
import { AuthMfaAlreadyEnabledError, AuthMfaConfigurationError } from '@appsea/db/auth'
import {
  authRepository,
  privateResponseHeaders,
  readSessionToken,
  sameOriginRequest,
  unauthorizedResponse,
  reauthenticationRequiredResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  try {
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    const data = authMfaEnrollmentReadModelSchema.parse(
      await authRepository().beginMfaEnrollment(token)
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthMfaAlreadyEnabledError) {
      return Response.json({ error: 'MFA is already enabled' }, { status: 409 })
    }
    if (error instanceof AuthMfaConfigurationError) {
      return Response.json({ error: 'MFA enrollment is temporarily unavailable' }, { status: 503 })
    }
    if (error instanceof Error && error.message === 'Authentication session was not found') {
      return unauthorizedResponse()
    }
    console.error('AppSea MFA enrollment start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to begin MFA enrollment' }, { status: 500 })
  }
}
