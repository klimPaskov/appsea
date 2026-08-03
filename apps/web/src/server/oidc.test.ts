import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildOidcAuthorizationUrl,
  createOidcState,
  decodeOidcState,
  discoverOidcProvider,
  encodeOidcState,
  assertOidcEndpointNetworkSafety,
  oidcConfigFromEnv,
  OidcConfigurationError,
  stateMatches,
  verifyOidcIdToken,
  type OidcDiscoveryDocument
} from './oidc'

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signedIdToken(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = encoded({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
  const payload = encoded(claims)
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`
}

const config = {
  issuer: 'https://issuer.example.test',
  clientId: 'appsea-client',
  clientSecret: 'secret-value',
  redirectUri: 'https://appsea.example.test/api/auth/oidc/callback',
  endpointOrigins: ['https://issuer.example.test']
} as const

const discovery: OidcDiscoveryDocument = {
  issuer: config.issuer,
  authorizationEndpoint: `${config.issuer}/authorize`,
  tokenEndpoint: `${config.issuer}/token`,
  jwksUri: `${config.issuer}/jwks`
}

describe('OIDC boundary', () => {
  it('fails closed for partial or insecure production configuration', () => {
    expect(
      oidcConfigFromEnv({ NODE_ENV: 'production', APPSEA_AUTH_OIDC_ENABLED: 'false' })
    ).toBeNull()
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_ISSUER: 'http://issuer.example.test',
        APPSEA_AUTH_OIDC_REDIRECT_URI: 'https://appsea.example.test/api/auth/oidc/callback',
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
    for (const issuer of [
      'https://[::ffff:192.168.1.1]',
      'https://[::ffff:10.0.0.1]',
      'https://[::]',
      'https://[ff02::1]',
      'https://[::192.168.1.1]',
      'https://[fec0::1]'
    ]) {
      expect(() =>
        oidcConfigFromEnv({
          NODE_ENV: 'production',
          APPSEA_AUTH_OIDC_ENABLED: 'true',
          APPSEA_AUTH_OIDC_REVIEWED: 'true',
          APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
          APPSEA_AUTH_OIDC_ISSUER: issuer,
          APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
          APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
          APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
        })
      ).toThrow(OidcConfigurationError)
    }
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_REVIEWED: 'true',
        APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
        APPSEA_AUTH_OIDC_ISSUER: 'https://10.0.0.1',
        APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_REVIEWED: 'true',
        APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
        APPSEA_AUTH_OIDC_ISSUER: 'https://localhost...',
        APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_REVIEWED: 'true',
        APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
        APPSEA_AUTH_OIDC_ISSUER: config.issuer,
        APPSEA_AUTH_OIDC_REDIRECT_URI: 'https://appsea.example.test/wrong',
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_ISSUER: 'https://issuer.example.test/tenant',
        APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
  })

  it('accepts a reviewed production issuer with a path and preserves its normalized URL', () => {
    expect(
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_REVIEWED: 'true',
        APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
        APPSEA_AUTH_OIDC_ISSUER: 'https://issuer.example.test/tenant/',
        APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
        APPSEA_PUBLIC_ORIGIN: 'https://appsea.example.test',
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toEqual({
      issuer: 'https://issuer.example.test/tenant',
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: config.redirectUri,
      endpointOrigins: ['https://issuer.example.test']
    })
  })

  it('rejects production provider hosts that resolve into private address space', async () => {
    const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }] as const
    await expect(
      assertOidcEndpointNetworkSafety('https://127.0.0.1.nip.io/.well-known', privateLookup)
    ).rejects.toThrow('OIDC endpoint resolved to a non-public address')

    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }] as const
    await expect(
      assertOidcEndpointNetworkSafety('https://issuer.example.test/.well-known', publicLookup)
    ).resolves.toBeUndefined()

    const mixedLookup = async () =>
      [
        { address: '93.184.216.34', family: 4 },
        { address: '::1', family: 6 }
      ] as const
    await expect(
      assertOidcEndpointNetworkSafety('https://issuer.example.test/.well-known', mixedLookup)
    ).rejects.toThrow('OIDC endpoint resolved to a non-public address')
  })

  it('requires the production redirect origin to match the public application origin', () => {
    expect(() =>
      oidcConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_OIDC_ENABLED: 'true',
        APPSEA_AUTH_OIDC_REVIEWED: 'true',
        APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
        APPSEA_AUTH_OIDC_ISSUER: config.issuer,
        APPSEA_AUTH_OIDC_REDIRECT_URI: config.redirectUri,
        APPSEA_PUBLIC_ORIGIN: 'https://other.example.test',
        APPSEA_AUTH_OIDC_CLIENT_ID: 'client',
        APPSEA_AUTH_OIDC_CLIENT_SECRET: 'secret'
      })
    ).toThrow(OidcConfigurationError)
  })

  it('round-trips state and builds PKCE authorization parameters', () => {
    const state = createOidcState('link', 'a'.repeat(64))
    const wrongLastCharacter = state.state.endsWith('A') ? 'B' : 'A'
    expect(decodeOidcState(encodeOidcState(state))).toEqual(state)
    expect(stateMatches(state.state, state.state)).toBe(true)
    expect(stateMatches(state.state, `${state.state.slice(0, -1)}${wrongLastCharacter}`)).toBe(
      false
    )
    const url = new URL(buildOidcAuthorizationUrl(config, discovery, state))
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(state.state)
    expect(url.searchParams.get('nonce')).toBe(state.nonce)
  })

  it('bounds discovery response bodies before parsing untrusted JSON', async () => {
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1))
        controller.close()
      }
    })
    await expect(
      discoverOidcProvider(config, async () => new Response(oversizedBody, { status: 200 }))
    ).rejects.toThrow('OIDC identity provider request failed')
  })

  it('rejects discovery endpoints outside the reviewed origin allowlist', async () => {
    const body = JSON.stringify({
      issuer: config.issuer,
      authorization_endpoint: 'https://evil.example.test/authorize',
      token_endpoint: `${config.issuer}/token`,
      jwks_uri: `${config.issuer}/jwks`
    })
    await expect(
      discoverOidcProvider(
        config,
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      )
    ).rejects.toThrow('OIDC discovery returned an unapproved authorization endpoint')
  })

  it('verifies an RSA-signed, verified-email ID token and rejects nonce tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const now = 1_800_000_000
    const state = createOidcState('login', null)
    const idToken = signedIdToken(privateKey, {
      iss: config.issuer,
      sub: 'provider-user-1',
      aud: config.clientId,
      nonce: state.nonce,
      email: 'user@example.com',
      email_verified: true,
      iat: now,
      exp: now + 300
    })
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe(discovery.jwksUri)
      return new Response(
        JSON.stringify({
          keys: [
            { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    await expect(
      verifyOidcIdToken(idToken, config, discovery, state.nonce, fetchImpl, now)
    ).resolves.toEqual({
      issuer: config.issuer,
      subject: 'provider-user-1',
      email: 'user@example.com',
      emailVerified: true
    })
    await expect(
      verifyOidcIdToken(idToken, config, discovery, 'z'.repeat(43), fetchImpl, now)
    ).rejects.toThrow('OIDC identity token verification failed')
  })
})
