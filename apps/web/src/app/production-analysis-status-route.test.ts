import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/analysis/[analysisRunId]/status/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readPrivateProductionAnalysisStatus: vi.fn(),
  canReadProductionWorkflow: vi.fn(),
  productionWorkspaceFromSession: vi.fn(),
  productionAnalysisWorkflowBelongsToWorkspace: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/production-workflow-gateway', () => ({
  canReadProductionWorkflow: mocks.canReadProductionWorkflow,
  productionAnalysisWorkflowBelongsToWorkspace: mocks.productionAnalysisWorkflowBelongsToWorkspace,
  productionWorkspaceFromSession: mocks.productionWorkspaceFromSession
}))

vi.mock('../server/production-analysis-status', () => ({
  ProductionAnalysisStatusMismatchError: class extends Error {},
  ProductionAnalysisStatusUnavailableError: class extends Error {},
  readPrivateProductionAnalysisStatus: mocks.readPrivateProductionAnalysisStatus
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

const status = {
  analysisRunId: 'analysis:one',
  collectionRunId: 'run:one',
  state: 'running',
  checkpoint: 'persisting',
  activityAttempts: 1,
  availabilityState: 'pending',
  opportunityId: null,
  opportunitySlug: null,
  failureCode: null,
  failureSummary: null,
  requestedAt: null,
  startedAt: null,
  completedAt: null
}

function request(workflowId?: string): Request {
  const url = new URL(
    'https://appsea.example/api/workspaces/workspace:one/analysis/analysis:one/status'
  )
  if (workflowId) url.searchParams.set('workflowId', workflowId)
  return new Request(url)
}

describe('production analysis status route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readPrivateProductionAnalysisStatus.mockReset()
    mocks.canReadProductionWorkflow.mockReset()
    mocks.productionWorkspaceFromSession.mockReset()
    mocks.productionAnalysisWorkflowBelongsToWorkspace.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.canReadProductionWorkflow.mockReturnValue(true)
    mocks.productionWorkspaceFromSession.mockReturnValue(session.workspaces[0])
    mocks.productionAnalysisWorkflowBelongsToWorkspace.mockReturnValue(true)
    mocks.readPrivateProductionAnalysisStatus.mockResolvedValue(status)
  })

  it('returns a private safe status projection', async () => {
    const response = await GET(
      request('workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
      }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: status })
    expect(mocks.readPrivateProductionAnalysisStatus).toHaveBeenCalledWith({
      userId: 'user:one',
      workspaceId: 'workspace:one',
      analysisRunId: 'analysis:one',
      workflowId: 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
  })

  it('fails closed for fixture workspaces and foreign workflows', async () => {
    mocks.productionWorkspaceFromSession.mockReturnValue({
      ...session.workspaces[0],
      fixtureOnly: true
    })
    const fixture = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
    })
    expect(fixture.status).toBe(403)

    mocks.productionWorkspaceFromSession.mockReturnValue(session.workspaces[0])
    mocks.productionAnalysisWorkflowBelongsToWorkspace.mockReturnValue(false)
    const foreign = await GET(
      request('workflow:analysis:workspace:other:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
      }
    )
    expect(foreign.status).toBe(403)
    expect(mocks.readPrivateProductionAnalysisStatus).not.toHaveBeenCalled()

    mocks.productionAnalysisWorkflowBelongsToWorkspace.mockReturnValue(true)
    mocks.productionWorkspaceFromSession.mockReturnValue({
      ...session.workspaces[0],
      visibility: 'public'
    })
    const publicWorkspace = await GET(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', analysisRunId: 'analysis:one' })
    })
    expect(publicWorkspace.status).toBe(403)
  })
})
