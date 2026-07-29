import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/analysis/[analysisRunId]/route'

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
vi.mock('../server/object-store', () => ({ getObjectStore: () => ({}) }))
vi.mock('@appsea/db/production-analysis', () => ({
  PostgresProductionAnalysisRepository: class {
    readForUser = mocks.readForUser
  },
  ProductionAnalysisAvailabilityError: class extends Error {}
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'viewer', fixtureOnly: false }]
}

describe('production analysis read route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readForUser.mockResolvedValue({
      analysisRunId: 'analysis:one',
      workspaceId: 'workspace:one',
      collectionRunId: 'run:one',
      artifact: { artifactId: 'artifact:one' },
      report: { reportId: 'report:one' },
      plan: { planId: 'plan:one' }
    })
  })

  it('requires authentication and workspace membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({ ...session, workspaces: [] })
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
      })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.readForUser).not.toHaveBeenCalled()
  })

  it('returns a private active analysis read model', async () => {
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      data: {
        analysisRunId: 'analysis:one',
        workspaceId: 'workspace:one',
        collectionRunId: 'run:one',
        artifact: { artifactId: 'artifact:one' },
        report: { reportId: 'report:one' },
        plan: { planId: 'plan:one' }
      }
    })
    expect(mocks.readForUser).toHaveBeenCalledWith('user:one', 'workspace:one', 'analysis:one')
  })

  it('returns not found for unknown analysis runs', async () => {
    mocks.readForUser.mockResolvedValue(null)
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
    })
    expect(response.status).toBe(404)
  })
})
