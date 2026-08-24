import { describe, expect, it, vi } from 'vitest'
import { analyzeComplaint } from '@appsea/research'
import { productionCollectionPersistenceInputSchema } from '@appsea/contracts'
import { contentHash } from './hash'

const mocks = vi.hoisted(() => ({
  handoffRows: [] as Array<Record<string, unknown>>,
  leaseAssertions: 0,
  recollectionRows: [] as Array<Record<string, unknown>>,
  reviewRows: [] as Array<Record<string, unknown>>,
  correctionRows: [] as Array<Record<string, unknown>>,
  queryLog: [] as string[]
}))

vi.mock('./transaction', () => ({
  withAuthenticatedWorkspaceTransaction: async (
    _pool: unknown,
    _userId: string,
    _workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => operation({ query: fakeQuery }),
  withWorkspaceTransaction: async (
    _pool: unknown,
    _workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => operation({ query: fakeQuery })
}))

const at = '2026-07-26T00:00:00.000Z'
const snapshot = {
  mode: 'production-collection',
  artifactId: 'collection-artifact:one',
  requestHash: 'a'.repeat(64),
  sourceId: 'source:cfpb',
  policyVersion: 'cfpb-v1',
  query: 'billing',
  limit: 10,
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt',
  sourceItemCount: 0,
  evidenceCount: 0,
  complaintCount: 0,
  deletionCount: 0,
  costMicros: 17,
  coverageGaps: ['No evidence was retained in this bounded repository test.'],
  warnings: [],
  capturedAt: at
}

const run = {
  run_id: 'run:production:one',
  campaign_id: 'campaign:production:one',
  idempotency_key: 'collection-idempotency-key',
  input_hash: 'a'.repeat(64),
  state: 'completed',
  artifact_id: 'collection-artifact:one',
  artifact_snapshot: snapshot,
  completed_at: at,
  requested_at: at
}

const persistenceInput = productionCollectionPersistenceInputSchema.parse({
  request: {
    workspaceId: 'workspace:one',
    campaignId: 'campaign:production:one',
    runId: 'run:production:one',
    idempotencyKey: 'a'.repeat(64),
    sourceId: 'source:cfpb',
    policyVersion: 'cfpb-v1',
    query: 'billing',
    limit: 1,
    purpose: 'opportunity-research',
    requestedDisplayMode: 'excerpt',
    budget: {
      currency: 'USD',
      maxSourceItems: 1,
      maxCostMicros: 0,
      maxActivityAttempts: 1
    },
    requestedAt: at
  },
  observedAt: at,
  costMicros: 17,
  policy: {
    sourceId: 'source:cfpb',
    displayName: 'Test source',
    sourceType: 'api',
    enabled: true,
    policyState: 'approved',
    permittedPurposes: ['opportunity-research'],
    commercialUse: 'allowed',
    accessMethod: 'official API',
    retentionDays: 30,
    deletionRequired: true,
    attributionRequired: true,
    displayMode: 'excerpt',
    coverageNotes: ['test'],
    reviewedAt: at,
    policyDocumentRef: 'https://example.com/policy'
  },
  complaints: [],
  deletions: [],
  warnings: []
})

async function fakeQuery(text: string): Promise<{ rows: unknown[] }> {
  mocks.queryLog.push(text)
  if (text.includes('SELECT fixture_only, status, visibility')) {
    return { rows: [{ fixture_only: false, status: 'active', visibility: 'private' }] }
  }
  if (text.includes('SELECT role') && text.includes('FROM appsea.workspace_memberships')) {
    return { rows: [{ role: 'editor' }] }
  }
  if (text.includes('SELECT complaint.complaint_id, complaint.review_state')) {
    return { rows: mocks.reviewRows }
  }
  if (text.includes('apply_complaint_analysis_correction')) {
    return { rows: mocks.correctionRows }
  }
  if (text.includes('UPDATE appsea.complaint_observations')) {
    return { rows: [] }
  }
  if (text.includes('assert_source_collection_lease')) {
    mocks.leaseAssertions += 1
    return { rows: [{ active: true }] }
  }
  if (text.includes('FROM appsea.deletion_tombstones')) {
    return { rows: mocks.recollectionRows }
  }
  if (text.includes('FROM appsea.research_runs')) return { rows: [run] }
  if (text.includes('FROM appsea.production_analysis_handoffs')) {
    return { rows: mocks.handoffRows }
  }
  if (
    text.includes('FROM appsea.research_run_source_items') ||
    text.includes('FROM appsea.research_run_source_policies')
  ) {
    return { rows: [] }
  }
  throw new Error(`Unexpected collection read query: ${text}`)
}

describe('production collection read model', () => {
  it('reads only completed source-matching tombstone lineage', async () => {
    mocks.recollectionRows = [
      {
        tombstone_id: 'tombstone:source:one',
        source_id: 'source:cfpb',
        source_record_id: '123456',
        reason: 'source_retention_expired',
        completed_at: at,
        active_source_item: false,
        active_workflow_id: null
      }
    ]
    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const target = await new PostgresProductionCollectionRepository(
      {} as never
    ).readRecollectionTarget('workspace:one', 'tombstone:source:one', 'source:cfpb')

    expect(target).toEqual({
      tombstoneId: 'tombstone:source:one',
      sourceId: 'source:cfpb',
      sourceRecordId: '123456',
      reason: 'source_retention_expired',
      activeSourceItem: false,
      activeWorkflowId: null,
      completedAt: at
    })
    mocks.recollectionRows = []
  })

  it('lists bounded completed lineage without crossing the tenant boundary', async () => {
    mocks.recollectionRows = [
      {
        tombstone_id: 'tombstone:source:two',
        source_id: 'source:cfpb',
        source_record_id: '654321',
        reason: 'source_retention_expired',
        completed_at: '2026-07-27T00:00:00.000Z',
        active_source_item: true,
        active_workflow_id: 'workflow:production:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      },
      {
        tombstone_id: 'tombstone:source:one',
        source_id: 'source:cfpb',
        source_record_id: '123456',
        reason: 'source_owner_deleted',
        completed_at: at,
        active_source_item: false,
        active_workflow_id: null
      }
    ]
    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const targets = await new PostgresProductionCollectionRepository(
      {} as never
    ).listRecollectionTargetsForUser('user:one', 'workspace:one', {
      sourceId: 'source:cfpb',
      limit: 2
    })

    expect(targets).toEqual([
      {
        tombstoneId: 'tombstone:source:two',
        sourceId: 'source:cfpb',
        sourceRecordId: '654321',
        reason: 'source_retention_expired',
        completedAt: '2026-07-27T00:00:00.000Z',
        activeSourceItem: true,
        activeWorkflowId: 'workflow:production:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      },
      {
        tombstoneId: 'tombstone:source:one',
        sourceId: 'source:cfpb',
        sourceRecordId: '123456',
        reason: 'source_owner_deleted',
        completedAt: at,
        activeSourceItem: false,
        activeWorkflowId: null
      }
    ])
    expect(mocks.queryLog.at(-1)).toContain('LIMIT $3')
    mocks.recollectionRows = []
  })

  it('hydrates the bounded private analysis handoff status', async () => {
    mocks.handoffRows = [
      {
        handoff_id: 'handoff:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        collection_workflow_id:
          'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        collection_run_id: 'run:production:one',
        seed_review_id: 'seed-review:billing',
        analysis_run_id: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        state: 'started',
        attempt_count: '1',
        workflow_id: 'workflow:analysis:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        failure_code: null,
        failure_summary: null,
        requested_at: at,
        next_attempt_at: at,
        started_at: at,
        finished_at: null,
        updated_at: at
      }
    ]

    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const readModel = await new PostgresProductionCollectionRepository({} as never).readForUser(
      'user:one',
      'workspace:one',
      'run:production:one'
    )

    expect(readModel?.analysisHandoff).toMatchObject({
      handoffId: 'handoff:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'started',
      attemptCount: 1,
      analysisRunId: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
  })

  it('returns a null status for collections without an automatic handoff', async () => {
    mocks.handoffRows = []
    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const readModel = await new PostgresProductionCollectionRepository({} as never).readForUser(
      'user:one',
      'workspace:one',
      'run:production:one'
    )

    expect(readModel?.analysisHandoff).toBeNull()
  })

  it('groups every policy field used by source coverage eligibility', async () => {
    mocks.queryLog = []
    mocks.handoffRows = []
    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')

    await new PostgresProductionCollectionRepository({} as never).readForUser(
      'user:one',
      'workspace:one',
      'run:production:one'
    )

    const sourceCoverageQuery = mocks.queryLog.find((query) =>
      query.includes('FROM appsea.research_run_source_policies')
    )
    expect(sourceCoverageQuery).toContain('policy.source_id')
    expect(sourceCoverageQuery).toContain('source.current_policy_version')
    expect(sourceCoverageQuery).toContain('policy.policy_version')
    expect(sourceCoverageQuery).toContain('policy.commercial_use')
    expect(sourceCoverageQuery).toContain('policy.content_hash')
  })

  it('locks and rechecks the source lease inside the persistence transaction', async () => {
    mocks.leaseAssertions = 0
    run.input_hash = contentHash(persistenceInput)

    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const result = await new PostgresProductionCollectionRepository({} as never).persistWithLease(
      persistenceInput,
      { leaseId: 'lease:source-collection:test', inputHash: 'b'.repeat(64) }
    )

    expect(result.replayed).toBe(true)
    expect(result.costMicros).toBe(17)
    expect(mocks.leaseAssertions).toBe(1)
  })

  it('persists a derived-only correction and reports invalidated projections', async () => {
    mocks.queryLog = []
    mocks.reviewRows = [
      {
        complaint_id: 'complaint:one',
        review_state: 'confirmed',
        evidence_state: 'active',
        source_state: 'active',
        analysis_snapshot: analyzeComplaint({
          id: 'complaint:one',
          sourceId: 'source:cfpb',
          sourceRecordId: 'record:one',
          canonicalLocator: null,
          capturedAt: at,
          publishedAt: null,
          query: 'billing',
          product: 'Product',
          company: 'Company',
          feature: 'Feature',
          category: 'Reliability',
          text: 'The feature fails repeatedly.',
          language: 'en',
          synthetic: false,
          redacted: true,
          allowedRepresentation: 'excerpt'
        })
      }
    ]
    mocks.correctionRows = [
      {
        review_state: 'corrected',
        invalidated_analysis_count: '1',
        invalidated_opportunity_count: '1'
      }
    ]

    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const result = await new PostgresProductionCollectionRepository(
      {} as never
    ).updateComplaintReview('user:one', 'workspace:one', 'run:production:one', 'complaint:one', {
      action: 'corrected',
      correctionId: 'correction:analysis:one',
      analysisCorrection: { severity: 5 }
    })

    expect(result).toMatchObject({
      complaintId: 'complaint:one',
      reviewState: 'corrected',
      invalidatedAnalysisCount: 1,
      invalidatedOpportunityCount: 1,
      analysis: { severity: 5, reviewState: 'corrected' }
    })
    expect(
      mocks.queryLog.some((query) => query.includes('apply_complaint_analysis_correction'))
    ).toBe(true)
    expect(mocks.queryLog.some((query) => query.includes('SET review_state = $4'))).toBe(false)
    mocks.reviewRows = []
    mocks.correctionRows = []
  })

  it('changes only review state for confirm/reject actions', async () => {
    mocks.queryLog = []
    mocks.reviewRows = [
      {
        complaint_id: 'complaint:one',
        review_state: 'unreviewed',
        evidence_state: 'active',
        source_state: 'active',
        analysis_snapshot: analyzeComplaint({
          id: 'complaint:one',
          sourceId: 'source:cfpb',
          sourceRecordId: 'record:one',
          canonicalLocator: null,
          capturedAt: at,
          publishedAt: null,
          query: 'billing',
          product: 'Product',
          company: 'Company',
          feature: 'Feature',
          category: 'Reliability',
          text: 'The feature fails repeatedly.',
          language: 'en',
          synthetic: false,
          redacted: true,
          allowedRepresentation: 'excerpt'
        })
      }
    ]

    const { PostgresProductionCollectionRepository } =
      await import('./production-collection-repository')
    const result = await new PostgresProductionCollectionRepository(
      {} as never
    ).updateComplaintReview('user:one', 'workspace:one', 'run:production:one', 'complaint:one', {
      action: 'confirmed'
    })

    expect(result.reviewState).toBe('confirmed')
    const update = mocks.queryLog.find((query) =>
      query.includes('UPDATE appsea.complaint_observations')
    )
    expect(update).toContain('SET review_state = $4')
    expect(update).not.toContain('analysis_snapshot')
    mocks.reviewRows = []
  })
})
