import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET,
  POST
} from './api/workspaces/[workspaceId]/opportunities/[slug]/competitor-observations/route'
import { PATCH } from './api/workspaces/[workspaceId]/opportunities/[slug]/competitor-observations/[observationId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readPrivateOpportunityContext: vi.fn(),
  sameOriginRequest: vi.fn(),
  canReadProductionWorkflow: vi.fn(),
  canStartProductionWorkflow: vi.fn(),
  create: vi.fn(),
  updateReview: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('../server/private-opportunity', () => ({
  readPrivateOpportunityContext: mocks.readPrivateOpportunityContext
}))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('../server/production-workflow-gateway', () => ({
  canReadProductionWorkflow: mocks.canReadProductionWorkflow,
  canStartProductionWorkflow: mocks.canStartProductionWorkflow
}))
vi.mock('@appsea/db/competitive-research', () => ({
  CompetitiveResearchObservationConflictError: class extends Error {},
  CompetitiveResearchObservationNotFoundError: class extends Error {},
  CompetitiveResearchObservationPermissionError: class extends Error {},
  CompetitiveResearchObservationPolicyError: class extends Error {},
  PostgresCompetitiveResearchRepository: class {
    create(...args: unknown[]) {
      return mocks.create(...args)
    }

    updateReview(...args: unknown[]) {
      return mocks.updateReview(...args)
    }
  }
}))

const session = {
  user: { userId: 'user:editor' },
  workspaces: [
    { workspaceId: 'workspace:one', role: 'editor', fixtureOnly: false, visibility: 'private' }
  ]
}

const detail = {
  opportunity: { id: 'opportunity:one' },
  competitiveResearch: {
    status: 'reviewed-seed-only',
    observedAt: null,
    sourceIds: [],
    evidenceIds: [],
    observations: [],
    coverageGaps: ['No permitted competitor source evidence is attached.'],
    seedReview: null,
    synthetic: false
  }
}

const params = Promise.resolve({ workspaceId: 'workspace:one', slug: 'opportunity-one' })

describe('private competitor observation routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readPrivateOpportunityContext.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.canReadProductionWorkflow.mockReset()
    mocks.canStartProductionWorkflow.mockReset()
    mocks.create.mockReset()
    mocks.updateReview.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readPrivateOpportunityContext.mockResolvedValue({
      session,
      workspace: session.workspaces[0],
      detail
    })
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.canReadProductionWorkflow.mockReturnValue(true)
    mocks.canStartProductionWorkflow.mockReturnValue(true)
    mocks.create.mockResolvedValue({ observationId: 'observation:one', reviewState: 'unreviewed' })
    mocks.updateReview.mockResolvedValue({
      observationId: 'observation:one',
      reviewState: 'confirmed'
    })
  })

  it('returns the private read model and never serves it without membership', async () => {
    const response = await GET(new Request('https://appsea.example'), { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'reviewed-seed-only', observations: [] }
    })

    mocks.canReadProductionWorkflow.mockReturnValue(false)
    const forbidden = await GET(new Request('https://appsea.example'), { params })
    expect(forbidden.status).toBe(403)
  })

  it('requires same origin and a bounded create contract', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await POST(new Request('https://appsea.example'), { params })
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({ claim: 'missing provenance' })
      }),
      { params }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates and reviews observations through the authenticated private boundary', async () => {
    const createResponse = await POST(
      new Request('https://appsea.example', {
        method: 'POST',
        body: JSON.stringify({
          observationId: 'observation:one',
          competitorId: 'competitor:one',
          sourceItemId: 'source-item:one',
          evidenceId: 'evidence:one',
          claimType: 'feature',
          claim: 'The competitor lacks a reliable export workflow.',
          observedAt: '2026-08-02T00:00:00.000Z',
          confidence: 0.84
        })
      }),
      { params }
    )
    expect(createResponse.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(
      'user:editor',
      'workspace:one',
      'opportunity:one',
      expect.objectContaining({ observationId: 'observation:one' })
    )

    const reviewResponse = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirmed' })
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          slug: 'opportunity-one',
          observationId: 'observation:one'
        })
      }
    )
    expect(reviewResponse.status).toBe(200)
    expect(mocks.updateReview).toHaveBeenCalledWith(
      'user:editor',
      'workspace:one',
      'opportunity:one',
      'observation:one',
      { action: 'confirmed' }
    )
  })
})
