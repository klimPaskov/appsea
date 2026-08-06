import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentHash } from './hash'

const transactionMocks = vi.hoisted(() => ({
  withAuthenticatedWorkspaceTransaction: vi.fn(),
  withDatabaseTransaction: vi.fn()
}))

vi.mock('./transaction', () => transactionMocks)

import { PostgresSourcePolicyRepository } from './source-policy-repository'

const now = '2026-08-01T00:00:00.000Z'

const pendingPolicy = {
  sourceId: 'cfpb-consumer-complaints',
  displayName: 'CFPB Consumer Complaint Database',
  sourceType: 'api' as const,
  enabled: false,
  policyState: 'pending_review' as const,
  permittedPurposes: ['opportunity-research'],
  commercialUse: 'allowed' as const,
  accessMethod: 'Official API',
  retentionDays: 30,
  deletionRequired: true,
  attributionRequired: true,
  displayMode: 'excerpt' as const,
  coverageNotes: ['Historical export is not covered.'],
  reviewedAt: now,
  policyOwner: 'review queue',
  policyDocumentRef: 'https://example.com/policy',
  expiresAt: '2026-10-25T00:00:00.000Z',
  quota: {
    requestsPerMinute: 6,
    maxRecordsPerRequest: 1000,
    maxRecordsPerRun: 1000,
    costPerRequestMicros: 0
  },
  deletion: {
    sourceRecordIdField: 'complaint_id',
    supportsTombstones: false,
    deletionPollIntervalHours: 24,
    retentionAction: 'redact' as const
  }
}

const fixturePolicy = {
  ...pendingPolicy,
  sourceId: 'fixture-community-feed',
  displayName: 'Synthetic community fixture',
  sourceType: 'fixture' as const,
  enabled: true,
  policyState: 'approved' as const,
  permittedPurposes: ['testing'],
  accessMethod: 'Repository fixture',
  retentionDays: 0,
  deletionRequired: false,
  attributionRequired: false,
  displayMode: 'fixture' as const,
  coverageNotes: ['Synthetic examples only.'],
  policyDocumentRef: null,
  expiresAt: null
}

function rowFor(
  policy: typeof pendingPolicy | typeof fixturePolicy,
  overrides: { lifecycleState: string; enabled: boolean; collectible: boolean }
): QueryResultRow {
  return {
    source_id: policy.sourceId,
    display_name: policy.displayName,
    source_type: policy.sourceType,
    lifecycle_state: overrides.lifecycleState,
    current_policy_version: `${policy.sourceId}-v1`,
    policy_version: `${policy.sourceId}-v1`,
    policy_state: policy.policyState,
    permitted_purposes: policy.permittedPurposes,
    commercial_use: policy.commercialUse,
    access_method: policy.accessMethod,
    retention_days: policy.retentionDays,
    deletion_required: policy.deletionRequired,
    attribution_required: policy.attributionRequired,
    display_mode: policy.displayMode,
    coverage_notes: policy.coverageNotes,
    policy_document_ref: policy.policyDocumentRef,
    reviewed_at: policy.reviewedAt,
    expires_at: policy.expiresAt,
    policy_payload: policy,
    content_hash: contentHash(policy),
    enabled: overrides.enabled,
    collectible: overrides.collectible
  }
}

describe('source policy registry repository', () => {
  const query = vi.fn()
  const client = { query } as unknown as PoolClient

  beforeEach(() => {
    query.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockReset()
    transactionMocks.withDatabaseTransaction.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockImplementation(
      async (
        _pool: Pool,
        userId: string,
        workspaceId: string,
        operation: (transactionClient: PoolClient) => Promise<unknown>
      ) => {
        expect(userId).toBe('user:editor')
        expect(workspaceId).toBe('workspace:one')
        return operation(client)
      }
    )
    transactionMocks.withDatabaseTransaction.mockImplementation(
      async (_pool: Pool, operation: (transactionClient: PoolClient) => Promise<unknown>) =>
        operation(client)
    )
    query.mockResolvedValue({
      rows: [
        rowFor(pendingPolicy, {
          lifecycleState: 'disabled_pending_review',
          enabled: false,
          collectible: false
        }),
        rowFor(fixturePolicy, { lifecycleState: 'active', enabled: true, collectible: false }),
        {
          source_id: 'manual-source',
          display_name: 'Manual source awaiting registration',
          source_type: 'manual',
          lifecycle_state: 'disabled_pending_review',
          current_policy_version: null,
          policy_version: null,
          policy_state: null,
          permitted_purposes: null,
          commercial_use: null,
          access_method: null,
          retention_days: null,
          deletion_required: null,
          attribution_required: null,
          display_mode: null,
          coverage_notes: null,
          policy_document_ref: null,
          reviewed_at: null,
          expires_at: null,
          policy_payload: null,
          content_hash: null,
          enabled: false,
          collectible: false
        }
      ]
    })
  })

  it('lists policy readiness through an authenticated read-only projection', async () => {
    const repository = new PostgresSourcePolicyRepository({} as Pool)
    const sources = await repository.listForUser('user:editor', 'workspace:one')

    expect(sources).toHaveLength(3)
    expect(sources[0]).toMatchObject({
      sourceId: 'cfpb-consumer-complaints',
      policyState: 'pending_review',
      enabled: false,
      collectible: false,
      synthetic: false,
      quota: pendingPolicy.quota,
      deletion: pendingPolicy.deletion
    })
    expect(sources[1]).toMatchObject({
      sourceId: 'fixture-community-feed',
      enabled: true,
      collectible: false,
      synthetic: true
    })
    expect(sources[2]).toMatchObject({
      sourceId: 'manual-source',
      policyState: null,
      enabled: false,
      collectible: false
    })
    expect(sources[0]).not.toHaveProperty('policyOwner')
    expect(sources[0]).not.toHaveProperty('contentHash')
    expect(sources[0]).not.toHaveProperty('policyPayload')

    const statement = query.mock.calls[0]?.[0] as string
    expect(statement).toContain('source_policy_has_complete_reviews')
    expect(statement).toContain('clock_timestamp()')
    expect(statement).toContain('production_collection_workflow_jobs')
    expect(statement).toContain('deletion_tombstones')
    expect(statement).toContain('read_source_quota_headroom')
    expect(transactionMocks.withAuthenticatedWorkspaceTransaction).toHaveBeenCalledWith(
      {},
      'user:editor',
      'workspace:one',
      expect.any(Function),
      { readOnly: true }
    )
  })

  it('maps bounded connector health without exposing failure text', async () => {
    query.mockResolvedValue({
      rows: [
        {
          ...rowFor(pendingPolicy, {
            lifecycleState: 'active',
            enabled: true,
            collectible: true
          }),
          health_state: 'degraded',
          health_last_attempt_at: '2026-08-01T01:00:00.000Z',
          health_last_observed_at: '2026-07-31T01:00:00.000Z',
          health_last_successful_collection_at: '2026-07-31T01:00:00.000Z',
          health_last_failure_code: 'activity_failed',
          health_last_record_count: '42',
          health_active_record_count: '40',
          health_last_cost_micros: '1200',
          health_open_deletion_count: '2',
          health_note: 'raw provider response must not cross the read boundary'
        }
      ]
    })
    const repository = new PostgresSourcePolicyRepository({} as Pool)

    const [source] = await repository.listForUser('user:editor', 'workspace:one')

    expect(source?.health).toEqual({
      state: 'degraded',
      lastAttemptAt: '2026-08-01T01:00:00.000Z',
      lastSuccessfulCollectionAt: '2026-07-31T01:00:00.000Z',
      lastFailureCode: 'activity_failed',
      lastRecordCount: 42,
      activeRecordCount: 40,
      lastCostMicros: 1200,
      openDeletionCount: 2,
      note: 'No completed collection has been observed for this workspace.',
      quota: expect.objectContaining({
        state: 'unknown',
        requestsPerMinute: 6,
        requestsUsed: null,
        requestsRemaining: null,
        note: 'Quota usage has not been observed for the current source window.'
      }),
      freshness: expect.objectContaining({
        state: 'unknown',
        lastObservedAt: '2026-07-31T01:00:00.000Z',
        ageHours: expect.any(Number),
        expectedIntervalHours: null,
        allowedDelayHours: null,
        note: 'Freshness is not configured for this source.'
      })
    })
    expect(source).not.toHaveProperty('failureSummary')
  })

  it('reads only the maintenance source-health projection', async () => {
    query.mockResolvedValue({
      rows: [
        {
          source_id: 'cfpb-consumer-complaints',
          collectible: true,
          health_state: 'degraded',
          health_last_attempt_at: '2026-08-06T10:00:00.000Z',
          freshness_state: 'stale',
          freshness_age_hours: '30',
          quota_state: 'exhausted'
        }
      ]
    })
    const repository = new PostgresSourcePolicyRepository({} as Pool)

    await expect(
      repository.listSourceHealthAlertObservations('workspace:one', 25)
    ).resolves.toEqual([
      {
        sourceId: 'cfpb-consumer-complaints',
        collectible: true,
        healthState: 'degraded',
        healthLastAttemptAt: '2026-08-06T10:00:00.000Z',
        freshnessState: 'stale',
        freshnessAgeHours: 30,
        quotaState: 'exhausted'
      }
    ])
    expect(query.mock.calls[0]?.[0]).toContain('read_source_health_alert_observations')
    expect(query.mock.calls[0]?.[1]).toEqual(['workspace:one', 25])
    expect(transactionMocks.withDatabaseTransaction).toHaveBeenCalledWith(
      {},
      expect.any(Function),
      { readOnly: true }
    )
  })

  it('rejects an unbounded maintenance source-health limit', async () => {
    const repository = new PostgresSourcePolicyRepository({} as Pool)
    await expect(
      repository.listSourceHealthAlertObservations('workspace:one', 101)
    ).rejects.toThrow(/between 1 and 100/)
    expect(query).not.toHaveBeenCalled()
  })

  it('maps the current-minute quota window without exposing reservation rows', async () => {
    query.mockResolvedValue({
      rows: [
        {
          ...rowFor(pendingPolicy, {
            lifecycleState: 'active',
            enabled: true,
            collectible: true
          }),
          quota_window_started_at: '2026-08-06T10:00:00.000Z',
          quota_window_ends_at: '2026-08-06T10:01:00.000Z',
          quota_requests_used: '5',
          quota_requests_remaining: '1',
          health_state: 'healthy',
          health_note: 'A completed collection or retained private observation is available.'
        }
      ]
    })
    const repository = new PostgresSourcePolicyRepository({} as Pool)

    const [source] = await repository.listForUser('user:editor', 'workspace:one')

    expect(source?.health.quota).toEqual({
      state: 'near_limit',
      windowStartedAt: '2026-08-06T10:00:00.000Z',
      windowEndsAt: '2026-08-06T10:01:00.000Z',
      requestsPerMinute: 6,
      requestsUsed: 5,
      requestsRemaining: 1,
      note: 'Quota is near the current source limit.'
    })
    expect(source).not.toHaveProperty('quotaReservations')
  })

  it('fails closed when a source health counter exceeds the bounded read model', async () => {
    query.mockResolvedValue({
      rows: [
        {
          ...rowFor(pendingPolicy, {
            lifecycleState: 'active',
            enabled: true,
            collectible: true
          }),
          health_state: 'healthy',
          health_last_record_count: '5001'
        }
      ]
    })
    const repository = new PostgresSourcePolicyRepository({} as Pool)

    await expect(repository.listForUser('user:editor', 'workspace:one')).rejects.toThrow(
      /source health counter/
    )
  })

  it('fails closed when a stored policy payload is wired to another source', async () => {
    const mismatchedPolicy = { ...pendingPolicy, sourceId: 'other-source' }
    query.mockResolvedValue({
      rows: [
        {
          ...rowFor(pendingPolicy, {
            lifecycleState: 'disabled_pending_review',
            enabled: false,
            collectible: false
          }),
          policy_payload: mismatchedPolicy,
          content_hash: contentHash(mismatchedPolicy)
        }
      ]
    })
    const repository = new PostgresSourcePolicyRepository({} as Pool)

    await expect(repository.listForUser('user:editor', 'workspace:one')).rejects.toThrow(
      /source identity check/
    )
  })
})
