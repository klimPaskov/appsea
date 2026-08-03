import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from './api/workspaces/[workspaceId]/agent-tokens/[tokenId]/route'
import { GET, POST } from './api/workspaces/[workspaceId]/agent-tokens/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  hasRecentReauthentication: vi.fn(),
  hasRecentMfaReauthentication: vi.fn(),
  create: vi.fn(),
  listForOwner: vi.fn(),
  revoke: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db/agent-access-token', () => ({
  PostgresAgentAccessTokenRepository: class {
    create = mocks.create
    listForOwner = mocks.listForOwner
    revoke = mocks.revoke
  }
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => ({
    hasRecentReauthentication: mocks.hasRecentReauthentication,
    hasRecentMfaReauthentication: mocks.hasRecentMfaReauthentication
  }),
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent reauthentication required' }, { status: 428 }),
  mfaReauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent MFA verification required' }, { status: 428 }),
  sameOriginRequest: () => true,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [
    {
      workspaceId: 'workspace:one',
      visibility: 'private',
      fixtureOnly: false,
      role: 'owner'
    }
  ]
}

const params = Promise.resolve({ workspaceId: 'workspace:one' })

describe('agent access token routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.hasRecentReauthentication.mockReset()
    mocks.hasRecentMfaReauthentication.mockReset()
    mocks.create.mockReset()
    mocks.listForOwner.mockReset()
    mocks.revoke.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('session-token')
    mocks.hasRecentReauthentication.mockResolvedValue(true)
    mocks.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.getDatabasePool.mockReturnValue({})
    mocks.listForOwner.mockResolvedValue([
      {
        tokenId: 'agent-token:one',
        label: 'Build agent',
        scopes: ['plans:read'],
        createdAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
        revokedAt: null,
        lastUsedAt: null
      }
    ])
    mocks.create.mockResolvedValue({
      tokenId: 'agent-token:one',
      label: 'Build agent',
      scopes: ['plans:read'],
      expiresAt: '2026-09-01T00:00:00.000Z',
      token: `appsea_mcp_${'a'.repeat(48)}`
    })
    mocks.revoke.mockResolvedValue(true)
  })

  it('lists tokens without returning a raw credential and creates one after step-up', async () => {
    const listed = await GET(new Request('https://appsea.example'), { params })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({ data: [{ tokenId: 'agent-token:one' }] })

    const created = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Build agent', scopes: ['plans:read'], expiresInDays: 30 })
      }),
      { params }
    )
    expect(created.status).toBe(201)
    expect((await created.json()).data.token).toMatch(/^appsea_mcp_/)
    expect(mocks.create).toHaveBeenCalledWith('user:owner', 'workspace:one', {
      label: 'Build agent',
      scopes: ['plans:read'],
      expiresInDays: 30
    })
  })

  it('requires owner step-up and supports revocation', async () => {
    mocks.hasRecentReauthentication.mockResolvedValue(false)
    const blocked = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Build agent', scopes: ['plans:read'], expiresInDays: 30 })
      }),
      { params }
    )
    expect(blocked.status).toBe(428)
    expect(mocks.create).not.toHaveBeenCalled()

    mocks.hasRecentReauthentication.mockResolvedValue(true)
    mocks.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Build agent', scopes: ['plans:read'], expiresInDays: 30 })
      }),
      { params }
    )
    expect(mfaBlocked.status).toBe(428)
    expect(mocks.create).not.toHaveBeenCalled()

    const revokeMfaBlocked = await DELETE(
      new Request('https://appsea.example', { method: 'DELETE' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', tokenId: 'agent-token:one' })
      }
    )
    expect(revokeMfaBlocked.status).toBe(428)
    expect(mocks.revoke).not.toHaveBeenCalled()

    mocks.hasRecentMfaReauthentication.mockResolvedValue(true)
    const revoked = await DELETE(new Request('https://appsea.example', { method: 'DELETE' }), {
      params: Promise.resolve({ workspaceId: 'workspace:one', tokenId: 'agent-token:one' })
    })
    expect(revoked.status).toBe(200)
    expect(mocks.revoke).toHaveBeenCalledWith('user:owner', 'workspace:one', 'agent-token:one')
  })

  it('does not let viewers manage agent credentials', async () => {
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], role: 'viewer' }]
    })
    const response = await GET(new Request('https://appsea.example'), { params })
    expect(response.status).toBe(403)
    expect(mocks.listForOwner).not.toHaveBeenCalled()
  })
})
