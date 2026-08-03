import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceArchivePermissionError } from '@appsea/db/auth'
import { DELETE } from './api/workspaces/[workspaceId]/route'

const mocks = vi.hoisted(() => ({
  repository: {
    archiveWorkspace: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn()
  },
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () =>
    Response.json(
      { error: 'Workspace access denied' },
      { status: 403, headers: { 'cache-control': 'private, no-store' } }
    ),
  invalidRequest: (message: string) =>
    Response.json(
      { error: message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } }
    ),
  mfaReauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent MFA verification required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
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

function request(body: unknown): Request {
  return new Request('https://appsea.example/api/workspaces/workspace:one', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const context = { params: Promise.resolve({ workspaceId: 'workspace:one' }) }

describe('workspace archival route', () => {
  beforeEach(() => {
    mocks.repository.archiveWorkspace.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.archiveWorkspace.mockResolvedValue({
      workspaceId: 'workspace:one',
      state: 'archived',
      archivedAt: '2026-08-02T20:00:00.000Z',
      activeWorkCount: 0,
      replayed: false
    })
  })

  it('requires same-origin, authentication, recent step-up, and exact confirmation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(
      DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    ).resolves.toHaveProperty('status', 403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    await expect(
      DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    await expect(
      DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    await expect(
      DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    await expect(
      DELETE(request({ confirmation: 'archive workspace' }), context)
    ).resolves.toHaveProperty('status', 400)
    expect(mocks.repository.archiveWorkspace).not.toHaveBeenCalled()
  })

  it('returns active-work blockers without claiming archival', async () => {
    mocks.repository.archiveWorkspace.mockResolvedValue({
      workspaceId: 'workspace:one',
      state: 'blocked',
      archivedAt: null,
      activeWorkCount: 3,
      replayed: false
    })
    const response = await DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Finish active research before archiving this workspace',
      data: {
        workspaceId: 'workspace:one',
        state: 'blocked',
        archivedAt: null,
        activeWorkCount: 3,
        replayed: false
      }
    })
  })

  it('archives only through the owner-authorized repository boundary', async () => {
    const response = await DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { state: 'archived', activeWorkCount: 0 }
    })
    expect(mocks.repository.archiveWorkspace).toHaveBeenCalledWith('user:one', 'workspace:one', {
      confirmation: 'ARCHIVE WORKSPACE'
    })

    mocks.repository.archiveWorkspace.mockRejectedValue(new WorkspaceArchivePermissionError())
    await expect(
      DELETE(request({ confirmation: 'ARCHIVE WORKSPACE' }), context)
    ).resolves.toHaveProperty('status', 403)
  })
})
