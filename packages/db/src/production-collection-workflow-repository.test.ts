import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withAuthenticatedCalls: [] as Array<{ userId: string; workspaceId: string }>,
  withServiceCalls: [] as Array<{ workspaceId: string }>
}))

vi.mock('./transaction', () => ({
  withAuthenticatedWorkspaceTransaction: async (
    _pool: unknown,
    userId: string,
    workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => {
    mocks.withAuthenticatedCalls.push({ userId, workspaceId })
    return operation({ query: mocks.query })
  },
  withWorkspaceTransaction: async (
    _pool: unknown,
    _workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => operation({ query: mocks.query }),
  withDatabaseTransaction: async (
    _pool: unknown,
    operation: (client: unknown) => Promise<unknown>
  ) => operation({ query: mocks.query }),
  withServiceWorkspaceTransaction: async (
    _pool: unknown,
    workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => {
    mocks.withServiceCalls.push({ workspaceId })
    return operation({ query: mocks.query })
  }
}))

const at = '2026-08-02T00:00:00.000Z'
const row = {
  workspace_id: 'workspace:one',
  workflow_id: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  temporal_first_execution_run_id: '00000000-0000-4000-8000-000000000001',
  workflow_type: 'productionCollectionWorkflow',
  workflow_version: 'production-collection-v1',
  task_queue: 'appsea-research-v1',
  campaign_id: 'campaign:billing',
  requested_research_run_id: 'run:billing',
  source_id: 'source:cfpb',
  policy_version: 'cfpb-v1',
  analysis_seed_review_id: null,
  recollection_tombstone_id: null,
  idempotency_digest: 'a'.repeat(64),
  input_hash: 'b'.repeat(64),
  requested_by_actor_type: 'user' as const,
  requested_by_actor_id: 'user:one',
  state: 'completed',
  checkpoint: 'completed',
  budget_currency: 'USD',
  max_source_items: 10,
  max_cost_micros: '0',
  max_activity_attempts: 3,
  consumed_source_items: 10,
  consumed_cost_micros: '0',
  activity_attempts: 1,
  persisted_run_id: 'run:billing',
  failure_code: null,
  failure_summary: null,
  requested_at: at,
  started_at: at,
  updated_at: at,
  finished_at: at,
  cancellation_requested_at: null,
  cancellation_requested_by: null,
  cancellation_request_id: null
}

describe('production collection workflow campaign history', () => {
  beforeEach(() => {
    mocks.query.mockReset()
    mocks.withAuthenticatedCalls.length = 0
    mocks.withServiceCalls.length = 0
    mocks.query.mockResolvedValue({ rows: [row] })
  })

  it('returns safe run history through the authenticated workspace transaction', async () => {
    const { PostgresProductionCollectionWorkflowRepository } =
      await import('./production-collection-workflow-repository')
    const runs = await new PostgresProductionCollectionWorkflowRepository(
      {} as never
    ).listForCampaignForUser('user:one', 'workspace:one', 'campaign:billing')

    expect(runs).toEqual([
      expect.objectContaining({
        campaignId: 'campaign:billing',
        workflowId: row.workflow_id,
        runId: 'run:billing',
        state: 'completed',
        checkpoint: 'completed',
        consumedSourceItems: 10,
        consumedCostMicros: 0
      })
    ])
    expect(runs[0]).not.toHaveProperty('idempotencyDigest')
    expect(runs[0]).not.toHaveProperty('inputHash')
    expect(mocks.withAuthenticatedCalls).toEqual([
      { userId: 'user:one', workspaceId: 'workspace:one' }
    ])
    expect(mocks.query.mock.calls[0]?.[0]).toContain('LIMIT 100')
  })

  it('persists an owner/editor cancellation intent idempotently', async () => {
    const { PostgresProductionCollectionWorkflowRepository } =
      await import('./production-collection-workflow-repository')
    const updatedRow = {
      ...row,
      state: 'running',
      checkpoint: 'inspected',
      finished_at: null,
      persisted_run_id: null,
      cancellation_requested_at: '2026-08-03T00:00:00.000Z',
      cancellation_requested_by: 'user:one',
      cancellation_request_id: 'cancel:production-workflow:aaaaaaaa'
    }
    mocks.query
      .mockResolvedValueOnce({ rows: [{ role: 'editor' }] })
      .mockResolvedValueOnce({
        rows: [{ fixture_only: false, visibility: 'private', status: 'active' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            ...row,
            state: 'running',
            checkpoint: 'inspected',
            finished_at: null,
            persisted_run_id: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [updatedRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await new PostgresProductionCollectionWorkflowRepository(
      {} as never
    ).requestCancellationForUser('user:one', 'workspace:one', row.workflow_id)

    expect(result).toEqual({
      workflowId: row.workflow_id,
      campaignId: row.campaign_id,
      state: 'requested',
      cancellationRequestedAt: '2026-08-03T00:00:00.000Z'
    })
    expect(mocks.withAuthenticatedCalls).toEqual([
      { userId: 'user:one', workspaceId: 'workspace:one' }
    ])
    expect(mocks.query.mock.calls[3]?.[0]).toContain('cancellation_requested_at')
  })

  it('does not issue an external cancellation request for terminal jobs', async () => {
    const { PostgresProductionCollectionWorkflowRepository } =
      await import('./production-collection-workflow-repository')
    mocks.query
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] })
      .mockResolvedValueOnce({
        rows: [{ fixture_only: false, visibility: 'private', status: 'active' }]
      })
      .mockResolvedValueOnce({ rows: [row] })

    const result = await new PostgresProductionCollectionWorkflowRepository(
      {} as never
    ).requestCancellationForUser('user:one', 'workspace:one', row.workflow_id)

    expect(result).toEqual({
      workflowId: row.workflow_id,
      campaignId: row.campaign_id,
      state: 'already_terminal',
      cancellationRequestedAt: null
    })
    expect(mocks.query).toHaveBeenCalledTimes(3)
  })
})
