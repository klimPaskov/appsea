import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/audit-events/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listPageForUser: vi.fn(),
  CursorError: class extends Error {}
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db', () => ({
  AuditEventHistoryCursorError: mocks.CursorError,
  PostgresAuditEventRepository: class {
    listPageForUser = mocks.listPageForUser
  }
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [
    { workspaceId: 'workspace:one', visibility: 'private', fixtureOnly: false, role: 'viewer' }
  ]
}

const page = {
  data: [
    {
      auditEventId: 'audit:history:new',
      actorType: 'service',
      actorId: 'appsea-worker',
      action: 'research.run.completed',
      targetType: 'research_run',
      targetId: 'run:one',
      correlationId: 'correlation:one',
      metadata: { sourceItems: 2 },
      occurredAt: '2026-08-04T00:00:00.000Z'
    }
  ],
  nextCursor: null
}

describe('workspace audit history route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.listPageForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listPageForUser.mockResolvedValue(page)
  })

  it('requires authentication and private-workspace membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(new Request('https://appsea.example/api/workspaces/workspace:one/audit-events'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({ ...session, workspaces: [] })
    await expect(
      GET(new Request('https://appsea.example/api/workspaces/workspace:one/audit-events'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.listPageForUser).not.toHaveBeenCalled()
  })

  it('returns the bounded private page and forwards pagination', async () => {
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/audit-events?limit=10&cursor=abc_123'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual(page)
    expect(mocks.listPageForUser).toHaveBeenCalledWith('user:one', 'workspace:one', {
      limit: 10,
      cursor: 'abc_123'
    })
  })

  it('rejects duplicate or unknown query keys before reading the repository', async () => {
    const unknown = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/audit-events?from=now'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unknown.status).toBe(400)
    const duplicate = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/audit-events?limit=1&limit=2'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(duplicate.status).toBe(400)
    expect(mocks.listPageForUser).not.toHaveBeenCalled()
  })

  it('maps cursor and dependency failures to fixed private responses', async () => {
    mocks.listPageForUser.mockRejectedValueOnce(new mocks.CursorError())
    const invalidCursor = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/audit-events?cursor=abc'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(invalidCursor.status).toBe(400)

    mocks.listPageForUser.mockRejectedValueOnce(new Error('database password leaked'))
    const unavailable = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/audit-events'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('cache-control')).toBe('private, no-store')
    await expect(unavailable.json()).resolves.toEqual({
      error: 'Audit history unavailable',
      code: 'audit_history_unavailable'
    })
  })
})
