import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPasswordResetError } from '@appsea/db/auth'
import { POST as requestReset } from './api/auth/password-reset/request/route'
import { POST as resetPassword } from './api/auth/password-reset/route'

const mocks = vi.hoisted(() => ({
  repository: {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    consumeAuthRateLimit: vi.fn()
  },
  allowAuthAttempt: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
  authRepository: () => mocks.repository,
  invalidRequest: (message: string) =>
    Response.json(
      { error: message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readBoundedJsonBody: async (request: Request) => {
    if (Number(request.headers.get('content-length') ?? '0') > 32_768) {
      return { ok: false, tooLarge: true } as const
    }
    return { ok: true, value: await request.json() } as const
  },
  requestBodyTooLargeResponse: () =>
    Response.json(
      { error: 'Request body is too large' },
      { status: 413, headers: { 'cache-control': 'private, no-store' } }
    ),
  sameOriginRequest: mocks.sameOriginRequest
}))

describe('password recovery routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_ENABLED', 'true')
    mocks.allowAuthAttempt.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.repository.requestPasswordReset.mockReset()
    mocks.repository.resetPassword.mockReset()
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.repository.requestPasswordReset.mockResolvedValue({
      issued: true,
      expiresAt: '2026-07-24T00:30:00.000Z'
    })
    mocks.repository.resetPassword.mockResolvedValue(undefined)
  })

  it('returns the same accepted response for known and unknown addresses', async () => {
    const known = await requestReset(
      new Request('https://appsea.example/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(known.status).toBe(202)
    await expect(known.json()).resolves.toEqual({ data: { accepted: true } })

    mocks.repository.requestPasswordReset.mockResolvedValue({
      issued: false,
      expiresAt: '2026-07-24T00:30:00.000Z'
    })
    const unknown = await requestReset(
      new Request('https://appsea.example/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: 'missing@example.com' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(unknown.status).toBe(202)
    await expect(unknown.json()).resolves.toEqual({ data: { accepted: true } })
    expect(mocks.repository.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it('enforces same-origin and recovery rate limits before persistence', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await requestReset(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.allowAuthAttempt.mockResolvedValue(false)
    const limited = await requestReset(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(limited.status).toBe(429)
    expect(mocks.repository.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('returns 413 for an oversized recovery body before rate limiting', async () => {
    const response = await requestReset(
      new Request('https://appsea.example/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '32769' },
        body: '{}'
      })
    )
    expect(response.status).toBe(413)
    expect(mocks.allowAuthAttempt).not.toHaveBeenCalled()
  })

  it('accepts a valid reset and maps invalid tokens without echoing them', async () => {
    const token = 'a'.repeat(48)
    const response = await resetPassword(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ token, password: 'new sufficiently long password' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { accepted: true } })

    mocks.repository.resetPassword.mockRejectedValue(new AuthPasswordResetError())
    const invalid = await resetPassword(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ token, password: 'new sufficiently long password' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(invalid.status).toBe(400)
    const body = await invalid.text()
    expect(body).not.toContain(token)
  })
})
