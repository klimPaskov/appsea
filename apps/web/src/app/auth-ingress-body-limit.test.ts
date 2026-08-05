import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as login } from './api/auth/login/route'
import { POST as signup } from './api/auth/signup/route'

const mocks = vi.hoisted(() => ({
  readBoundedJsonBody: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('@appsea/db/auth', () => ({
  AuthenticationConflictError: class AuthenticationConflictError extends Error {}
}))
vi.mock('../server/auth-session', () => ({
  allowAuthAttempt: vi.fn(),
  authRepository: vi.fn(),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readBoundedJsonBody: mocks.readBoundedJsonBody,
  requestBodyTooLargeResponse: () =>
    Response.json(
      { error: 'Request body is too large' },
      { status: 413, headers: { 'cache-control': 'private, no-store' } }
    ),
  sameOriginRequest: mocks.sameOriginRequest,
  sessionCookieName: 'appsea_session',
  sessionCookieOptions: () => ({})
}))

describe('auth ingress body limits', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    mocks.sameOriginRequest.mockReset()
    mocks.readBoundedJsonBody.mockReset()
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readBoundedJsonBody.mockResolvedValue({ ok: false, tooLarge: true })
  })

  it.each([
    ['login', login, '/api/auth/login'],
    ['signup', signup, '/api/auth/signup']
  ] as const)(
    'returns 413 for an oversized %s body before parsing',
    async (_name, handler, path) => {
      const response = await handler(
        new Request(`https://appsea.example${path}`, {
          method: 'POST',
          headers: { 'content-length': '32769' },
          body: '{}'
        })
      )
      expect(response.status).toBe(413)
    }
  )
})
