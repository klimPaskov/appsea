import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/opportunities/[slug]/clusters/route'
import { POST } from './api/workspaces/[workspaceId]/opportunities/[slug]/clusters/[clusterVersionId]/reviews/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readPrivateOpportunityContext: vi.fn(),
  sameOriginRequest: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  listForUser: vi.fn(),
  createForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readBoundedJsonBody: async (request: Request) => ({ ok: true, value: await request.json() }),
  requestBodyTooLargeResponse: () =>
    Response.json({ error: 'Request body is too large' }, { status: 413 }),
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('../server/private-opportunity', () => ({
  readPrivateOpportunityContext: mocks.readPrivateOpportunityContext
}))
vi.mock('@appsea/db/cluster-review', () => ({
  ClusterReviewBlockedError: class extends Error {},
  ClusterReviewConflictError: class extends Error {},
  ClusterReviewNotFoundError: class extends Error {},
  ClusterReviewPermissionError: class extends Error {},
  PostgresClusterReviewRepository: class {
    listForUser(...args: unknown[]) {
      return mocks.listForUser(...args)
    }
    createForUser(...args: unknown[]) {
      return mocks.createForUser(...args)
    }
  }
}))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' as const }]
}
const cluster = {
  clusterVersionId: 'cluster-version:one',
  clusterId: 'cluster:one',
  opportunityId: 'opportunity:one',
  runId: 'run:one',
  clusterVersion: 'production-cluster-v1',
  workingLabel: 'Export handoff',
  problemStatement: 'Users lose work during export handoff.',
  product: 'Inbox Relay',
  category: 'workflow_gap',
  complaintCount: 2,
  uniqueObservationCount: 2,
  sourceCount: 1,
  confidence: 0.9,
  reviewState: 'provisional' as const,
  inputHash: 'a'.repeat(64),
  synthetic: false,
  redacted: false,
  memberships: [],
  reviewHistory: []
}

describe('cluster review routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.readPrivateOpportunityContext.mockResolvedValue({
      session,
      workspace: session.workspaces[0],
      detail: {
        opportunity: { id: 'opportunity:one' },
        summary: { synthetic: false }
      }
    })
    mocks.listForUser.mockResolvedValue([cluster])
    mocks.createForUser.mockResolvedValue({
      reviewId: 'cluster-review:one',
      clusterVersionId: cluster.clusterVersionId,
      opportunityId: cluster.opportunityId,
      action: 'confirm',
      previousReviewState: 'provisional',
      nextReviewState: 'confirmed',
      note: 'Boundary reviewed.',
      relatedClusterVersionIds: [],
      actorId: 'user:owner',
      snapshot: {},
      createdAt: '2026-08-05T00:00:00.000Z'
    })
  })

  it('lists private cluster projections with no-store headers', async () => {
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'inbox-relay' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: [cluster] })
  })

  it('requires same-origin, step-up, and idempotency before mutation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    expect(
      (
        await POST(new Request('https://appsea.example', { method: 'POST' }), {
          params: Promise.resolve({
            workspaceId: 'workspace:one',
            slug: 'inbox-relay',
            clusterVersionId: cluster.clusterVersionId
          })
        })
      ).status
    ).toBe(403)
    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm', expectedInputHash: 'a'.repeat(64), note: 'ok' })
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          slug: 'inbox-relay',
          clusterVersionId: cluster.clusterVersionId
        })
      }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.createForUser).not.toHaveBeenCalled()
  })

  it('records a source-backed review after step-up', async () => {
    const response = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        headers: { 'idempotency-key': 'cluster-key-001' },
        body: JSON.stringify({
          action: 'confirm',
          expectedInputHash: 'a'.repeat(64),
          note: 'Boundary reviewed.'
        })
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          slug: 'inbox-relay',
          clusterVersionId: cluster.clusterVersionId
        })
      }
    )
    expect(response.status).toBe(200)
    expect(mocks.requireRecentMutationStepUp).toHaveBeenCalledOnce()
    expect(mocks.createForUser).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'opportunity:one',
      cluster.clusterVersionId,
      {
        action: 'confirm',
        expectedInputHash: 'a'.repeat(64),
        note: 'Boundary reviewed.',
        relatedClusterVersionIds: []
      },
      'cluster-key-001'
    )
  })
})
