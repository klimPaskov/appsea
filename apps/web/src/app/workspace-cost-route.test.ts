import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/costs/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readForUser: vi.fn(),
  CostSummaryQueryError: class extends Error {}
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db', () => ({
  WorkspaceCostSummaryQueryError: mocks.CostSummaryQueryError,
  PostgresWorkspaceCostRepository: class {
    readForUser = mocks.readForUser
  }
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'viewer', fixtureOnly: false }]
}

const summary = {
  workspaceId: 'workspace:one',
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  asOf: '2026-08-01T12:00:00.000Z',
  entryCount: 1,
  currencies: [
    {
      currency: 'USD',
      entryCount: 1,
      totalCostMicros: '1000000',
      estimatedCostMicros: '0',
      actualCostMicros: '1000000',
      byCostType: [
        {
          costType: 'source_request',
          entryCount: 1,
          totalCostMicros: '1000000',
          estimatedCostMicros: '0',
          actualCostMicros: '1000000'
        }
      ]
    }
  ]
}

describe('workspace cost summary route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readForUser.mockResolvedValue(summary)
  })

  it('requires authentication and membership before reading costs', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(new Request('https://appsea.example/api/workspaces/workspace:one/costs'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({ ...session, workspaces: [] })
    await expect(
      GET(new Request('https://appsea.example/api/workspaces/workspace:one/costs'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.readForUser).not.toHaveBeenCalled()
  })

  it('returns a private, bounded summary and forwards the period', async () => {
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/costs?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: summary })
    expect(mocks.readForUser).toHaveBeenCalledWith('user:one', 'workspace:one', {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z'
    })
  })

  it('rejects malformed periods and unknown query keys', async () => {
    const invalid = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/costs?from=not-a-date'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(invalid.status).toBe(400)

    const unknown = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/costs?limit=10'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(unknown.status).toBe(400)

    const duplicate = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/costs?from=2026-07-01T00:00:00.000Z&from=2026-07-02T00:00:00.000Z'
      ),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(duplicate.status).toBe(400)
    expect(mocks.readForUser).not.toHaveBeenCalled()
  })

  it('maps repository failures to a private fixed error', async () => {
    mocks.readForUser.mockRejectedValue(new Error('database details must not escape'))
    const response = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/costs'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'Cost summary unavailable',
      code: 'cost_summary_unavailable'
    })
  })

  it('maps a server-clock period rejection to a client error', async () => {
    mocks.readForUser.mockRejectedValue(new mocks.CostSummaryQueryError())
    const response = await GET(
      new Request('https://appsea.example/api/workspaces/workspace:one/costs'),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid cost summary period' })
  })
})
