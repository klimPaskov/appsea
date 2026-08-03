import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as startOidc, POST as startOidcLink } from './api/auth/oidc/start/route'
import { GET as callbackOidc } from './api/auth/oidc/callback/route'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  allowAuthAttempt: vi.fn(),
  oidcIsConfigured: vi.fn(),
  oidcConfigFromEnv: vi.fn(),
  discoverOidcProvider: vi.fn(),
  createOidcState: vi.fn(),
  encodeOidcState: vi.fn(),
  buildOidcAuthorizationUrl: vi.fn(),
  decodeOidcState: vi.fn(),
  stateMatches: vi.fn(),
  exchangeOidcCode: vi.fn(),
  verifyOidcIdToken: vi.fn(),
  sessionHash: vi.fn(),
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  repository: {
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn(),
    linkExternalIdentity: vi.fn(),
    signInWithExternalIdentity: vi.fn()
  },
  sameOriginRequest: vi.fn()
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('../server/oidc', () => ({
  buildOidcAuthorizationUrl: mocks.buildOidcAuthorizationUrl,
  createOidcState: mocks.createOidcState,
  decodeOidcState: mocks.decodeOidcState,
  discoverOidcProvider: mocks.discoverOidcProvider,
  encodeOidcState: mocks.encodeOidcState,
  exchangeOidcCode: mocks.exchangeOidcCode,
  oidcConfigFromEnv: mocks.oidcConfigFromEnv,
  oidcIsConfigured: mocks.oidcIsConfigured,
  oidcMfaChallengeCookieName: 'appsea_oidc_mfa',
  oidcMfaChallengeCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 600,
    priority: 'high'
  }),
  oidcStateCookieName: 'appsea_oidc_state',
  oidcStateCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 600,
    priority: 'high'
  }),
  sessionHash: mocks.sessionHash,
  stateMatches: mocks.stateMatches,
  verifyOidcIdToken: mocks.verifyOidcIdToken,
  OidcProviderError: class OidcProviderError extends Error {},
  OidcTokenVerificationError: class OidcTokenVerificationError extends Error {}
}))
vi.mock('../server/auth-session', () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
  authRepository: () => mocks.repository,
  mfaReauthenticationRequiredResponse: () =>
    Response.json({ error: 'MFA step-up required' }, { status: 428 }),
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json({ error: 'Password step-up required' }, { status: 428 }),
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 }),
  sessionCookieName: 'appsea_session',
  sessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 2_592_000,
    priority: 'high'
  })
}))

const token = 'a'.repeat(48)
const state = {
  state: 's'.repeat(43),
  nonce: 'n'.repeat(43),
  codeVerifier: 'v'.repeat(43),
  mode: 'login' as const,
  sessionHash: null,
  issuedAt: Math.floor(Date.now() / 1_000)
}
const config = {
  issuer: 'https://issuer.example.test',
  clientId: 'client',
  clientSecret: 'secret',
  redirectUri: 'https://appsea.example.test/api/auth/oidc/callback',
  endpointOrigins: ['https://issuer.example.test']
}
const discovery = {
  issuer: config.issuer,
  authorizationEndpoint: `${config.issuer}/authorize`,
  tokenEndpoint: `${config.issuer}/token`,
  jwksUri: `${config.issuer}/jwks`
}

describe('OIDC authentication routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'state-cookie' })) })
    mocks.oidcIsConfigured.mockReturnValue(true)
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.oidcConfigFromEnv.mockReturnValue(config)
    mocks.discoverOidcProvider.mockResolvedValue(discovery)
    mocks.createOidcState.mockReturnValue(state)
    mocks.encodeOidcState.mockReturnValue('state-cookie')
    mocks.buildOidcAuthorizationUrl.mockReturnValue(
      'https://issuer.example.test/authorize?state=ssss'
    )
    mocks.decodeOidcState.mockReturnValue(state)
    mocks.stateMatches.mockReturnValue(true)
    mocks.exchangeOidcCode.mockResolvedValue('id-token')
    mocks.sessionHash.mockReturnValue('h'.repeat(64))
    mocks.verifyOidcIdToken.mockResolvedValue({
      issuer: config.issuer,
      subject: 'subject',
      email: 'user@example.com',
      emailVerified: true
    })
    mocks.readSessionToken.mockResolvedValue(token)
    mocks.readSession.mockResolvedValue({
      user: { userId: 'user:one', email: 'user@example.com' }
    })
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.signInWithExternalIdentity.mockResolvedValue({
      mfaRequired: false,
      token: 'b'.repeat(48),
      session: { user: { userId: 'user:one' } }
    })
  })

  it('keeps the provider disabled boundary private and rejects GET link starts', async () => {
    mocks.oidcIsConfigured.mockReturnValue(false)
    expect(
      (await startOidc(new Request('https://appsea.example/api/auth/oidc/start'))).status
    ).toBe(404)

    mocks.oidcIsConfigured.mockReturnValue(true)
    const response = await startOidc(
      new Request('https://appsea.example/api/auth/oidc/start?mode=link')
    )
    expect(response.status).toBe(405)
    expect(mocks.discoverOidcProvider).not.toHaveBeenCalled()
  })

  it('requires same-origin POST for an authenticated link start', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    expect(
      (await startOidcLink(new Request('https://appsea.example/api/auth/oidc/start'))).status
    ).toBe(403)
    mocks.sameOriginRequest.mockReturnValue(true)
    const response = await startOidcLink(
      new Request('https://appsea.example/api/auth/oidc/start', { method: 'POST' })
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.createOidcState).toHaveBeenCalledWith('link', expect.any(String))
  })

  it('starts a PKCE flow and binds the state cookie before redirecting', async () => {
    const response = await startOidc(
      new Request('https://appsea.example/api/auth/oidc/start?mode=login')
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('location')).toBe(
      'https://issuer.example.test/authorize?state=ssss'
    )
    expect(response.headers.get('set-cookie')).toContain('appsea_oidc_state=state-cookie')
    expect(mocks.createOidcState).toHaveBeenCalledWith('login', null)
  })

  it('fails closed when the callback state does not match the browser cookie', async () => {
    mocks.stateMatches.mockReturnValue(false)
    const response = await callbackOidc(
      new Request('https://appsea.example/api/auth/oidc/callback?state=wrong&code=code')
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('location')).toContain('/login?oidc=invalid_state')
    expect(mocks.exchangeOidcCode).not.toHaveBeenCalled()
  })

  it('issues an AppSea session only after a successful linked identity callback', async () => {
    const response = await callbackOidc(
      new Request('https://appsea.example/api/auth/oidc/callback?state=ssss&code=code')
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/workspace')
    expect(response.headers.get('set-cookie')).toContain('appsea_session=')
    expect(mocks.repository.signInWithExternalIdentity).toHaveBeenCalledWith({
      issuer: config.issuer,
      subject: 'subject',
      email: 'user@example.com',
      emailVerified: true
    })
  })

  it('keeps a local MFA challenge in an HttpOnly cookie after an OIDC callback', async () => {
    mocks.repository.signInWithExternalIdentity.mockResolvedValue({
      mfaRequired: true,
      challengeToken: 'c'.repeat(48),
      expiresAt: '2026-08-03T00:10:00.000Z'
    })
    const response = await callbackOidc(
      new Request('https://appsea.example/api/auth/oidc/callback?state=ssss&code=code')
    )
    expect(response.headers.get('location')).toContain('/login?oidc_mfa=1')
    expect(response.headers.get('set-cookie')).toContain('appsea_oidc_mfa=')
    expect(response.headers.get('set-cookie')).not.toContain('appsea_session=')
  })

  it('binds an identity-link callback to the original session hash', async () => {
    mocks.decodeOidcState.mockReturnValue({ ...state, mode: 'link', sessionHash: 'h'.repeat(64) })
    mocks.sessionHash.mockReturnValue('h'.repeat(64))
    const response = await callbackOidc(
      new Request('https://appsea.example/api/auth/oidc/callback?state=ssss&code=code')
    )
    expect(response.headers.get('location')).toContain('/account/security?oidc=linked')
    expect(mocks.repository.linkExternalIdentity).toHaveBeenCalledWith(token, {
      issuer: config.issuer,
      subject: 'subject',
      email: 'user@example.com',
      emailVerified: true
    })
  })
})
