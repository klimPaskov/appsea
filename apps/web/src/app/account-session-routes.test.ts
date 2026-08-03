import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthSessionConflictError, AuthSessionNotFoundError } from '@appsea/db/auth'
import { GET as listSessions } from './api/auth/sessions/route'
import { DELETE as revokeSession } from './api/auth/sessions/[sessionId]/route'

const mocks = vi.hoisted(() => ({
  repository: {
    listActiveSessions: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn(),
    revokeSessionById: vi.fn()
  },
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  invalidRequest: (message: string) =>
    Response.json(
      { error: message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  mfaReauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent MFA verification required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent reauthentication required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () =>
    Response.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'cache-control': 'private, no-store' } }
    )
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

describe('authentication session routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.repository.listActiveSessions.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.repository.revokeSessionById.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.revokeSessionById.mockResolvedValue(undefined)
  })

  it('lists only private active-session summaries for an authenticated user', async () => {
    mocks.repository.listActiveSessions.mockResolvedValue([
      {
        id: 'session:current',
        createdAt: '2026-07-23T00:00:00.000Z',
        lastSeenAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-08-23T00:00:00.000Z',
        current: true
      }
    ])
    const response = await listSessions()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        sessions: [
          {
            id: 'session:current',
            createdAt: '2026-07-23T00:00:00.000Z',
            lastSeenAt: '2026-07-24T00:00:00.000Z',
            expiresAt: '2026-08-23T00:00:00.000Z',
            current: true
          }
        ]
      }
    })
    expect(mocks.repository.listActiveSessions).toHaveBeenCalledWith('a'.repeat(48))

    mocks.readSession.mockResolvedValue(null)
    const unauthorized = await listSessions()
    expect(unauthorized.status).toBe(401)
    expect(mocks.repository.listActiveSessions).toHaveBeenCalledTimes(1)
  })

  it('requires same-origin reauthentication and maps session revocation outcomes', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await revokeSession(new Request('https://appsea.example'), {
      params: Promise.resolve({ sessionId: 'session:other' })
    })
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    const stepUp = await revokeSession(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ sessionId: 'session:other' })
      }
    )
    expect(stepUp.status).toBe(428)
    expect(mocks.repository.revokeSessionById).not.toHaveBeenCalled()

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaStepUp = await revokeSession(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ sessionId: 'session:other' })
      }
    )
    expect(mfaStepUp.status).toBe(428)
    expect(mocks.repository.revokeSessionById).not.toHaveBeenCalled()

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.revokeSessionById.mockRejectedValue(new AuthSessionConflictError())
    const conflict = await revokeSession(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ sessionId: 'session:current' })
      }
    )
    expect(conflict.status).toBe(409)

    mocks.repository.revokeSessionById.mockRejectedValue(new AuthSessionNotFoundError())
    const missing = await revokeSession(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ sessionId: 'session:gone' })
      }
    )
    expect(missing.status).toBe(404)

    mocks.repository.revokeSessionById.mockResolvedValue(undefined)
    const revoked = await revokeSession(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ sessionId: 'session:other' })
      }
    )
    expect(revoked.status).toBe(200)
    expect(mocks.repository.revokeSessionById).toHaveBeenLastCalledWith(
      'a'.repeat(48),
      'session:other'
    )
  })
})
