import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { PostgresAuthRepository } from '@appsea/db/auth'
import type { AuthSessionReadModel } from '@appsea/contracts'
import type { ObjectStore } from '@appsea/object-store'
import { getDatabasePool } from './database'
import { oidcMfaChallengeCookieName } from './oidc'

export const sessionCookieName =
  process.env.NODE_ENV === 'production' ? '__Host-appsea_session' : 'appsea_session'
const sessionTokenPattern = /^[A-Za-z0-9_-]{32,256}$/

export function authRepository(
  options: { objectStore?: ObjectStore } = {}
): PostgresAuthRepository {
  return new PostgresAuthRepository(getDatabasePool(), options.objectStore)
}

export function sessionCookieOptions(): {
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
    maxAge: 60 * 60 * 24 * 30,
    priority: 'high'
  }
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName)?.value
  return token && sessionTokenPattern.test(token) ? token : null
}

export async function readOidcMfaChallengeToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(oidcMfaChallengeCookieName)?.value
  return token && sessionTokenPattern.test(token) ? token : null
}

export async function readSession(): Promise<AuthSessionReadModel | null> {
  const token = await readSessionToken()
  if (!token) return null
  return authRepository().readSession(token)
}

export function invalidRequest(message = 'Invalid request'): Response {
  return Response.json({ error: message }, { status: 400, headers: privateResponseHeaders })
}

export type BoundedJsonBodyResult = { ok: true; value: unknown } | { ok: false; tooLarge: boolean }

/**
 * Read an auth request body without allowing Request.json() to buffer an
 * unbounded unauthenticated payload before validation or throttling.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes = 32_768
): Promise<BoundedJsonBodyResult> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return { ok: false, tooLarge: true }
    }
  }
  if (!request.body) return { ok: false, tooLarge: false }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('request body exceeds the auth limit')
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, tooLarge: false }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { ok: false, tooLarge: false }
  }
}

export function requestBodyTooLargeResponse(): Response {
  return Response.json(
    { error: 'Request body is too large' },
    { status: 413, headers: privateResponseHeaders }
  )
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Authentication required' },
    { status: 401, headers: privateResponseHeaders }
  )
}

export function reauthenticationRequiredResponse(): Response {
  return Response.json(
    { error: 'Recent reauthentication required' },
    { status: 428, headers: privateResponseHeaders }
  )
}

export function mfaReauthenticationRequiredResponse(): Response {
  return Response.json(
    { error: 'Recent MFA verification required' },
    { status: 428, headers: privateResponseHeaders }
  )
}

/**
 * Require the session-bound password step-up and the conditional MFA proof
 * before a high-impact private mutation. Accounts without enabled MFA pass
 * through the repository's existing compatibility result for the MFA marker.
 */
export async function requireRecentMutationStepUp(): Promise<Response | null> {
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  const repository = authRepository()
  if (!(await repository.hasRecentReauthentication(token))) {
    return reauthenticationRequiredResponse()
  }
  if (!(await repository.hasRecentMfaReauthentication(token))) {
    return mfaReauthenticationRequiredResponse()
  }
  return null
}

export function forbiddenResponse(): Response {
  return Response.json(
    { error: 'Workspace access denied' },
    { status: 403, headers: privateResponseHeaders }
  )
}

export const privateResponseHeaders = {
  'cache-control': 'private, no-store'
} as const

function requestClientMarker(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (process.env.NODE_ENV !== 'production') {
    return forwarded && /^[A-Za-z0-9:._-]{1,80}$/.test(forwarded) ? forwarded : null
  }

  // Never trust a caller-controlled X-Forwarded-For value in production.
  // A trusted ingress may provide a bounded marker plus an HMAC instead.
  const marker = request.headers.get('x-appsea-client-marker')?.trim() ?? ''
  const signature = request.headers.get('x-appsea-client-marker-signature')?.trim() ?? ''
  const configured = process.env.APPSEA_TRUSTED_PROXY_SECRET
  if (!configured || !/^[A-Za-z0-9._:-]{1,80}$/.test(marker)) return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(configured)) return null
  const secret = Buffer.from(configured, 'base64url')
  if (secret.length !== 32 || !/^(?:sha256=)?[a-f0-9]{64}$/.test(signature)) return null
  const provided = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
  const expected = createHmac('sha256', secret).update(marker).digest()
  return provided.length === expected.length && timingSafeEqual(provided, expected) ? marker : null
}

export async function allowAuthAttempt(
  request: Request,
  email: string,
  scope:
    | 'login'
    | 'oidc'
    | 'mfa'
    | 'signup'
    | 'reauthenticate'
    | 'recovery'
    | 'password-reset'
    | 'invitation'
    | 'invitation-accept'
    | 'account-deletion'
): Promise<boolean> {
  const repository = authRepository()
  const keys = [`${scope}:email:${email.toLowerCase()}`]
  const clientMarker = requestClientMarker(request)
  const maxAttempts =
    scope === 'signup'
      ? 4
      : scope === 'mfa'
        ? 8
        : scope === 'oidc'
          ? 8
          : scope === 'reauthenticate'
            ? 6
            : scope === 'recovery'
              ? 5
              : scope === 'invitation'
                ? 8
                : scope === 'invitation-accept'
                  ? 20
                  : scope === 'account-deletion'
                    ? 3
                    : 10
  if (clientMarker) {
    keys.push(`${scope}:client:${clientMarker}`)
  } else {
    // Without an authenticated ingress marker, a caller must not be able to
    // evade abuse controls by rotating arbitrary forwarding headers. The
    // wider bucket is intentionally conservative until trusted proxy
    // signing is configured.
    keys.push(`${scope}:global`)
  }
  const globalMaxAttempts = clientMarker ? maxAttempts : maxAttempts * 20
  for (const key of keys) {
    if (
      !(await repository.consumeAuthRateLimit(
        key,
        key.endsWith(':global') ? globalMaxAttempts : maxAttempts
      ))
    ) {
      return false
    }
  }
  return true
}

export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site') return false
  if (process.env.NODE_ENV === 'production' && !origin) return false
  if (!origin) return true
  try {
    const expectedOrigin = process.env.APPSEA_PUBLIC_ORIGIN
    if (process.env.NODE_ENV === 'production') {
      if (!expectedOrigin) return false
      const expected = new URL(expectedOrigin)
      if (expected.protocol !== 'https:') return false
      return new URL(origin).origin === expected.origin
    }
    if (expectedOrigin) return new URL(origin).origin === new URL(expectedOrigin).origin
    const host = request.headers.get('host')
    return host !== null && new URL(origin).host === host
  } catch {
    return false
  }
}
