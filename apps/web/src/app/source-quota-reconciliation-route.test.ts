import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/research/quota-reconciliation/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listReconciliationCasesForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db', () => ({
  PostgresSourceQuotaRepository: class {
    listReconciliationCasesForUser = mocks.listReconciliationCasesForUser
  }
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'viewer', fixtureOnly: false }]
}

const reconciliationCase = {
  workspaceId: 'workspace:one',
  reservationId: 'quota:source:one',
  sourceId: 'source:one',
  policyVersion: 'policy-v1',
  runId: 'run:one',
  requestedRecords: 2,
  requestedCostMicros: 15,
  actualRecords: 2,
  actualCostMicros: 15,
  state: 'open',
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-01T00:00:00.000Z',
  resolutionCode: null,
  linkedRunId: null,
  resolutionActorId: null,
  resolvedAt: null
}

describe('source quota reconciliation route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.listReconciliationCasesForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listReconciliationCasesForUser.mockResolvedValue([reconciliationCase])
  })

  it('requires authentication and membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(
        new Request(
          'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation'
        ),
        {
          params: Promise.resolve({ workspaceId: 'workspace:one' })
        }
      )
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({ ...session, workspaces: [] })
    await expect(
      GET(
        new Request(
          'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation'
        ),
        {
          params: Promise.resolve({ workspaceId: 'workspace:one' })
        }
      )
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.listReconciliationCasesForUser).not.toHaveBeenCalled()
  })

  it('returns a private bounded inspection result', async () => {
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation?limit=10'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: [reconciliationCase] })
    expect(mocks.listReconciliationCasesForUser).toHaveBeenCalledWith('user:one', 'workspace:one', {
      limit: 10
    })
  })

  it('rejects unknown, duplicate, and unbounded query parameters', async () => {
    const unknown = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation?from=x'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unknown.status).toBe(400)

    const duplicate = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation?limit=10&limit=20'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(duplicate.status).toBe(400)

    const unbounded = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation?limit=101'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unbounded.status).toBe(400)
    expect(mocks.listReconciliationCasesForUser).not.toHaveBeenCalled()
  })

  it('maps repository failures to a fixed private error', async () => {
    mocks.listReconciliationCasesForUser.mockRejectedValue(new Error('database details'))
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/research/quota-reconciliation'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Quota reconciliation status unavailable',
      code: 'quota_reconciliation_unavailable'
    })
  })
})
