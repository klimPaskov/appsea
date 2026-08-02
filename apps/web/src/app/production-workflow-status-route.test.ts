import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/research/production/workflow/[workflowId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  requestCancellationForUser: vi.fn(),
  cancelProductionCollectionWorkflow: vi.fn(),
  getTemporalWorkflowClient: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db/production-collection-workflow', () => ({
  PostgresProductionCollectionWorkflowRepository: class {
    requestCancellationForUser = mocks.requestCancellationForUser
  },
  ProductionCollectionWorkflowPermissionError: class extends Error {}
}))

vi.mock('@appsea/workflows', () => ({
  cancelProductionCollectionWorkflow: mocks.cancelProductionCollectionWorkflow,
  readProductionCollectionWorkflowStatus: vi.fn()
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
    workspaceId: string
  ) =>
    session.workspaces.some(
      (workspace) =>
        workspace.workspaceId === workspaceId && ['owner', 'editor'].includes(workspace.role)
    ),
  productionWorkflowBelongsToWorkspace: () => true,
  productionWorkspaceFromSession: (
    session: { workspaces: Array<{ workspaceId: string }> },
    workspaceId: string
  ) => session.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}))

vi.mock('../server/temporal', () => ({
  getTemporalWorkflowClient: mocks.getTemporalWorkflowClient
}))
vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))

const workflowId = 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [
    { workspaceId: 'workspace:one', role: 'editor', fixtureOnly: false, visibility: 'private' }
  ]
}

function request(): Request {
  return new Request(
    `https://appsea.example/api/workspaces/workspace:one/research/production/workflow/${workflowId}`,
    { method: 'POST', headers: { origin: 'https://appsea.example' } }
  )
}

describe('production workflow cancellation route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.requestCancellationForUser.mockReset()
    mocks.cancelProductionCollectionWorkflow.mockReset()
    mocks.getTemporalWorkflowClient.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.requestCancellationForUser.mockResolvedValue({
      workflowId,
      campaignId: 'campaign:one',
      state: 'requested',
      cancellationRequestedAt: '2026-08-03T00:00:00.000Z'
    })
    mocks.cancelProductionCollectionWorkflow.mockResolvedValue(undefined)
    mocks.getTemporalWorkflowClient.mockResolvedValue({})
    mocks.getDatabasePool.mockReturnValue({})
  })

  it('persists intent before best-effort Temporal cancellation', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', workflowId })
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      data: {
        workflowId,
        campaignId: 'campaign:one',
        state: 'requested',
        cancellationRequestedAt: '2026-08-03T00:00:00.000Z'
      }
    })
    expect(mocks.requestCancellationForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      workflowId
    )
    expect(mocks.cancelProductionCollectionWorkflow).toHaveBeenCalledWith({}, workflowId)
  })

  it('returns accepted when Temporal is unavailable because the intent is durable', async () => {
    mocks.getTemporalWorkflowClient.mockRejectedValue(new Error('Temporal unavailable'))
    const response = await POST(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', workflowId })
    })

    expect(response.status).toBe(202)
    expect(mocks.requestCancellationForUser).toHaveBeenCalledTimes(1)
  })

  it('does not call Temporal for an already-terminal projection', async () => {
    mocks.requestCancellationForUser.mockResolvedValue({
      workflowId,
      campaignId: 'campaign:one',
      state: 'already_terminal',
      cancellationRequestedAt: null
    })
    const response = await POST(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', workflowId })
    })

    expect(response.status).toBe(200)
    expect(mocks.cancelProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('requires an owner or editor role', async () => {
    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], role: 'viewer' }]
    })
    const response = await POST(request(), {
      params: Promise.resolve({ workspaceId: 'workspace:one', workflowId })
    })

    expect(response.status).toBe(403)
    expect(mocks.requestCancellationForUser).not.toHaveBeenCalled()
  })
})
