import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as list } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/orchestrations/route'
import { GET as read } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/orchestrations/[orchestrationId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listForCampaignForUser: vi.fn(),
  readForUser: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db/research-campaign-orchestration', () => ({
  PostgresResearchCampaignOrchestrationRepository: class {
    listForCampaignForUser = mocks.listForCampaignForUser
    readForUser = mocks.readForUser
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

const orchestration = {
  workspaceId: 'workspace:one',
  campaignId: 'campaign:billing',
  orchestrationId: 'run:billing:multi',
  state: 'queued',
  sourceCount: 2,
  completedSourceCount: 0,
  failedSourceCount: 0,
  analysisSeedReviewId: null,
  failureCode: null,
  failureSummary: null,
  requestedAt: '2026-08-02T00:00:00.000Z',
  startedAt: null,
  updatedAt: '2026-08-02T00:00:00.000Z',
  finishedAt: null,
  sources: [
    {
      sourceId: 'source:cfpb',
      childRunId: 'run:campaign-source:cfpb',
      state: 'queued',
      policyVersion: null,
      workflowId: null,
      attemptCount: 0,
      failureCode: null,
      failureSummary: null,
      requestedAt: '2026-08-02T00:00:00.000Z',
      startedAt: null,
      updatedAt: '2026-08-02T00:00:00.000Z',
      finishedAt: null
    },
    {
      sourceId: 'source:stackexchange',
      childRunId: 'run:campaign-source:stackexchange',
      state: 'queued',
      policyVersion: null,
      workflowId: null,
      attemptCount: 0,
      failureCode: null,
      failureSummary: null,
      requestedAt: '2026-08-02T00:00:00.000Z',
      startedAt: null,
      updatedAt: '2026-08-02T00:00:00.000Z',
      finishedAt: null
    }
  ]
}

const params = {
  workspaceId: 'workspace:one',
  campaignId: 'campaign:billing',
  orchestrationId: 'run:billing:multi'
}

describe('campaign orchestration routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.listForCampaignForUser.mockReset()
    mocks.readForUser.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listForCampaignForUser.mockResolvedValue([orchestration])
    mocks.readForUser.mockResolvedValue(orchestration)
    mocks.getDatabasePool.mockReturnValue({})
  })

  it('returns private parent/child history for a production workspace', async () => {
    const response = await list(new Request('https://appsea.example'), {
      params: Promise.resolve(params)
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [orchestration] })
    expect(mocks.listForCampaignForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      'campaign:billing'
    )
  })

  it('reads one parent/child record and enforces the campaign path', async () => {
    const response = await read(new Request('https://appsea.example'), {
      params: Promise.resolve(params)
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: orchestration })

    mocks.readForUser.mockResolvedValue({ ...orchestration, campaignId: 'campaign:other' })
    const mismatch = await read(new Request('https://appsea.example'), {
      params: Promise.resolve(params)
    })
    expect(mismatch.status).toBe(404)
  })

  it('does not expose history from a fixture workspace', async () => {
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], fixtureOnly: true }]
    })
    const response = await list(new Request('https://appsea.example'), {
      params: Promise.resolve(params)
    })
    expect(response.status).toBe(403)
    expect(mocks.listForCampaignForUser).not.toHaveBeenCalled()
  })
})
