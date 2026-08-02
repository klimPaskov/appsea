import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { PostgresResearchCampaignOrchestrationRepository } from './research-campaign-orchestration-repository'

const now = '2026-08-02T12:00:00.000Z'

const configuration = {
  schemaVersion: 'campaign-v1' as const,
  goal: 'Find recurring complaints across approved sources',
  query: 'billing',
  seeds: ['billing'],
  sourceIds: ['cfpb-consumer-complaints', 'stackexchange-stackoverflow'],
  languages: ['en'],
  geographies: ['US'],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 25,
  refreshPolicy: 'manual' as const,
  sensitiveTopicPolicy: 'review' as const,
  requestedDisplayMode: 'metadata-only' as const
}

const budget = {
  currency: 'USD' as const,
  maxSourceItems: 25,
  maxCostMicros: 1_000_000,
  maxActivityAttempts: 3
}

function parentRow() {
  return {
    workspace_id: 'workspace:one',
    orchestration_id: 'run:campaign:multi',
    campaign_id: 'campaign:one',
    idempotency_digest: 'a'.repeat(64),
    input_hash: 'b'.repeat(64),
    requested_by_actor_type: 'user' as const,
    requested_by_actor_id: 'user:one',
    analysis_seed_review_id: null,
    state: 'queued',
    source_count: 2,
    completed_source_count: 0,
    failed_source_count: 0,
    failure_code: null,
    failure_summary: null,
    requested_at: now,
    started_at: null,
    updated_at: now,
    finished_at: null,
    cancellation_requested_at: null,
    cancellation_requested_by: null,
    cancellation_request_id: null
  }
}

function childRows() {
  return configuration.sourceIds.map((sourceId, index) => ({
    workspace_id: 'workspace:one',
    orchestration_id: 'run:campaign:multi',
    source_id: sourceId,
    child_run_id: `run:campaign-source:${index + 1}`,
    state: 'queued',
    policy_version: null,
    workflow_id: null,
    attempt_count: 0,
    claim_owner: null,
    claim_token: null,
    claim_until: null,
    next_attempt_at: null,
    failure_code: null,
    failure_summary: null,
    requested_at: now,
    started_at: null,
    updated_at: now,
    finished_at: null
  }))
}

function sourceRows() {
  return configuration.sourceIds.map((sourceId) => ({
    source_id: sourceId,
    source_type: 'api',
    lifecycle_state: 'active',
    current_policy_version: `${sourceId}-v1`,
    policy_version: `${sourceId}-v1`,
    policy_state: 'approved',
    permitted_purposes: ['market-research'],
    display_mode: 'metadata-only',
    reviewed_at: now,
    expires_at: null,
    approved_review: true
  }))
}

function fakePool(initialCreated = false) {
  let created = initialCreated
  let parentInsertCount = 0
  let childInsertCount = 0
  const parent = {
    ...parentRow(),
    cancellation_requested_at: null as string | null,
    cancellation_requested_by: null as string | null,
    cancellation_request_id: null as string | null
  }
  const client = {
    async query(textOrConfig: unknown, values?: unknown[]) {
      const text = typeof textOrConfig === 'string' ? textOrConfig : String(textOrConfig)
      if (text.includes('SELECT role')) return { rows: [{ role: 'editor' }], rowCount: 1 }
      if (text.includes('SELECT fixture_only, visibility, status')) {
        return {
          rows: [{ fixture_only: false, visibility: 'private', status: 'active' }],
          rowCount: 1
        }
      }
      if (text.includes('SELECT purpose, configuration, budget, state, synthetic')) {
        return {
          rows: [
            {
              purpose: 'market-research',
              configuration,
              budget,
              state: 'draft',
              synthetic: false
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('OR idempotency_digest')) {
        return { rows: created ? [parent] : [], rowCount: created ? 1 : 0 }
      }
      if (text.includes('FROM appsea.sources source')) {
        return { rows: sourceRows(), rowCount: 2 }
      }
      if (text.includes('FROM appsea.opportunity_seed_reviews')) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('INSERT INTO appsea.research_campaign_orchestrations')) {
        created = true
        parentInsertCount += 1
        const params = values as unknown[]
        parent.idempotency_digest = String(params[3])
        parent.input_hash = String(params[4])
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('INSERT INTO appsea.research_campaign_orchestration_sources')) {
        childInsertCount += 1
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('SELECT workflow_id')) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('UPDATE appsea.research_campaign_orchestrations parent')) {
        parent.cancellation_requested_at = now
        parent.cancellation_requested_by = 'user:one'
        parent.cancellation_request_id = 'cancel:orchestration:test'
        return { rows: [parent], rowCount: 1 }
      }
      if (text.includes('FROM appsea.research_campaign_orchestration_sources')) {
        return { rows: childRows(), rowCount: 2 }
      }
      if (text.includes('FROM appsea.research_campaign_orchestrations')) {
        return { rows: created ? [parent] : [], rowCount: created ? 1 : 0 }
      }
      return { rows: [], rowCount: 1 }
    },
    release() {}
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client },
    counts: () => ({ parentInsertCount, childInsertCount })
  }
}

describe('PostgresResearchCampaignOrchestrationRepository', () => {
  it('persists one parent and one child per source and replays idempotently', async () => {
    const fake = fakePool()
    const repository = new PostgresResearchCampaignOrchestrationRepository(fake.pool as never)
    const input = {
      runId: 'run:campaign:multi',
      idempotencyKey: 'campaign-orchestration-idempotency-key',
      requestedAt: now
    }

    const first = await repository.createForUser('user:one', 'workspace:one', 'campaign:one', input)
    const replay = await repository.createForUser(
      'user:one',
      'workspace:one',
      'campaign:one',
      input
    )

    expect(first).toMatchObject({
      orchestrationId: 'run:campaign:multi',
      state: 'queued',
      sourceCount: 2,
      sources: [{ sourceId: configuration.sourceIds[0] }, { sourceId: configuration.sourceIds[1] }]
    })
    expect(replay).toEqual(first)
    expect(fake.counts()).toEqual({ parentInsertCount: 1, childInsertCount: 2 })
  })

  it('records an owner cancellation intent before external workflow cancellation', async () => {
    const fake = fakePool(true)
    const repository = new PostgresResearchCampaignOrchestrationRepository(fake.pool as never)

    const first = await repository.requestCancellationForUser(
      'user:one',
      'workspace:one',
      'run:campaign:multi'
    )
    const replay = await repository.requestCancellationForUser(
      'user:one',
      'workspace:one',
      'run:campaign:multi'
    )

    expect(first).toMatchObject({
      orchestrationId: 'run:campaign:multi',
      campaignId: 'campaign:one',
      state: 'requested',
      cancellationRequestedAt: now,
      activeWorkflowIds: []
    })
    expect(replay).toEqual(first)
  })
})
