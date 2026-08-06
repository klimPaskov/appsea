import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/research/production/[runId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db/production-collection', () => ({
  PostgresProductionCollectionRepository: class {
    readForUser = mocks.readForUser
  }
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'viewer', fixtureOnly: false }]
}

describe('production collection read route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readForUser.mockResolvedValue({
      result: {
        runId: 'run:one',
        query: 'billing',
        dateRange: { from: null, to: null }
      },
      evidence: [],
      sourceCoverage: [],
      analysisHandoff: null
    })
  })

  it('requires authentication and workspace membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({ ...session, workspaces: [] })
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
      })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.readForUser).not.toHaveBeenCalled()
  })

  it('returns evidence coverage without exposing a public cache', async () => {
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      data: {
        result: {
          runId: 'run:one',
          query: 'billing',
          dateRange: { from: null, to: null }
        },
        evidence: [],
        sourceCoverage: [],
        analysisHandoff: null
      }
    })
    expect(mocks.readForUser).toHaveBeenCalledWith('user:one', 'workspace:one', 'run:one')
  })

  it('returns not found for a non-completed or unknown collection', async () => {
    mocks.readForUser.mockResolvedValue(null)
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
    })
    expect(response.status).toBe(404)
  })

  it('passes the private handoff status through without widening the public route', async () => {
    mocks.readForUser.mockResolvedValue({
      result: {
        runId: 'run:one',
        query: 'billing',
        dateRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.000Z' }
      },
      evidence: [],
      sourceCoverage: [],
      analysisHandoff: {
        handoffId: 'handoff:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        collectionWorkflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        collectionRunId: 'run:one',
        seedReviewId: 'seed-review:one',
        analysisRunId: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        state: 'queued',
        attemptCount: 0,
        workflowId: null,
        failureCode: null,
        failureSummary: null,
        requestedAt: '2026-07-26T00:00:00.000Z',
        nextAttemptAt: '2026-07-26T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        updatedAt: '2026-07-26T00:00:00.000Z'
      }
    })
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.analysisHandoff.state).toBe('queued')
    expect(body.data.analysisHandoff).not.toHaveProperty('idempotencyKey')
  })
})
