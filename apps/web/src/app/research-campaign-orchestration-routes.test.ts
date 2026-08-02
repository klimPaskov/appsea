import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as list } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/orchestrations/route'
import {
  GET as read,
  POST as cancel
} from './api/workspaces/[workspaceId]/campaigns/[campaignId]/orchestrations/[orchestrationId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listForCampaignForUser: vi.fn(),
  readForUser: vi.fn(),
  requestCancellationForUser: vi.fn(),
  cancelProductionCollectionWorkflow: vi.fn(),
  getTemporalWorkflowClient: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db/research-campaign-orchestration', () => ({
  PostgresResearchCampaignOrchestrationRepository: class {
    listForCampaignForUser = mocks.listForCampaignForUser
    readForUser = mocks.readForUser
    requestCancellationForUser = mocks.requestCancellationForUser
  }
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: () => true,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/production-workflow-gateway', () => ({
  canReadProductionWorkflow: () => true,
  canStartProductionWorkflow: (
    session: { workspaces: Array<{ workspaceId: string; role: string }> },
    id: string
  ) =>
    session.workspaces.some(
      (workspace) => workspace.workspaceId === id && workspace.role !== 'viewer'
    ),
  productionWorkflowBelongsToWorkspace: (workflowId: string, workspaceId: string) =>
    workflowId.startsWith(`workflow:production:${workspaceId}:`),
  productionWorkspaceFromSession: (
    session: { workspaces: Array<{ workspaceId: string }> },
    id: string
  ) => session.workspaces.find((workspace) => workspace.workspaceId === id)
}))

vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))
vi.mock('../server/temporal', () => ({
  getTemporalWorkflowClient: mocks.getTemporalWorkflowClient
}))
vi.mock('@appsea/workflows', () => ({
  cancelProductionCollectionWorkflow: mocks.cancelProductionCollectionWorkflow
}))

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
  cancellationRequestedAt: null,
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
    mocks.requestCancellationForUser.mockReset()
    mocks.cancelProductionCollectionWorkflow.mockReset()
    mocks.getTemporalWorkflowClient.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listForCampaignForUser.mockResolvedValue([orchestration])
    mocks.readForUser.mockResolvedValue(orchestration)
    mocks.requestCancellationForUser.mockResolvedValue(null)
    mocks.getTemporalWorkflowClient.mockResolvedValue({})
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

  it('persists cancellation and best-effort cancels started child workflows', async () => {
    const workflowId = `workflow:production:workspace:one:${'a'.repeat(32)}`
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], role: 'owner' }]
    })
    mocks.requestCancellationForUser.mockResolvedValue({
      orchestrationId: params.orchestrationId,
      campaignId: params.campaignId,
      state: 'requested',
      cancellationRequestedAt: '2026-08-02T00:01:00.000Z',
      activeWorkflowIds: [workflowId]
    })
    const temporalClient = {}
    mocks.getTemporalWorkflowClient.mockResolvedValue(temporalClient)

    const response = await cancel(new Request('https://appsea.example', { method: 'POST' }), {
      params: Promise.resolve(params)
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      data: {
        orchestrationId: params.orchestrationId,
        campaignId: params.campaignId,
        state: 'requested',
        cancellationRequestedAt: '2026-08-02T00:01:00.000Z',
        activeWorkflowCount: 1
      }
    })
    expect(mocks.requestCancellationForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      params.orchestrationId
    )
    expect(mocks.cancelProductionCollectionWorkflow).toHaveBeenCalledWith(
      temporalClient,
      workflowId
    )
  })

  it('does not let a viewer request cancellation', async () => {
    const response = await cancel(new Request('https://appsea.example', { method: 'POST' }), {
      params: Promise.resolve(params)
    })
    expect(response.status).toBe(403)
    expect(mocks.requestCancellationForUser).not.toHaveBeenCalled()
  })
})
