import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceMembershipConflictError,
  WorkspaceMembershipManagementError
} from '@appsea/db/auth'
import { GET as listMembers } from './api/workspaces/[workspaceId]/members/route'
import {
  DELETE as deleteMember,
  PATCH as updateMember
} from './api/workspaces/[workspaceId]/members/[userId]/route'
import { POST as reauthenticate } from './api/auth/reauthenticate/route'

const mocks = vi.hoisted(() => ({
  repository: {
    listWorkspaceMembers: vi.fn(),
    updateWorkspaceMemberRole: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn(),
    reauthenticateSession: vi.fn()
  },
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  allowAuthAttempt: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  allowAuthAttempt: mocks.allowAuthAttempt,
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  readBoundedJsonBody: async (request: Request) =>
    ({ ok: true, value: await request.json() }) as const,
  requestBodyTooLargeResponse: () =>
    Response.json({ error: 'Request body is too large' }, { status: 413 }),
  mfaReauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent MFA verification required' }, { status: 428 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent reauthentication required' }, { status: 428 }),
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

describe('workspace membership routes', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.listWorkspaceMembers.mockReset()
    mocks.repository.updateWorkspaceMemberRole.mockReset()
    mocks.repository.removeWorkspaceMember.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.reauthenticateSession.mockReset()
  })

  it('returns owner member data and rejects non-owner roster reads', async () => {
    mocks.repository.listWorkspaceMembers.mockResolvedValue([
      {
        userId: 'user:owner',
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'owner',
        createdAt: '2026-07-24T00:00:00.000Z'
      }
    ])
    const response = await listMembers(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: [{ role: 'owner' }] })

    mocks.repository.listWorkspaceMembers.mockRejectedValue(
      new WorkspaceMembershipManagementError()
    )
    const forbidden = await listMembers(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(forbidden.status).toBe(403)
  })

  it('enforces same-origin and strict role payloads on updates', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await updateMember(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:member' })
    })
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await updateMember(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:member' }) }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.repository.updateWorkspaceMemberRole).not.toHaveBeenCalled()

    mocks.repository.updateWorkspaceMemberRole.mockResolvedValue({
      userId: 'user:member',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'viewer',
      createdAt: '2026-07-24T00:00:00.000Z'
    })
    const updated = await updateMember(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'viewer' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:member' }) }
    )
    expect(updated.status).toBe(200)

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await updateMember(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'viewer' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:member' }) }
    )
    expect(mfaBlocked.status).toBe(428)
    expect(mocks.repository.updateWorkspaceMemberRole).toHaveBeenCalledTimes(1)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
  })

  it('maps last-owner deletion conflicts to a private conflict response', async () => {
    mocks.repository.removeWorkspaceMember.mockRejectedValue(new WorkspaceMembershipConflictError())
    const response = await deleteMember(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:owner' })
      }
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'The workspace must retain at least one owner'
    })

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await deleteMember(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:owner' })
      }
    )
    expect(mfaBlocked.status).toBe(428)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
  })

  it('requires same-origin session reauthentication and never returns password data', async () => {
    mocks.repository.reauthenticateSession.mockResolvedValue(undefined)
    const response = await reauthenticate(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ password: 'a sufficiently long password' }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { reauthenticated: true } })
    expect(mocks.repository.reauthenticateSession).toHaveBeenCalledWith('a'.repeat(48), {
      password: 'a sufficiently long password'
    })

    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    const blocked = await deleteMember(
      new Request('https://appsea.example', { method: 'DELETE' }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', userId: 'user:member' }) }
    )
    expect(blocked.status).toBe(428)
    expect(mocks.repository.removeWorkspaceMember).not.toHaveBeenCalled()
  })
})
