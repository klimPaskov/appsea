import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresProductionAnalysisRecomputeRepository } from './production-analysis-recompute-repository'

const baseRow = {
  workspace_id: 'workspace:one',
  recompute_id: 'recompute:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  opportunity_id: 'opportunity:one',
  collection_run_id: 'run:one',
  seed_review_id: 'seed-review:one',
  source_tombstone_id: 'tombstone:one',
  analysis_run_id: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  idempotency_key: 'production-analysis-recompute-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  requested_at: '2026-08-01T00:00:00.000Z',
  state: 'queued' as 'queued' | 'dispatching' | 'started' | 'blocked' | 'satisfied' | 'failed',
  attempt_count: 0,
  workflow_id: null as string | null,
  failure_code: null as
    | 'analysis_not_ready'
    | 'seed_not_approved'
    | 'recompute_dispatch_failed'
    | 'analysis_already_repaired'
    | null,
  failure_summary: null as string | null,
  next_attempt_at: '2026-08-01T00:00:00.000Z',
  started_at: null as string | null,
  finished_at: null as string | null,
  updated_at: '2026-08-01T00:00:00.000Z'
}

function fakePool(): { pool: Pool; row: typeof baseRow; statements: string[] } {
  const row = { ...baseRow }
  const statements: string[] = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("set_config('appsea.workspace_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes("SET state = 'satisfied'")) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("SET state = 'blocked'")) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('WITH candidate AS')) {
        if (row.state !== 'queued') return { rows: [], rowCount: 0 }
        row.state = 'dispatching'
        row.attempt_count = 1
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes("SET state = 'started'")) {
        if (row.state !== 'dispatching') return { rows: [], rowCount: 0 }
        row.state = 'started'
        row.workflow_id = String(values[2])
        row.started_at = '2026-08-01T00:00:01.000Z'
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes('SET state = CASE')) {
        if (row.state !== 'dispatching') return { rows: [], rowCount: 0 }
        row.state = String(values[2]) === 'seed_not_approved' ? 'blocked' : 'queued'
        row.failure_code = String(values[2]) as typeof row.failure_code
        row.failure_summary = String(values[3])
        row.finished_at = row.state === 'blocked' ? '2026-08-01T00:00:02.000Z' : null
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes("SET state = 'failed'")) {
        if (row.state !== 'dispatching') return { rows: [], rowCount: 0 }
        row.state = 'failed'
        row.failure_code = String(values[2]) as typeof row.failure_code
        row.failure_summary = String(values[3])
        row.finished_at = '2026-08-01T00:00:02.000Z'
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes('SELECT') && text.includes('production_analysis_recompute_jobs')) {
        return { rows: [{ ...row }], rowCount: 1 }
      }
      throw new Error(`Unexpected SQL in test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    row,
    statements
  }
}

describe('production analysis recomputation repository', () => {
  it('claims a queued repair and marks the Temporal workflow start idempotently', async () => {
    const { pool, row, statements } = fakePool()
    const repository = new PostgresProductionAnalysisRecomputeRepository(pool)

    const claimed = await repository.claimNext('workspace:one')
    expect(claimed).toMatchObject({ state: 'dispatching', attemptCount: 1 })
    const started = await repository.markStarted(
      'workspace:one',
      row.recompute_id,
      'workflow:analysis:workspace:one:cccccccccccccccccccccccccccccccc'
    )
    const replay = await repository.markStarted(
      'workspace:one',
      row.recompute_id,
      'workflow:analysis:workspace:one:cccccccccccccccccccccccccccccccc'
    )

    expect(started).toMatchObject({ state: 'started', workflowId: replay.workflowId })
    expect(statements.some((text) => text.includes('FOR UPDATE SKIP LOCKED'))).toBe(true)
  })

  it('returns active-evidence readiness failures to the bounded queue', async () => {
    const { pool, row } = fakePool()
    const repository = new PostgresProductionAnalysisRecomputeRepository(pool)

    await repository.claimNext('workspace:one')
    const retry = await repository.reschedule(
      'workspace:one',
      row.recompute_id,
      'analysis_not_ready',
      'The collection needs confirmed active evidence.',
      300
    )

    expect(retry).toMatchObject({ state: 'queued', failureCode: 'analysis_not_ready' })
  })

  it('blocks until a seed is approved instead of retrying a policy failure blindly', async () => {
    const { pool, row } = fakePool()
    const repository = new PostgresProductionAnalysisRecomputeRepository(pool)

    await repository.claimNext('workspace:one')
    const blocked = await repository.reschedule(
      'workspace:one',
      row.recompute_id,
      'seed_not_approved',
      'The reviewed seed is not approved.',
      300
    )

    expect(blocked).toMatchObject({ state: 'blocked', failureCode: 'seed_not_approved' })
  })
})
