import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/opportunities/[slug]/decisions/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readPrivateOpportunityContext: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  sameOriginRequest: vi.fn(),
  createForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readBoundedJsonBody: async (request: Request) =>
    ({ ok: true, value: await request.json() }) as const,
  requestBodyTooLargeResponse: () =>
    Response.json({ error: 'Request body is too large' }, { status: 413 }),
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('../server/database', () => ({ getDatabasePool: vi.fn(() => ({})) }))
vi.mock('../server/private-opportunity', () => ({
  readPrivateOpportunityContext: mocks.readPrivateOpportunityContext
}))
vi.mock('@appsea/db/opportunity-decision', () => ({
  OpportunityDecisionBlockedError: class OpportunityDecisionBlockedError extends Error {},
  OpportunityDecisionConflictError: class OpportunityDecisionConflictError extends Error {},
  OpportunityDecisionNotFoundError: class OpportunityDecisionNotFoundError extends Error {},
  OpportunityDecisionPermissionError: class OpportunityDecisionPermissionError extends Error {},
  PostgresOpportunityDecisionRepository: class {
    createForUser = mocks.createForUser
    listForUser = vi.fn()
  }
}))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const decision = {
  decisionId: 'opportunity-decision:one',
  opportunityId: 'opportunity:one',
  actorId: 'user:owner',
  decision: 'watch',
  previousState: 'candidate',
  nextState: 'monitoring',
  reason: 'Keep visible while source coverage is incomplete.',
  evidenceSnapshot: {
    opportunityId: 'opportunity:one',
    sourceRunId: 'run:one',
    previousState: 'candidate',
    scoreSnapshotId: null,
    reportId: null,
    planPackageId: null,
    deepResearchGateId: null,
    evidenceIds: [],
    coverageGapCount: 1,
    snapshotHash: 'a'.repeat(64),
    capturedAt: '2026-08-05T00:00:00.000Z'
  },
  createdAt: '2026-08-05T00:00:00.000Z'
} as const

describe('opportunity decision API route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readPrivateOpportunityContext.mockReset()
    mocks.requireRecentMutationStepUp.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.createForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.readPrivateOpportunityContext.mockResolvedValue({
      session,
      workspace: session.workspaces[0],
      detail: {
        opportunity: { id: 'opportunity:one', synthetic: false },
        summary: { synthetic: false }
      }
    })
    mocks.createForUser.mockResolvedValue(decision)
  })

  it('requires same-origin authentication and an idempotency key', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ decision: 'watch', reason: 'coverage', expectedState: 'candidate' })
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'opportunity-one' }) }
    )
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const missingKey = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ decision: 'watch', reason: 'coverage', expectedState: 'candidate' })
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'opportunity-one' }) }
    )
    expect(missingKey.status).toBe(400)
    expect(mocks.createForUser).not.toHaveBeenCalled()
  })

  it('records a validated private decision after step-up', async () => {
    const response = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        headers: { 'idempotency-key': 'decision-key-001' },
        body: JSON.stringify({
          decision: 'watch',
          reason: 'Coverage is incomplete.',
          expectedState: 'candidate'
        })
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'opportunity-one' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.requireRecentMutationStepUp).toHaveBeenCalledOnce()
    expect(mocks.createForUser).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'opportunity:one',
      { decision: 'watch', reason: 'Coverage is incomplete.', expectedState: 'candidate' },
      'decision-key-001'
    )
    await expect(response.json()).resolves.toEqual({ data: decision })
  })
})
