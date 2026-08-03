import { NextResponse } from 'next/server'
import {
  buildOidcAuthorizationUrl,
  createOidcState,
  discoverOidcProvider,
  encodeOidcState,
  oidcConfigFromEnv,
  oidcIsConfigured,
  oidcStateCookieName,
  oidcStateCookieOptions,
  sessionHash,
  type OidcFlowMode
} from '../../../../../server/oidc'
import {
  allowAuthAttempt,
  authRepository,
  readSession,
  readSessionToken,
  mfaReauthenticationRequiredResponse,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

function invalidMode(): Response {
  return Response.json({ error: 'Invalid identity-provider flow' }, { status: 400 })
}

function rateLimited(): Response {
  return Response.json(
    { error: 'Too many identity-provider attempts; try again later' },
    { status: 429, headers: { 'cache-control': 'private, no-store', 'retry-after': '900' } }
  )
}

async function startFlow(request: Request, mode: OidcFlowMode): Promise<Response> {
  if (!oidcIsConfigured()) {
    return Response.json({ error: 'Identity-provider sign-in is unavailable' }, { status: 404 })
  }

  let sessionToken: string | null = null
  let rateLimitEmail = 'oidc'
  if (mode === 'link') {
    sessionToken = await readSessionToken()
    const session = sessionToken ? await readSession() : null
    if (!session || !sessionToken) return unauthorizedResponse()
    rateLimitEmail = session.user.email
    if (!(await authRepository().hasRecentReauthentication(sessionToken))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(sessionToken))) {
      return mfaReauthenticationRequiredResponse()
    }
  }

  try {
    if (!(await allowAuthAttempt(request, rateLimitEmail, 'oidc'))) return rateLimited()
    const config = oidcConfigFromEnv()
    if (!config)
      return Response.json({ error: 'Identity-provider sign-in is unavailable' }, { status: 404 })
    const discovery = await discoverOidcProvider(config)
    const state = createOidcState(mode, sessionToken ? sessionHash(sessionToken) : null)
    const response = NextResponse.redirect(buildOidcAuthorizationUrl(config, discovery, state), 302)
    response.headers.set('cache-control', 'private, no-store')
    response.headers.set('referrer-policy', 'no-referrer')
    response.cookies.set(oidcStateCookieName, encodeOidcState(state), oidcStateCookieOptions())
    return response
  } catch (error) {
    console.error('AppSea OIDC start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Identity-provider sign-in is temporarily unavailable' },
      { status: 503 }
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  const modeValue = new URL(request.url).searchParams.get('mode') ?? 'login'
  if (modeValue !== 'login' && modeValue !== 'link') return invalidMode()
  if (modeValue === 'link') {
    return Response.json(
      { error: 'Identity linking must use a same-origin form submission' },
      { status: 405, headers: { allow: 'POST' } }
    )
  }
  return startFlow(request, 'login')
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  return startFlow(request, 'link')
}
