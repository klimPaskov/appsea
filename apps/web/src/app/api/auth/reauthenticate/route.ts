import { authReauthenticationInputSchema } from '@appsea/contracts'
import { AuthenticationError } from '@appsea/db/auth'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSession,
  readSessionToken,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })

  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()

  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = authReauthenticationInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid password is required')

  try {
    if (!(await allowAuthAttempt(request, session.user.email, 'reauthenticate'))) {
      return Response.json(
        { error: 'Too many reauthentication attempts' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    await authRepository().reauthenticateSession(token, parsed.data)
    return Response.json({ data: { reauthenticated: true } }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json(
        { error: 'Reauthentication failed' },
        { status: 401, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea session reauthentication failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to reauthenticate session' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
