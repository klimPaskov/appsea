import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  AuthExternalIdentityConflictError,
  AuthExternalIdentityNotFoundError,
  AuthExternalIdentityPermissionError
} from '@appsea/db/auth'
import {
  exchangeOidcCode,
  decodeOidcState,
  discoverOidcProvider,
  oidcConfigFromEnv,
  oidcMfaChallengeCookieName,
  oidcMfaChallengeCookieOptions,
  oidcStateCookieName,
  oidcStateCookieOptions,
  sessionHash,
  stateMatches,
  verifyOidcIdToken,
  OidcProviderError,
  OidcTokenVerificationError
} from '../../../../../server/oidc'
import {
  authRepository,
  readSessionToken,
  sessionCookieName,
  sessionCookieOptions
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

function redirectWithStateCleared(request: Request, path: string): NextResponse {
  let baseUrl = request.url
  const configuredOrigin = process.env.APPSEA_PUBLIC_ORIGIN?.trim()
  if (configuredOrigin) {
    try {
      baseUrl = new URL(configuredOrigin).origin
    } catch {
      // Production preflight rejects an invalid public origin. Keep local
      // development redirects usable when the optional setting is absent.
    }
  }
  const response = NextResponse.redirect(new URL(path, baseUrl), 302)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.cookies.set(oidcStateCookieName, '', { ...oidcStateCookieOptions(), maxAge: 0 })
  return response
}

function errorPath(mode: 'login' | 'link', code: string): string {
  return mode === 'link'
    ? `/account/security?oidc=${encodeURIComponent(code)}`
    : `/login?oidc=${encodeURIComponent(code)}`
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const stateValue = (await cookies()).get(oidcStateCookieName)?.value
  if (!stateValue) return redirectWithStateCleared(request, '/login?oidc=expired')

  let state: ReturnType<typeof decodeOidcState>
  try {
    state = decodeOidcState(stateValue)
  } catch {
    return redirectWithStateCleared(request, '/login?oidc=invalid_state')
  }
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (state.issuedAt > nowSeconds + 60 || nowSeconds - state.issuedAt > 10 * 60) {
    return redirectWithStateCleared(request, errorPath(state.mode, 'expired'))
  }
  const returnedState = requestUrl.searchParams.get('state')
  if (!returnedState || !stateMatches(state.state, returnedState)) {
    return redirectWithStateCleared(request, errorPath(state.mode, 'invalid_state'))
  }
  if (requestUrl.searchParams.get('error')) {
    return redirectWithStateCleared(request, errorPath(state.mode, 'cancelled'))
  }
  const code = requestUrl.searchParams.get('code')
  if (!code) return redirectWithStateCleared(request, errorPath(state.mode, 'invalid_response'))

  try {
    const config = oidcConfigFromEnv()
    if (!config) return redirectWithStateCleared(request, errorPath(state.mode, 'unavailable'))
    const discovery = await discoverOidcProvider(config)
    const idToken = await exchangeOidcCode(config, discovery, code, state.codeVerifier)
    const claims = await verifyOidcIdToken(idToken, config, discovery, state.nonce)

    if (state.mode === 'link') {
      const token = await readSessionToken()
      if (!token || !state.sessionHash || sessionHash(token) !== state.sessionHash) {
        return redirectWithStateCleared(request, '/login?oidc=sign_in_required')
      }
      await authRepository().linkExternalIdentity(token, claims)
      return redirectWithStateCleared(request, '/account/security?oidc=linked')
    }

    const result = await authRepository().signInWithExternalIdentity(claims)
    if (result.mfaRequired) {
      const response = redirectWithStateCleared(request, '/login?oidc_mfa=1')
      response.cookies.set(
        oidcMfaChallengeCookieName,
        result.challengeToken,
        oidcMfaChallengeCookieOptions()
      )
      return response
    }
    const response = redirectWithStateCleared(request, '/workspace')
    response.cookies.set(sessionCookieName, result.token, sessionCookieOptions())
    return response
  } catch (error) {
    if (error instanceof AuthExternalIdentityNotFoundError) {
      return redirectWithStateCleared(request, '/login?oidc=not_linked')
    }
    if (error instanceof AuthExternalIdentityConflictError) {
      return redirectWithStateCleared(request, errorPath(state.mode, 'already_linked'))
    }
    if (error instanceof AuthExternalIdentityPermissionError) {
      return redirectWithStateCleared(request, errorPath(state.mode, 'step_up_required'))
    }
    if (!(error instanceof OidcProviderError || error instanceof OidcTokenVerificationError)) {
      console.error('AppSea OIDC callback failed', {
        name: error instanceof Error ? error.name : 'unknown'
      })
    }
    return redirectWithStateCleared(request, errorPath(state.mode, 'unavailable'))
  }
}
