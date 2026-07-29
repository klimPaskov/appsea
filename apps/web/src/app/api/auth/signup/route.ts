import { authSignUpInputSchema } from '@appsea/contracts'
import { AuthenticationConflictError } from '@appsea/db/auth'
import { NextResponse } from 'next/server'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  sameOriginRequest,
  sessionCookieName,
  sessionCookieOptions
} from '../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  if (process.env.NODE_ENV === 'production' && process.env.APPSEA_AUTH_ALLOW_SIGNUP !== 'true') {
    return Response.json({ error: 'Account creation is disabled' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = authSignUpInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Email, password, and workspace name are required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.email, 'signup'))) {
      return Response.json(
        { error: 'Too many account-creation attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    const result = await authRepository().signUp(parsed.data)
    const response = NextResponse.json(
      { data: result.session },
      { status: 201, headers: privateResponseHeaders }
    )
    response.cookies.set(sessionCookieName, result.token, sessionCookieOptions())
    return response
  } catch (error) {
    if (error instanceof AuthenticationConflictError) {
      return invalidRequest('Unable to create account with those details')
    }
    console.error('AppSea signup failed', { name: error instanceof Error ? error.name : 'unknown' })
    return Response.json({ error: 'Unable to create account' }, { status: 500 })
  }
}
