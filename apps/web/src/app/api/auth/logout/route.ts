import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  authRepository,
  privateResponseHeaders,
  sameOriginRequest,
  sessionCookieName,
  sessionCookieOptions
} from '../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const token = (await cookies()).get(sessionCookieName)?.value
  if (token) {
    try {
      await authRepository().revokeSession(token)
    } catch (error) {
      console.error('AppSea logout revocation failed', {
        name: error instanceof Error ? error.name : 'unknown'
      })
      return Response.json(
        { error: 'Unable to revoke the session; try again shortly' },
        { status: 503, headers: privateResponseHeaders }
      )
    }
  }
  const response = NextResponse.json(
    { data: { signedOut: true } },
    { headers: privateResponseHeaders }
  )
  response.cookies.set(sessionCookieName, '', { ...sessionCookieOptions(), maxAge: 0 })
  return response
}
