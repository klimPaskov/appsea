import { authMfaSignInInputSchema } from '@appsea/contracts'
import { AuthMfaVerificationError } from '@appsea/db/auth'
import { NextResponse } from 'next/server'
import {
  oidcMfaChallengeCookieName,
  oidcMfaChallengeCookieOptions
} from '../../../../../server/oidc'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  readOidcMfaChallengeToken,
  sameOriginRequest,
  sessionCookieName,
  sessionCookieOptions
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  let parsed = authMfaSignInInputSchema.safeParse(payload)
  let oidcChallenge = false
  if (!parsed.success && typeof payload === 'object' && payload !== null && 'code' in payload) {
    const challengeToken = await readOidcMfaChallengeToken()
    parsed = authMfaSignInInputSchema.safeParse({
      challengeToken,
      code: (payload as { code?: unknown }).code
    })
    oidcChallenge = parsed.success
  }
  if (!parsed.success) return invalidRequest('A valid MFA challenge and code are required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.challengeToken, 'mfa'))) {
      return Response.json(
        { error: 'Too many MFA attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    const result = await authRepository().completeMfaSignIn(parsed.data)
    if (result.mfaRequired)
      return Response.json({ error: 'MFA verification failed' }, { status: 401 })
    const response = NextResponse.json(
      { data: result.session },
      { headers: privateResponseHeaders }
    )
    response.cookies.set(sessionCookieName, result.token, sessionCookieOptions())
    if (oidcChallenge) {
      response.cookies.set(oidcMfaChallengeCookieName, '', {
        ...oidcMfaChallengeCookieOptions(),
        maxAge: 0
      })
    }
    return response
  } catch (error) {
    if (error instanceof AuthMfaVerificationError) {
      return Response.json({ error: 'The MFA code is invalid or expired' }, { status: 401 })
    }
    console.error('AppSea MFA sign-in failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to verify MFA' }, { status: 500 })
  }
}
