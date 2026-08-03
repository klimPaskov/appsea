import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/runs/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listPageForCampaignForUser: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db/production-collection-workflow', () => ({
  PostgresProductionCollectionWorkflowRepository: class {
    listPageForCampaignForUser = mocks.listPageForCampaignForUser
  }
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/production-workflow-gateway', () => ({
  canReadProductionWorkflow: () => true,
  productionWorkspaceFromSession: (
    session: { workspaces: Array<{ workspaceId: string }> },
    id: string
  ) => session.workspaces.find((workspace) => workspace.workspaceId === id)
}))

vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [
    {
      workspaceId: 'workspace:one',
      role: 'viewer',
      fixtureOnly: false,
      visibility: 'private'
    }
  ]
}

const run = {
  campaignId: 'campaign:billing',
  workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  runId: 'run:billing',
  sourceId: 'source:cfpb',
  policyVersion: 'cfpb-v1',
  state: 'completed',
  checkpoint: 'completed',
  activityAttempts: 1,
  consumedSourceItems: 10,
  consumedCostMicros: 0,
  analysisSeedReviewId: null,
  recollectionTombstoneId: null,
  requestedAt: '2026-08-02T00:00:00.000Z',
  startedAt: '2026-08-02T00:00:01.000Z',
  updatedAt: '2026-08-02T00:01:00.000Z',
  finishedAt: '2026-08-02T00:01:00.000Z'
}

function request(): Request {
  return new Request(
    'https://appsea.example/api/workspaces/workspace:one/campaigns/campaign:billing/runs',
    { method: 'GET' }
  )
}

describe('campaign run history route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.listPageForCampaignForUser.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listPageForCampaignForUser.mockResolvedValue({ data: [run], nextCursor: null })
    mocks.getDatabasePool.mockReturnValue({})
  })

  it('returns safe private run history for a production workspace', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [run], nextCursor: null })
    expect(mocks.listPageForCampaignForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      'campaign:billing',
      { limit: 25 }
    )
  })

  it('does not expose production history from a fixture workspace', async () => {
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], fixtureOnly: true }]
    })
    const response = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(response.status).toBe(403)
    expect(mocks.listPageForCampaignForUser).not.toHaveBeenCalled()
  })

  it('does not expose production history from a public workspace', async () => {
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], visibility: 'public' }]
    })
    const response = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(response.status).toBe(403)
    expect(mocks.listPageForCampaignForUser).not.toHaveBeenCalled()
  })

  it('maps repository failure to a private retryable response', async () => {
    mocks.listPageForCampaignForUser.mockRejectedValue(new Error('database unavailable'))
    const response = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('passes a bounded cursor query to the repository', async () => {
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/campaigns/campaign:billing/runs?limit=10&cursor=eyJ2ZXJzaW9uIjoxfQ'
      ),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
      }
    )
    expect(response.status).toBe(200)
    expect(mocks.listPageForCampaignForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      'campaign:billing',
      { limit: 10, cursor: 'eyJ2ZXJzaW9uIjoxfQ' }
    )
  })

  it('rejects unsupported history query keys before opening the repository', async () => {
    const response = await GET(
      new Request(
        'https://appsea.example/api/workspaces/workspace:one/campaigns/campaign:billing/runs?source=private'
      ),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
      }
    )
    expect(response.status).toBe(400)
    expect(mocks.listPageForCampaignForUser).not.toHaveBeenCalled()
  })
})
