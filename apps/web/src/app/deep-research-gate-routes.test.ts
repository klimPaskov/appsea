import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, PATCH } from './api/workspaces/[workspaceId]/opportunities/[slug]/research-gate/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  readPrivateOpportunityContext: vi.fn(),
  sameOriginRequest: vi.fn(),
  canReadProductionWorkflow: vi.fn(),
  canStartProductionWorkflow: vi.fn(),
  transition: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
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
vi.mock('@appsea/db/deep-research-gate', () => ({
  DeepResearchGateBlockedError: class extends Error {
    gate: unknown
    constructor(gate: unknown) {
      super('blocked')
      this.gate = gate
    }
  },
  DeepResearchGateConflictError: class extends Error {},
  DeepResearchGateNotFoundError: class extends Error {},
  DeepResearchGatePermissionError: class extends Error {},
  PostgresDeepResearchGateRepository: class {
    transition(...args: unknown[]) {
      return mocks.transition(...args)
    }
  }
}))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [
    { workspaceId: 'workspace:one', role: 'owner', fixtureOnly: false, visibility: 'private' }
  ]
}
const detail = {
  opportunity: { id: 'opportunity:one' },
  summary: { synthetic: false },
  deepResearchGate: null
}
const params = Promise.resolve({ workspaceId: 'workspace:one', slug: 'opportunity-one' })

function checks() {
  const check = { state: 'pass' as const, note: 'Reviewed.', evidenceIds: ['evidence:one'] }
  return {
    coherentCluster: check,
    provenanceComplete: check,
    copiedContentInfluence: check,
    uniqueAuthorEstimate: check,
    contraryEvidenceSearch: check,
    competitorCoverage: check,
    substituteCoverage: check,
    sourceGapsReviewed: check,
    policyRisksReviewed: check,
    reproducibleSnapshot: check,
    manipulationRiskReviewed: check,
    extractionAgreement: check
  }
}

describe('deep-research gate routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.requireRecentMutationStepUp.mockReset()
    mocks.readPrivateOpportunityContext.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.canReadProductionWorkflow.mockReset()
    mocks.canStartProductionWorkflow.mockReset()
    mocks.transition.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.readPrivateOpportunityContext.mockResolvedValue({
      session,
      workspace: session.workspaces[0],
      detail
    })
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.canReadProductionWorkflow.mockReturnValue(true)
    mocks.canStartProductionWorkflow.mockReturnValue(true)
    mocks.transition.mockResolvedValue({
      version: 'deep-research-gate-v1.0.0',
      gateId: 'deep-research-gate:one',
      opportunityId: 'opportunity:one',
      analysisRunId: 'analysis:one',
      artifactId: 'artifact:one',
      snapshotHash: 'a'.repeat(64),
      status: 'not-ready',
      checks: checks(),
      confirmedObservationIds: [],
      sourceIds: [],
      evidenceIds: [],
      contraryObservationIds: [],
      competitorRelationTypes: [],
      blockingReasons: ['A contrary signal is required.'],
      coverageGaps: ['Coverage remains incomplete.'],
      createdBy: 'user:owner',
      createdAt: '2026-08-05T00:00:00.000Z',
      passedBy: null,
      passedAt: null,
      withdrawnBy: null,
      withdrawnAt: null,
      updatedAt: '2026-08-05T00:00:00.000Z'
    })
  })

  it('reads a private gate only for workspace members', async () => {
    const response = await GET(new Request('https://appsea.example'), { params })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: null })
    mocks.canReadProductionWorkflow.mockReturnValue(false)
    expect((await GET(new Request('https://appsea.example'), { params })).status).toBe(403)
  })

  it('enforces same-origin, strict checks, and recent step-up before transition', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    expect(
      (await PATCH(new Request('https://appsea.example', { method: 'PATCH' }), { params })).status
    ).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'pass' })
      }),
      { params }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.transition).not.toHaveBeenCalled()

    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent reauthentication required' }, { status: 428 })
    )
    const stale = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'pass', checks: checks() })
      }),
      { params }
    )
    expect(stale.status).toBe(428)
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('passes the authenticated transition to the repository and exposes blockers as conflicts', async () => {
    const response = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'submit', checks: checks(), notes: ['Review again'] })
      }),
      { params }
    )
    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'opportunity:one',
      expect.objectContaining({ action: 'submit' })
    )
  })
})
