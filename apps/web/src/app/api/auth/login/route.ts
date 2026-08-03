import { authSignInInputSchema } from '@appsea/contracts'
import { AuthenticationError } from '@appsea/db/auth'
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
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = authSignInInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Email and password are required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.email, 'login'))) {
      return Response.json(
        { error: 'Too many sign-in attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    const result = await authRepository().signIn(parsed.data)
    if (result.mfaRequired) {
      return Response.json({ data: result }, { headers: privateResponseHeaders })
    }
    const response = NextResponse.json(
      { data: result.session },
      { headers: privateResponseHeaders }
    )
    response.cookies.set(sessionCookieName, result.token, sessionCookieOptions())
    return response
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    console.error('AppSea login failed', { name: error instanceof Error ? error.name : 'unknown' })
    return Response.json({ error: 'Unable to sign in' }, { status: 500 })
  }
}
