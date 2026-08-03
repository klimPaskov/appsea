import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthAccountDeletionBlockedError } from '@appsea/db/auth'
import { DELETE } from './api/auth/account/route'

const mocks = vi.hoisted(() => ({
  repository: {
    closeAccount: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn()
  },
  allowAuthAttempt: vi.fn(),
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
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
  sessionCookieName: 'appsea_session',
  sessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 2_592_000,
    priority: 'high'
  }),
  unauthorizedResponse: () =>
    Response.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'cache-control': 'private, no-store' } }
    )
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'editor' }]
}

function request(body: unknown): Request {
  return new Request('https://appsea.example/api/auth/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('account closure route', () => {
  beforeEach(() => {
    mocks.repository.closeAccount.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.allowAuthAttempt.mockReset()
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.closeAccount.mockResolvedValue({ closed: true, blockingWorkspaceIds: [] })
  })

  it('requires same-origin, recent step-up, and explicit confirmation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(DELETE(request({ confirmation: 'DELETE MY ACCOUNT' }))).resolves.toHaveProperty(
      'status',
      403
    )

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    const stepUp = await DELETE(request({ confirmation: 'DELETE MY ACCOUNT' }))
    expect(stepUp.status).toBe(428)
    expect(mocks.repository.closeAccount).not.toHaveBeenCalled()

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaStepUp = await DELETE(request({ confirmation: 'DELETE MY ACCOUNT' }))
    expect(mfaStepUp.status).toBe(428)
    expect(mocks.repository.closeAccount).not.toHaveBeenCalled()

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)

    const invalid = await DELETE(request({ confirmation: 'delete my account' }))
    expect(invalid.status).toBe(400)
  })

  it('closes the account and clears the session cookie', async () => {
    const response = await DELETE(request({ confirmation: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { closed: true, blockingWorkspaceIds: [] }
    })
    expect(response.headers.get('set-cookie')).toContain('appsea_session=')
    expect(mocks.repository.closeAccount).toHaveBeenCalledWith('user:one', {
      confirmation: 'DELETE MY ACCOUNT'
    })
  })

  it('returns owner blockers without closing the session', async () => {
    mocks.repository.closeAccount.mockRejectedValue(
      new AuthAccountDeletionBlockedError(['workspace:owned'])
    )
    const response = await DELETE(request({ confirmation: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Transfer workspace ownership before closing this account',
      blockingWorkspaceIds: ['workspace:owned']
    })
  })
})
