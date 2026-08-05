import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transactionMocks = vi.hoisted(() => ({
  withAuthenticatedWorkspaceTransaction: vi.fn()
}))

vi.mock('./transaction', () => transactionMocks)

import {
  CompetitiveResearchObservationConflictError,
  CompetitiveResearchObservationPolicyError,
  PostgresCompetitiveResearchRepository
} from './competitive-research-repository'

const now = '2026-08-02T00:00:00.000Z'

const row: QueryResultRow = {
  workspace_id: 'workspace:one',
  observation_id: 'observation:one',
  opportunity_id: 'opportunity:one',
  competitor_id: 'competitor:one',
  source_id: 'source:directory',
  source_record_id: 'record-1',
  source_item_id: 'source-item:one',
  evidence_id: 'evidence:one',
  claim_type: 'feature',
  claim: 'The competitor lacks a reliable export workflow.',
  observed_at: now,
  captured_at: now,
  published_at: null,
  confidence: '0.84',
  review_state: 'confirmed',
  synthetic: false,
  allowed_representation: 'excerpt',
  canonical_locator: 'https://example.com/record-1',
  created_by: 'user:editor',
  reviewed_by: 'user:owner',
  reviewed_at: now,
  created_at: now,
  updated_at: now
}

describe('competitive research observation repository', () => {
  const query = vi.fn()
  const client = { query } as unknown as PoolClient

  beforeEach(() => {
    query.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockImplementation(
      async (
        _pool: Pool,
        userId: string,
        workspaceId: string,
        operation: (transactionClient: PoolClient) => Promise<unknown>
      ) => {
        expect(userId).toMatch(/^user:/)
        expect(workspaceId).toBe('workspace:one')
        return operation(client)
      }
    )
  })

  it('lists only active, workspace-bound observation provenance', async () => {
    query
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })

    const repository = new PostgresCompetitiveResearchRepository({} as Pool)
    const observations = await repository.listForUser(
      'user:editor',
      'workspace:one',
      'opportunity:one'
    )

    expect(observations).toEqual([
      expect.objectContaining({
        observationId: 'observation:one',
        sourceId: 'source:directory',
        sourceRecordId: 'record-1',
        evidenceId: 'evidence:one',
        reviewState: 'confirmed',
        confidence: 0.84
      })
    ])
    expect(query.mock.calls[1]?.[0]).toContain("source_item.deletion_state = 'active'")
    expect(query.mock.calls[1]?.[0]).toContain('evidence.evidence_id IS NOT NULL')
  })

  it('lists stable non-synthetic competitor targets for private observation writes', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          competitor_id: 'competitor:one',
          name: 'Export competitor',
          competitor_type: 'direct'
        }
      ],
      rowCount: 1
    })

    const repository = new PostgresCompetitiveResearchRepository({} as Pool)
    await expect(
      repository.listTargetsForUser('user:editor', 'workspace:one', 'opportunity:one')
    ).resolves.toEqual([
      { competitorId: 'competitor:one', name: 'Export competitor', type: 'direct' }
    ])
    expect(query.mock.calls[0]?.[0]).toContain('opportunity_competitors')
    expect(query.mock.calls[0]?.[0]).toContain('competitor.synthetic = false')
  })

  it('creates an unreviewed observation from source-item-derived provenance', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ role: 'editor' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ fixture_only: false, visibility: 'private' }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: 'source:directory',
            source_record_id: 'record-1',
            synthetic: false,
            requested_display_mode: 'excerpt'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ now }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ observation_id: 'observation:one' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...row, review_state: 'unreviewed' }], rowCount: 1 })

    const repository = new PostgresCompetitiveResearchRepository({} as Pool)
    const observation = await repository.create('user:editor', 'workspace:one', 'opportunity:one', {
      observationId: 'observation:one',
      competitorId: 'competitor:one',
      sourceItemId: 'source-item:one',
      evidenceId: 'evidence:one',
      claimType: 'feature',
      claim: 'The competitor lacks a reliable export workflow.',
      observedAt: now,
      confidence: 0.84
    })

    expect(observation.reviewState).toBe('unreviewed')
    expect(observation.synthetic).toBe(false)
    expect(observation.allowedRepresentation).toBe('excerpt')
    const insert = query.mock.calls[6]?.[0] as string
    expect(insert).toContain('appsea.competitor_research_observations')
    expect(insert).toContain("'unreviewed'")
    expect(query.mock.calls[6]?.[1]?.[4]).toBe('source:directory')
  })

  it('maps unique and source-policy failures to bounded errors', async () => {
    query.mockRejectedValueOnce({ code: '23505' })
    const repository = new PostgresCompetitiveResearchRepository({} as Pool)
    await expect(
      repository.create('user:editor', 'workspace:one', 'opportunity:one', {
        observationId: 'observation:one',
        competitorId: 'competitor:one',
        sourceItemId: 'source-item:one',
        evidenceId: 'evidence:one',
        claimType: 'feature',
        claim: 'A claim',
        observedAt: now,
        confidence: 0.5
      })
    ).rejects.toBeInstanceOf(CompetitiveResearchObservationConflictError)

    query.mockReset()
    query.mockRejectedValueOnce({ code: '42501' })
    await expect(
      repository.create('user:editor', 'workspace:one', 'opportunity:one', {
        observationId: 'observation:two',
        competitorId: 'competitor:one',
        sourceItemId: 'source-item:one',
        evidenceId: 'evidence:one',
        claimType: 'feature',
        claim: 'A claim',
        observedAt: now,
        confidence: 0.5
      })
    ).rejects.toBeInstanceOf(CompetitiveResearchObservationPolicyError)
  })

  it('records an explicit confirmed or rejected review under an editor actor', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ review_state: 'unreviewed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ observation_id: 'observation:one' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ ...row, review_state: 'rejected', reviewed_by: 'user:owner' }],
        rowCount: 1
      })

    const repository = new PostgresCompetitiveResearchRepository({} as Pool)
    const observation = await repository.updateReview(
      'user:owner',
      'workspace:one',
      'opportunity:one',
      'observation:one',
      { action: 'rejected' }
    )

    expect(observation.reviewState).toBe('rejected')
    expect(query.mock.calls[2]?.[0]).toContain('reviewed_at = clock_timestamp()')
    expect(query.mock.calls[2]?.[1]).toEqual([
      'workspace:one',
      'opportunity:one',
      'observation:one',
      'rejected',
      'user:owner'
    ])
  })
})
