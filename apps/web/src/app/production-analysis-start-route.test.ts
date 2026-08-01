import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/research/production/[runId]/analysis/route'
import {
  ProductionAnalysisAdmissionConflictError,
  ProductionAnalysisConcurrencyLimitError,
  ProductionAnalysisRateLimitError
} from '@appsea/db/production-analysis-admission'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  sameOriginRequest: vi.fn(),
  canStartProductionWorkflow: vi.fn(),
  readForAnalysis: vi.fn(),
  readApprovedForUser: vi.fn(),
  admitForUser: vi.fn(),
  prepareProductionAnalysisWorkflowStart: vi.fn(),
  startProductionAnalysisWorkflow: vi.fn(),
  errors: { ProductionCollectionAnalysisUnavailableError: class extends Error {} }
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('../server/production-workflow-gateway', () => ({
  canStartProductionWorkflow: mocks.canStartProductionWorkflow
}))
vi.mock('../server/temporal', () => ({ getTemporalWorkflowClient: vi.fn() }))
vi.mock('@appsea/db/production-collection', () => ({
  PostgresProductionCollectionRepository: class {
    readForAnalysis = mocks.readForAnalysis
  },
  ...mocks.errors
}))
vi.mock('@appsea/db/opportunity-seed-review', () => ({
  PostgresOpportunitySeedReviewRepository: class {
    readApprovedForUser = mocks.readApprovedForUser
  }
}))
vi.mock('@appsea/db/production-analysis-admission', () => ({
  PostgresProductionAnalysisAdmissionRepository: class {
    admitForUser = mocks.admitForUser
  },
  ProductionAnalysisAdmissionConflictError: class extends Error {},
  ProductionAnalysisConcurrencyLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('concurrency')
      this.retryAfterSeconds = retryAfterSeconds
    }
  },
  ProductionAnalysisRateLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('rate')
      this.retryAfterSeconds = retryAfterSeconds
    }
  }
}))
vi.mock('@appsea/workflows', () => ({
  startProductionAnalysisWorkflow: mocks.startProductionAnalysisWorkflow,
  prepareProductionAnalysisWorkflowStart: mocks.prepareProductionAnalysisWorkflowStart
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner', fixtureOnly: false }]
}

const seed = {
  id: 'opportunity:one',
  slug: 'reviewed-opportunity',
  name: 'Reviewed Opportunity',
  oneLine: 'A reviewed opportunity seed.',
  thesis: 'A reviewed thesis.',
  audience: 'A reviewed audience.',
  firstWedge: 'A reviewed first wedge.',
  tags: ['reviewed'],
  competitors: [],
  contraryEvidence: ['No contrary evidence was supplied.'],
  scoreFactors: {
    complaintVolume: 10,
    painSeverity: 20,
    recurrence: 30,
    willingnessToPay: 0,
    competitiveGap: 10,
    buildFeasibility: 30,
    evidenceQuality: 20,
    contraryEvidencePenalty: 10
  },
  planFiles: ['README.md']
}

const seedReview = {
  seedReviewId: 'seed-review:one',
  seedVersion: 'reviewed-seed-v1',
  seed,
  contentHash: 'a'.repeat(64),
  reviewState: 'approved',
  createdBy: 'user:owner',
  reviewedBy: 'user:owner',
  reviewedAt: '2026-07-26T00:00:00.000Z',
  approvedBy: 'user:owner',
  approvedAt: '2026-07-26T00:00:00.000Z',
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z'
}

function request(body: unknown): Request {
  return new Request('https://appsea.example', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'https://appsea.example' }
  })
}

describe('production analysis start route', () => {
  beforeEach(() => {
    mocks.readForAnalysis.mockReset()
    mocks.readApprovedForUser.mockReset()
    mocks.admitForUser.mockReset()
    mocks.prepareProductionAnalysisWorkflowStart.mockReset()
    mocks.startProductionAnalysisWorkflow.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.canStartProductionWorkflow.mockReturnValue(true)
    mocks.readForAnalysis.mockResolvedValue({
      collectionArtifactId: 'artifact:one',
      runId: 'run:one',
      request: {},
      policySnapshot: {},
      complaints: [],
      deletions: [],
      coverageGaps: [],
      warnings: []
    })
    mocks.readApprovedForUser.mockResolvedValue(seedReview)
    mocks.admitForUser.mockResolvedValue({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0,
      reservationExpiresAt: '2026-07-26T00:05:00.000Z'
    })
    mocks.prepareProductionAnalysisWorkflowStart.mockReturnValue({
      workflowId: 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      input: { idempotencyDigest: 'a'.repeat(64), inputHash: 'b'.repeat(64) }
    })
    mocks.startProductionAnalysisWorkflow.mockResolvedValue({
      workflowId: 'workflow:analysis:workspace:one:abc'
    })
  })

  it('requires origin, authentication, editor access, and strict review input', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(
      POST(request({}), {
        params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
      })
    ).resolves.toHaveProperty('status', 403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    await expect(
      POST(request({}), {
        params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.canStartProductionWorkflow.mockReturnValue(false)
    await expect(
      POST(request({}), {
        params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
      })
    ).resolves.toHaveProperty('status', 403)

    mocks.canStartProductionWorkflow.mockReturnValue(true)
    const invalid = await POST(request({ extra: true }), {
      params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
    })
    expect(invalid.status).toBe(400)
    expect(mocks.readForAnalysis).not.toHaveBeenCalled()
  })

  it('starts an identifier-only durable workflow after checking persisted evidence and seed review', async () => {
    const response = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      data: { workflowId: 'workflow:analysis:workspace:one:abc', analysisRunId: 'analysis:one' }
    })
    expect(mocks.readForAnalysis).toHaveBeenCalledWith('user:owner', 'workspace:one', 'run:one')
    expect(mocks.admitForUser).toHaveBeenCalledWith({
      workspaceId: 'workspace:one',
      userId: 'user:owner',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64)
    })
    expect(mocks.startProductionAnalysisWorkflow).toHaveBeenCalledTimes(1)
    expect(mocks.startProductionAnalysisWorkflow.mock.calls[0]?.[0]).toBeUndefined()
    expect(mocks.startProductionAnalysisWorkflow.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace:one',
        collectionRunId: 'run:one',
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        seedReviewId: 'seed-review:one',
        workflowVersion: 'production-analysis-v2',
        requestedBy: { actorType: 'user', actorId: 'user:owner' }
      })
    )
    expect(mocks.startProductionAnalysisWorkflow.mock.calls[0]?.[1]).not.toHaveProperty('artifact')
  })

  it('keeps an uncurated collection out of the analysis boundary', async () => {
    mocks.readForAnalysis.mockRejectedValue(
      new mocks.errors.ProductionCollectionAnalysisUnavailableError()
    )
    const response = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(response.status).toBe(422)
    expect(mocks.startProductionAnalysisWorkflow).not.toHaveBeenCalled()
  })

  it('carries deletion coverage gaps into an explicit active-evidence repair', async () => {
    const deletion = {
      sourceId: 'source:one',
      sourceRecordId: 'record:deleted',
      observedAt: '2026-07-26T01:00:00.000Z',
      reason: 'source deletion'
    }
    mocks.readForAnalysis.mockResolvedValue({
      collectionArtifactId: 'artifact:one',
      runId: 'run:one',
      request: {},
      policySnapshot: {},
      complaints: [{ id: 'complaint:active' }],
      deletions: [deletion],
      coverageGaps: ['One source record was deleted before re-analysis.'],
      warnings: []
    })
    const response = await POST(
      request({
        analysisRunId: 'analysis:repair',
        idempotencyKey: 'analysis-repair-idempotency',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(response.status).toBe(202)
    expect(mocks.startProductionAnalysisWorkflow).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        seedReviewId: 'seed-review:one',
        workflowVersion: 'production-analysis-v2'
      })
    )
  })

  it('keeps an unapproved seed out of the analysis boundary', async () => {
    mocks.readApprovedForUser.mockResolvedValue(null)
    const response = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(response.status).toBe(422)
    expect(mocks.startProductionAnalysisWorkflow).not.toHaveBeenCalled()
    expect(mocks.admitForUser).not.toHaveBeenCalled()
  })

  it('returns bounded admission failures without starting Temporal', async () => {
    mocks.admitForUser.mockRejectedValue(new ProductionAnalysisRateLimitError(42))
    const rate = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(rate.status).toBe(429)
    expect(rate.headers.get('retry-after')).toBe('42')

    mocks.admitForUser.mockRejectedValue(new ProductionAnalysisConcurrencyLimitError(60))
    const concurrency = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(concurrency.status).toBe(429)

    mocks.admitForUser.mockRejectedValue(new ProductionAnalysisAdmissionConflictError())
    const conflict = await POST(
      request({
        analysisRunId: 'analysis:one',
        idempotencyKey: 'analysis-idempotency-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        seedReviewId: 'seed-review:one'
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' }) }
    )
    expect(conflict.status).toBe(409)
    expect(mocks.startProductionAnalysisWorkflow).not.toHaveBeenCalled()
  })

  it('bounds chunked request bodies when content-length is unavailable', async () => {
    const response = await POST(request({ padding: 'x'.repeat(128 * 1024) }), {
      params: Promise.resolve({ workspaceId: 'workspace:one', runId: 'run:one' })
    })
    expect(response.status).toBe(413)
    expect(mocks.readForAnalysis).not.toHaveBeenCalled()
  })
})
