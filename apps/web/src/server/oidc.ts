import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { authEmailSchema } from '@appsea/contracts'

const oidcIssuerPattern = /^https:\/\/[^/?#]+(?:\/[^?#]*)?$/i
const localIssuerPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i
const maxDiscoveryBytes = 256 * 1024
const maxTokenResponseBytes = 256 * 1024
const maxJwksBytes = 512 * 1024
const clockSkewSeconds = 60
const maxIdTokenAgeSeconds = 10 * 60
const oidcRequestTimeoutMs = 10_000

export class OidcConfigurationError extends Error {
  constructor(message = 'OIDC identity provider configuration is invalid') {
    super(message)
    this.name = 'OidcConfigurationError'
  }
}

export class OidcProviderError extends Error {
  constructor(message = 'OIDC identity provider request failed') {
    super(message)
    this.name = 'OidcProviderError'
  }
}

export class OidcTokenVerificationError extends Error {
  constructor() {
    super('OIDC identity token verification failed')
    this.name = 'OidcTokenVerificationError'
  }
}

export type OidcFlowMode = 'login' | 'link'

export interface OidcProviderConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  endpointOrigins: readonly string[]
}

export interface OidcDiscoveryDocument {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
}

export interface OidcIdentityClaims {
  issuer: string
  subject: string
  email: string
  emailVerified: true
}

interface OidcJsonResponse {
  readonly [key: string]: unknown
}

export interface OidcState {
  state: string
  nonce: string
  codeVerifier: string
  mode: OidcFlowMode
  sessionHash: string | null
  issuedAt: number
}

export const oidcStateCookieName =
  process.env.NODE_ENV === 'production' ? '__Host-appsea_oidc_state' : 'appsea_oidc_state'
export const oidcMfaChallengeCookieName =
  process.env.NODE_ENV === 'production' ? '__Host-appsea_oidc_mfa' : 'appsea_oidc_mfa'

export function oidcStateCookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
  priority: 'high'
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
    priority: 'high'
  }
}

export function oidcMfaChallengeCookieOptions(): ReturnType<typeof oidcStateCookieOptions> {
  return oidcStateCookieOptions()
}

function normalizedIssuer(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  return value === 'localhost' || value === '127.0.0.1' || value === '::1'
}

function mappedIpv4FromIpv6(hostname: string): string | null {
  const value = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (isIP(value) !== 6) return null
  const sections = value.split('::')
  if (sections.length > 2) return null
  const left = sections[0] === '' ? [] : sections[0]!.split(':')
  const right = sections.length === 2 && sections[1] !== '' ? sections[1]!.split(':') : []
  if (
    [...left, ...right].some((section) => !/^[0-9a-f]{1,4}$/i.test(section) || section.length === 0)
  ) {
    return null
  }
  const missing = 8 - left.length - right.length
  if (missing < 0 || (sections.length === 2 && missing < 1)) return null
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((word) =>
    Number.parseInt(word, 16)
  )
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
  const compatible = words.slice(0, 6).every((word) => word === 0)
  if (words.length !== 8 || (!mapped && !compatible)) {
    return null
  }
  return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join('.')
}

function isPrivateProductionHostname(hostname: string): boolean {
  const value = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (isLoopbackHostname(value)) return true
  const ipv4 = value.includes('.') ? value.split('.').map((part) => Number(part)) : []
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      ipv4[0] === 0 ||
      ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      (ipv4[0] === 100 && ipv4[1]! >= 64 && ipv4[1]! <= 127) ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) ||
      ipv4[0]! >= 224
    )
  }
  const version = isIP(value)
  const mappedIpv4 = mappedIpv4FromIpv6(value)
  if (mappedIpv4) return isPrivateProductionHostname(mappedIpv4)
  return (
    version === 6 &&
    (value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb') ||
      value.startsWith('fec') ||
      value.startsWith('ff') ||
      value.startsWith('::ffff:192.168.') ||
      value.startsWith('::ffff:10.'))
  )
}

function parseUrl(value: string, name: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new OidcConfigurationError(`${name} must be a valid URL`)
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new OidcConfigurationError(`${name} must not contain credentials or a fragment`)
  }
  return parsed
}

function assertProviderUrl(value: string, name: string, production: boolean): string {
  const parsed = parseUrl(value, name)
  if (parsed.protocol !== 'https:') {
    if (!(!production && parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
      throw new OidcConfigurationError(`${name} must use HTTPS`)
    }
  }
  if (production && isLoopbackHostname(parsed.hostname)) {
    throw new OidcConfigurationError(`${name} must not use a loopback host in production`)
  }
  if (production && isPrivateProductionHostname(parsed.hostname)) {
    throw new OidcConfigurationError(`${name} must not use a private host in production`)
  }
  return parsed.toString()
}

type OidcDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<readonly { address: string; family: number }[]>

/**
 * Resolve the provider host before a production request and reject any answer
 * that lands in a private, loopback, link-local, multicast, or otherwise
 * non-public address range. Literal hostname checks alone do not stop hosts
 * such as 127.0.0.1.nip.io from resolving into the application network.
 * Deployment egress policy and DNS pinning remain required for a complete
 * rebinding-resistant production control.
 */
export async function assertOidcEndpointNetworkSafety(
  value: string,
  lookupImpl: OidcDnsLookup = (hostname, options) => lookup(hostname, options)
): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new OidcProviderError('OIDC endpoint URL is invalid')
  }
  if (isPrivateProductionHostname(parsed.hostname)) {
    throw new OidcProviderError('OIDC endpoint resolved to a non-public host')
  }
  let addresses: readonly { address: string; family: number }[]
  try {
    addresses = await lookupImpl(parsed.hostname, { all: true, verbatim: true })
  } catch {
    throw new OidcProviderError('OIDC endpoint host could not be resolved')
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateProductionHostname(address))
  ) {
    throw new OidcProviderError('OIDC endpoint resolved to a non-public address')
  }
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new OidcConfigurationError(`${name} is required when OIDC is enabled`)
  return value
}

function endpointOriginsFromEnvironment(
  environment: NodeJS.ProcessEnv,
  issuer: string,
  production: boolean
): readonly string[] {
  const configured = environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS?.trim() ?? ''
  const values = configured === '' ? [] : configured.split(',').map((value) => value.trim())
  if (values.length > 8 || values.some((value) => value.length === 0 || value.length > 512)) {
    throw new OidcConfigurationError('APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS is invalid')
  }
  const origins = new Set<string>([new URL(issuer).origin])
  for (const value of values) {
    const parsed = parseUrl(value, 'APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS')
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new OidcConfigurationError(
        'APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS must contain origins without paths or queries'
      )
    }
    if (parsed.protocol !== 'https:') {
      if (!(parsed.protocol === 'http:' && !production && isLoopbackHostname(parsed.hostname))) {
        throw new OidcConfigurationError(
          'OIDC endpoint origins must use HTTPS outside local development'
        )
      }
    }
    if (production && isPrivateProductionHostname(parsed.hostname)) {
      throw new OidcConfigurationError('OIDC endpoint origins must not use private hosts')
    }
    origins.add(parsed.origin)
  }
  return [...origins]
}

/**
 * Read the deployment-owned OIDC configuration. An unset/false switch means
 * the optional provider boundary is unavailable; a partial enabled config
 * fails closed instead of falling back to password or guessed defaults.
 */
export function oidcConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): OidcProviderConfig | null {
  const enabled = environment.APPSEA_AUTH_OIDC_ENABLED?.trim() ?? 'false'
  if (enabled === 'false' || enabled === '') return null
  if (enabled !== 'true') throw new OidcConfigurationError('APPSEA_AUTH_OIDC_ENABLED is invalid')
  const production = environment.NODE_ENV === 'production'
  if (production && environment.APPSEA_AUTH_OIDC_REVIEWED !== 'true') {
    throw new OidcConfigurationError('Production OIDC requires an approved provider review')
  }
  if (production && environment.APPSEA_AUTH_OIDC_ACCOUNT_LINKING !== 'explicit') {
    throw new OidcConfigurationError('Production OIDC requires explicit account linking')
  }

  const issuerRaw = requiredEnvironment(environment, 'APPSEA_AUTH_OIDC_ISSUER')
  const issuer = normalizedIssuer(issuerRaw)
  const issuerUrl = parseUrl(issuer, 'APPSEA_AUTH_OIDC_ISSUER')
  if (issuerUrl.search) {
    throw new OidcConfigurationError('APPSEA_AUTH_OIDC_ISSUER must not contain a query')
  }
  if (!oidcIssuerPattern.test(issuerRaw)) {
    if (!(environment.NODE_ENV !== 'production' && localIssuerPattern.test(issuerRaw))) {
      throw new OidcConfigurationError('APPSEA_AUTH_OIDC_ISSUER must be an HTTPS issuer URL')
    }
  }
  if (
    production &&
    (issuerUrl.protocol !== 'https:' || isPrivateProductionHostname(issuerUrl.hostname))
  ) {
    throw new OidcConfigurationError('Production OIDC issuers must use a non-private HTTPS URL')
  }

  const redirectUri = assertProviderUrl(
    requiredEnvironment(environment, 'APPSEA_AUTH_OIDC_REDIRECT_URI'),
    'APPSEA_AUTH_OIDC_REDIRECT_URI',
    production
  )
  const redirect = new URL(redirectUri)
  if (redirect.pathname !== '/api/auth/oidc/callback' || redirect.search || redirect.hash) {
    throw new OidcConfigurationError(
      'APPSEA_AUTH_OIDC_REDIRECT_URI must target /api/auth/oidc/callback without a query or fragment'
    )
  }
  if (production) {
    const publicOrigin = parseUrl(
      requiredEnvironment(environment, 'APPSEA_PUBLIC_ORIGIN'),
      'APPSEA_PUBLIC_ORIGIN'
    )
    if (
      publicOrigin.protocol !== 'https:' ||
      publicOrigin.pathname !== '/' ||
      publicOrigin.search ||
      publicOrigin.hash ||
      isPrivateProductionHostname(publicOrigin.hostname) ||
      redirect.origin !== publicOrigin.origin
    ) {
      throw new OidcConfigurationError(
        'APPSEA_AUTH_OIDC_REDIRECT_URI must match the public application origin'
      )
    }
  }

  const clientId = requiredEnvironment(environment, 'APPSEA_AUTH_OIDC_CLIENT_ID')
  const clientSecret = requiredEnvironment(environment, 'APPSEA_AUTH_OIDC_CLIENT_SECRET')
  if (clientId.length > 512 || clientSecret.length > 2048) {
    throw new OidcConfigurationError('OIDC client credentials are too long')
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    endpointOrigins: endpointOriginsFromEnvironment(environment, issuer, production)
  }
}

export function oidcIsConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return oidcConfigFromEnv(environment) !== null
  } catch {
    return false
  }
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function parseOidcState(value: unknown): OidcState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OidcProviderError('OIDC state is invalid')
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.state !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.state) ||
    typeof candidate.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.nonce) ||
    typeof candidate.codeVerifier !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.codeVerifier) ||
    (candidate.mode !== 'login' && candidate.mode !== 'link') ||
    (candidate.sessionHash !== null &&
      (typeof candidate.sessionHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(candidate.sessionHash))) ||
    typeof candidate.issuedAt !== 'number' ||
    !Number.isSafeInteger(candidate.issuedAt) ||
    candidate.issuedAt <= 0 ||
    Object.keys(candidate).some(
      (key) => !['state', 'nonce', 'codeVerifier', 'mode', 'sessionHash', 'issuedAt'].includes(key)
    )
  ) {
    throw new OidcProviderError('OIDC state is invalid')
  }
  return {
    state: candidate.state,
    nonce: candidate.nonce,
    codeVerifier: candidate.codeVerifier,
    mode: candidate.mode,
    sessionHash: candidate.sessionHash,
    issuedAt: candidate.issuedAt
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new OidcTokenVerificationError()
  return Buffer.from(value, 'base64url')
}

function decodeJson(value: string, error: Error): OidcJsonResponse {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw error
    return parsed as OidcJsonResponse
  } catch {
    throw error
  }
}

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  error: Error
): Promise<OidcJsonResponse> {
  if (!response.ok) throw error
  const contentLength = response.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw error
  }
  if (!response.body) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw error
    return decodeJson(body, error)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw error
      }
      chunks.push(next.value)
    }
  } catch {
    throw error
  } finally {
    reader.releaseLock()
  }
  return decodeJson(Buffer.concat(chunks).toString('utf8'), error)
}

async function fetchOidcJson(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  maxBytes: number,
  error: Error
): Promise<OidcJsonResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), oidcRequestTimeoutMs)
  try {
    if (process.env.NODE_ENV === 'production') {
      await assertOidcEndpointNetworkSafety(input)
    }
    const response = await fetchImpl(input, { ...init, signal: controller.signal })
    return await readJsonResponse(response, maxBytes, error)
  } finally {
    clearTimeout(timeout)
  }
}

function endpointFromDocument(
  value: unknown,
  name: string,
  production: boolean,
  allowedOrigins: readonly string[]
): string {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new OidcProviderError(`OIDC discovery did not provide ${name}`)
  }
  const endpoint = assertProviderUrl(value, name, production)
  const parsed = new URL(endpoint)
  if (parsed.search || parsed.hash || !allowedOrigins.includes(parsed.origin)) {
    throw new OidcProviderError(`OIDC discovery returned an unapproved ${name}`)
  }
  return endpoint
}

export async function discoverOidcProvider(
  config: OidcProviderConfig,
  fetchImpl: typeof fetch = fetch
): Promise<OidcDiscoveryDocument> {
  const production = process.env.NODE_ENV === 'production'
  const discoveryUrl = `${config.issuer}/.well-known/openid-configuration`
  let body: OidcJsonResponse
  try {
    body = await fetchOidcJson(
      fetchImpl,
      discoveryUrl,
      {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' }
      },
      maxDiscoveryBytes,
      new OidcProviderError()
    )
  } catch {
    throw new OidcProviderError()
  }
  const discoveredIssuer = body.issuer
  if (
    typeof discoveredIssuer !== 'string' ||
    normalizedIssuer(discoveredIssuer) !== config.issuer
  ) {
    throw new OidcProviderError('OIDC discovery issuer does not match configured issuer')
  }
  return {
    issuer: config.issuer,
    authorizationEndpoint: endpointFromDocument(
      body.authorization_endpoint,
      'authorization endpoint',
      production,
      config.endpointOrigins
    ),
    tokenEndpoint: endpointFromDocument(
      body.token_endpoint,
      'token endpoint',
      production,
      config.endpointOrigins
    ),
    jwksUri: endpointFromDocument(body.jwks_uri, 'JWKS URI', production, config.endpointOrigins)
  }
}

export function createOidcState(mode: OidcFlowMode, sessionHash: string | null): OidcState {
  const now = Math.floor(Date.now() / 1_000)
  return parseOidcState({
    state: base64Url(randomBytes(32)),
    nonce: base64Url(randomBytes(32)),
    codeVerifier: base64Url(randomBytes(32)),
    mode,
    sessionHash,
    issuedAt: now
  })
}

export function encodeOidcState(state: OidcState): string {
  return base64Url(Buffer.from(JSON.stringify(parseOidcState(state)), 'utf8'))
}

export function decodeOidcState(value: string): OidcState {
  if (value.length > 2_048) throw new OidcProviderError('OIDC state is invalid')
  try {
    return parseOidcState(JSON.parse(decodeBase64Url(value).toString('utf8')))
  } catch {
    throw new OidcProviderError('OIDC state is invalid')
  }
}

export function stateMatches(expected: string, provided: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(expected) || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}

export function buildOidcAuthorizationUrl(
  config: OidcProviderConfig,
  discovery: OidcDiscoveryDocument,
  state: OidcState
): string {
  const url = new URL(discovery.authorizationEndpoint)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state.state)
  url.searchParams.set('nonce', state.nonce)
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(state.codeVerifier, 'utf8').digest('base64url')
  )
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeOidcCode(
  config: OidcProviderConfig,
  discovery: OidcDiscoveryDocument,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{1,2048}$/.test(code)) throw new OidcProviderError()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: codeVerifier
  })
  let tokenResponse: OidcJsonResponse
  try {
    tokenResponse = await fetchOidcJson(
      fetchImpl,
      discovery.tokenEndpoint,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      },
      maxTokenResponseBytes,
      new OidcProviderError()
    )
  } catch {
    throw new OidcProviderError()
  }
  if (typeof tokenResponse.id_token !== 'string' || tokenResponse.id_token.length > 16_384) {
    throw new OidcProviderError('OIDC token response did not contain an ID token')
  }
  return tokenResponse.id_token
}

function stringClaim(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function numberClaim(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function audienceContains(value: unknown, clientId: string): boolean {
  if (typeof value === 'string') return value === clientId
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    value.includes(clientId)
  )
}

type JsonWebKey = Record<string, unknown>

function jwkForKey(value: unknown, kid: string): JsonWebKey {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { keys?: unknown }).keys)
  ) {
    throw new OidcTokenVerificationError()
  }
  const key = (value as { keys: unknown[] }).keys.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { kid?: unknown }).kid === kid &&
      (candidate as { kty?: unknown }).kty === 'RSA' &&
      ((candidate as { use?: unknown }).use === undefined ||
        (candidate as { use?: unknown }).use === 'sig') &&
      ((candidate as { alg?: unknown }).alg === undefined ||
        (candidate as { alg?: unknown }).alg === 'RS256')
  )
  if (!key) throw new OidcTokenVerificationError()
  return key as JsonWebKey
}

async function fetchJwk(
  discovery: OidcDiscoveryDocument,
  kid: string,
  fetchImpl: typeof fetch
): Promise<JsonWebKey> {
  let body: OidcJsonResponse
  try {
    body = await fetchOidcJson(
      fetchImpl,
      discovery.jwksUri,
      {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' }
      },
      maxJwksBytes,
      new OidcTokenVerificationError()
    )
  } catch {
    throw new OidcTokenVerificationError()
  }
  return jwkForKey(body, kid)
}

export async function verifyOidcIdToken(
  idToken: string,
  config: OidcProviderConfig,
  discovery: OidcDiscoveryDocument,
  expectedNonce: string,
  fetchImpl: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000)
): Promise<OidcIdentityClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3 || idToken.length > 16_384) throw new OidcTokenVerificationError()
  let header: OidcJsonResponse
  let payload: OidcJsonResponse
  try {
    header = decodeJson(
      decodeBase64Url(parts[0]!).toString('utf8'),
      new OidcTokenVerificationError()
    )
    payload = decodeJson(
      decodeBase64Url(parts[1]!).toString('utf8'),
      new OidcTokenVerificationError()
    )
  } catch {
    throw new OidcTokenVerificationError()
  }
  if (
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9._-]{1,256}$/.test(header.kid)
  ) {
    throw new OidcTokenVerificationError()
  }
  const signature = decodeBase64Url(parts[2]!)
  const jwk = await fetchJwk(discovery, header.kid, fetchImpl)
  const verified = (() => {
    try {
      const verifier = createVerify('RSA-SHA256')
      verifier.update(`${parts[0]}.${parts[1]}`)
      verifier.end()
      return verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), signature)
    } catch {
      return false
    }
  })()
  if (!verified) throw new OidcTokenVerificationError()

  const issuer = stringClaim(payload.iss, 512)
  const subject = stringClaim(payload.sub, 512)
  const email = stringClaim(payload.email, 320)
  const expiresAt = numberClaim(payload.exp)
  const issuedAt = numberClaim(payload.iat)
  if (
    issuer === null ||
    normalizedIssuer(issuer) !== config.issuer ||
    subject === null ||
    email === null ||
    !audienceContains(payload.aud, config.clientId) ||
    expiresAt === null ||
    issuedAt === null ||
    expiresAt <= nowSeconds - clockSkewSeconds ||
    issuedAt > nowSeconds + clockSkewSeconds ||
    issuedAt < nowSeconds - maxIdTokenAgeSeconds ||
    payload.email_verified !== true ||
    typeof payload.nonce !== 'string' ||
    !stateMatches(expectedNonce, payload.nonce)
  ) {
    throw new OidcTokenVerificationError()
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) {
    throw new OidcTokenVerificationError()
  }
  const parsedEmail = authEmailSchema.safeParse(email)
  if (!parsedEmail.success) throw new OidcTokenVerificationError()
  return { issuer: config.issuer, subject, email: parsedEmail.data, emailVerified: true }
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
