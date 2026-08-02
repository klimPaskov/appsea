import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  listActiveWorkspaceIds: vi.fn(),
  markStarted: vi.fn(),
  reschedule: vi.fn(),
  fail: vi.fn(),
  readForAnalysisAsWorker: vi.fn(),
  readApprovedForWorker: vi.fn(),
  startProductionAnalysisWorkflow: vi.fn(),
  emitWorkerEvent: vi.fn()
}))

class MockProductionCollectionAnalysisUnavailableError extends Error {
  constructor() {
    super('not ready')
    this.name = 'ProductionCollectionAnalysisUnavailableError'
  }
}

vi.mock('@appsea/db', () => ({
  PostgresOpportunitySeedReviewRepository: class {
    readApprovedForWorker = mocks.readApprovedForWorker
  },
  PostgresProductionAnalysisRecomputeRepository: class {
    claimNext = mocks.claimNext
    listActiveWorkspaceIds = mocks.listActiveWorkspaceIds
    markStarted = mocks.markStarted
    reschedule = mocks.reschedule
    fail = mocks.fail
  },
  PostgresProductionCollectionRepository: class {
    readForAnalysisAsWorker = mocks.readForAnalysisAsWorker
  },
  ProductionCollectionAnalysisUnavailableError: MockProductionCollectionAnalysisUnavailableError
}))

vi.mock('@appsea/workflows', () => ({
  fixtureResearchTaskQueue: 'appsea-research-v1',
  startProductionAnalysisWorkflow: mocks.startProductionAnalysisWorkflow
}))

vi.mock('./observability', () => ({ emitWorkerEvent: mocks.emitWorkerEvent }))

const record = {
  workspaceId: 'workspace:one',
  recomputeId: 'recompute:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  opportunityId: 'opportunity:one',
  collectionRunId: 'run:one',
  seedReviewId: 'seed-review:one',
  sourceTombstoneId: 'tombstone:one',
  correctionId: null,
  analysisRunId: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  idempotencyKey: 'production-analysis-recompute-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  requestedAt: '2026-08-01T00:00:00.000Z',
  state: 'dispatching' as const,
  attemptCount: 1,
  workflowId: null,
  failureCode: null,
  failureSummary: null,
  nextAttemptAt: '2026-08-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  updatedAt: '2026-08-01T00:00:00.000Z'
}

describe('production analysis recomputation dispatcher', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.claimNext.mockResolvedValue(null)
    mocks.listActiveWorkspaceIds.mockResolvedValue(['workspace:one'])
    mocks.readForAnalysisAsWorker.mockResolvedValue({
      collectionArtifactId: 'collection-artifact:one',
      runId: 'run:one',
      request: { sourceId: 'source:one' },
      policySnapshot: { sourceId: 'source:one' },
      complaints: [{ id: 'complaint:one' }],
      deletions: [{ sourceId: 'source:one', sourceRecordId: 'record:deleted' }],
      coverageGaps: ['A deleted record is excluded.'],
      warnings: []
    })
    mocks.readApprovedForWorker.mockResolvedValue({
      seedReviewId: 'seed-review:one',
      seedVersion: 'seed-v1',
      seed: { id: 'opportunity:one' },
      contentHash: 'a'.repeat(64),
      reviewedBy: 'user:owner',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'user:owner',
      createdAt: '2026-08-01T00:00:00.000Z'
    })
    mocks.startProductionAnalysisWorkflow.mockResolvedValue({
      workflowId: 'workflow:analysis:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
    mocks.markStarted.mockResolvedValue({
      ...record,
      state: 'started',
      workflowId: 'workflow:analysis:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
    mocks.reschedule.mockResolvedValue({ ...record, state: 'blocked' })
    mocks.fail.mockResolvedValue({ ...record, state: 'failed' })
  })

  it('starts an identifier-only workflow after checking active evidence and seed lineage', async () => {
    mocks.claimNext.mockResolvedValueOnce(record).mockResolvedValueOnce(null)
    const { createProductionAnalysisRecomputeDispatcher } =
      await import('./production-analysis-recompute')
    const dispatcher = createProductionAnalysisRecomputeDispatcher({} as never, {} as never)

    const started = await dispatcher.dispatchOne('workspace:one')

    expect(started?.state).toBe('started')
    expect(mocks.startProductionAnalysisWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        analysisRunId: record.analysisRunId,
        idempotencyKey: record.idempotencyKey,
        seedReviewId: record.seedReviewId,
        workflowVersion: 'production-analysis-v2'
      })
    )
  })

  it('blocks a missing or mismatched approved seed without starting a workflow', async () => {
    mocks.claimNext.mockResolvedValueOnce(record)
    mocks.readApprovedForWorker.mockResolvedValue(null)
    const { createProductionAnalysisRecomputeDispatcher } =
      await import('./production-analysis-recompute')
    const dispatcher = createProductionAnalysisRecomputeDispatcher({} as never, {} as never)

    const blocked = await dispatcher.dispatchOne('workspace:one')

    expect(blocked?.state).toBe('blocked')
    expect(mocks.reschedule).toHaveBeenCalledWith(
      record.workspaceId,
      record.recomputeId,
      'seed_not_approved',
      expect.any(String),
      300
    )
    expect(mocks.startProductionAnalysisWorkflow).not.toHaveBeenCalled()
  })

  it('requeues a repair when active confirmed evidence is not ready', async () => {
    mocks.claimNext.mockResolvedValueOnce(record)
    mocks.readForAnalysisAsWorker.mockRejectedValue(
      new MockProductionCollectionAnalysisUnavailableError()
    )
    const { createProductionAnalysisRecomputeDispatcher } =
      await import('./production-analysis-recompute')
    const dispatcher = createProductionAnalysisRecomputeDispatcher({} as never, {} as never)

    const retry = await dispatcher.dispatchOne('workspace:one')

    expect(retry).toBeNull()
    expect(mocks.reschedule).toHaveBeenCalledWith(
      record.workspaceId,
      record.recomputeId,
      'analysis_not_ready',
      expect.any(String),
      300
    )
  })
})
