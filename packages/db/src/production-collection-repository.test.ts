import { describe, expect, it, vi } from 'vitest'
import { productionCollectionPersistenceInputSchema } from '@appsea/contracts'
import { contentHash } from './hash'

const mocks = vi.hoisted(() => ({
  handoffRows: [] as Array<Record<string, unknown>>,
  leaseAssertions: 0
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
  if (text.includes('SELECT fixture_only, status, visibility')) {
    return { rows: [{ fixture_only: false, status: 'active', visibility: 'private' }] }
  }
  if (text.includes('assert_source_collection_lease')) {
    mocks.leaseAssertions += 1
    return { rows: [{ active: true }] }
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
})
