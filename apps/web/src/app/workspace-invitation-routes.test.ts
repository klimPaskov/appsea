import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceInvitationError } from '@appsea/db/auth'
import {
  GET as listInvitations,
  POST as createInvitation
} from './api/workspaces/[workspaceId]/invitations/route'
import { DELETE as revokeInvitation } from './api/workspaces/[workspaceId]/invitations/[invitationId]/route'
import { POST as acceptInvitation } from './api/auth/invitations/accept/route'

const mocks = vi.hoisted(() => ({
  repository: {
    listWorkspaceInvitations: vi.fn(),
    createWorkspaceInvitation: vi.fn(),
    revokeWorkspaceInvitation: vi.fn(),
    acceptWorkspaceInvitation: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn()
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

describe('workspace invitation routes', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.listWorkspaceInvitations.mockReset()
    mocks.repository.createWorkspaceInvitation.mockReset()
    mocks.repository.revokeWorkspaceInvitation.mockReset()
    mocks.repository.acceptWorkspaceInvitation.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
  })

  it('lists and creates owner invitations behind step-up and rate limits', async () => {
    mocks.repository.listWorkspaceInvitations.mockResolvedValue([
      {
        invitationId: 'invite:one',
        email: 'member@example.com',
        role: 'viewer',
        state: 'pending',
        createdAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-07-27T00:00:00.000Z'
      }
    ])
    const listed = await listInvitations(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({ data: [{ role: 'viewer' }] })

    mocks.repository.createWorkspaceInvitation.mockResolvedValue({
      invitation: {
        invitationId: 'invite:two',
        email: 'new@example.com',
        role: 'editor',
        state: 'pending',
        createdAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-07-27T00:00:00.000Z'
      }
    })
    const created = await createInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', role: 'editor' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(created.status).toBe(202)
    expect(mocks.allowAuthAttempt).toHaveBeenCalledWith(
      expect.any(Request),
      'new@example.com',
      'invitation'
    )
    expect(mocks.repository.createWorkspaceInvitation).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      { email: 'new@example.com', role: 'editor' }
    )
  })

  it('blocks cross-origin, unstepped, disabled, and malformed mutations', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await createInvitation(
      new Request('https://appsea.example', { method: 'POST' }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await createInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'not-an-email', role: 'owner' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(invalid.status).toBe(400)

    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    const unstepped = await createInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', role: 'viewer' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unstepped.status).toBe(428)

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await createInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', role: 'viewer' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(mfaBlocked.status).toBe(428)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)

    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APPSEA_AUTH_INVITATIONS_ENABLED', 'false')
    const disabled = await createInvitation(
      new Request('https://appsea.example', { method: 'POST' }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(disabled.status).toBe(503)
  })

  it('revokes pending invitations and accepts only valid existing-account tokens', async () => {
    const revoked = await revokeInvitation(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', invitationId: 'invite:one' })
      }
    )
    expect(revoked.status).toBe(200)
    expect(mocks.repository.revokeWorkspaceInvitation).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'invite:one'
    )

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await revokeInvitation(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', invitationId: 'invite:one' })
      }
    )
    expect(mfaBlocked.status).toBe(428)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)

    mocks.allowAuthAttempt.mockResolvedValue(false)
    const limited = await acceptInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ token: 'a'.repeat(48) }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(limited.status).toBe(429)
    mocks.allowAuthAttempt.mockResolvedValue(true)

    mocks.repository.acceptWorkspaceInvitation.mockResolvedValue({
      accepted: true,
      workspaceId: 'workspace:one',
      role: 'viewer'
    })
    const accepted = await acceptInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ token: 'a'.repeat(48) }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(accepted.status).toBe(200)

    mocks.repository.acceptWorkspaceInvitation.mockRejectedValue(new WorkspaceInvitationError())
    const rejected = await acceptInvitation(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ token: 'a'.repeat(48) }),
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(rejected.status).toBe(400)
  })
})
