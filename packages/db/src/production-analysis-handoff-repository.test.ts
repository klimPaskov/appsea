import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  PostgresProductionAnalysisHandoffRepository,
  enqueueProductionAnalysisHandoffInTransaction,
  productionAnalysisHandoffIdentity
} from './production-analysis-handoff-repository'

const baseRow = {
  workspace_id: 'workspace:one',
  handoff_id: 'handoff:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  collection_workflow_id: 'workflow:production:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  collection_run_id: 'run:one',
  seed_review_id: 'seed-review:one',
  analysis_run_id: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  idempotency_key: 'production-analysis-handoff-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  requested_at: '2026-07-26T00:00:00.000Z',
  state: 'queued' as 'queued' | 'dispatching' | 'started' | 'failed',
  attempt_count: 0,
  workflow_id: null as string | null,
  failure_code: null as
    'analysis_not_ready' | 'seed_not_approved' | 'handoff_dispatch_failed' | null,
  failure_summary: null as string | null,
  next_attempt_at: '2026-07-26T00:00:00.000Z',
  started_at: null as string | null,
  finished_at: null as string | null,
  updated_at: '2026-07-26T00:00:00.000Z'
}

function fakePool(): { pool: Pool; row: typeof baseRow; statements: string[] } {
  const row = {
    ...baseRow,
    state: 'queued' as 'queued' | 'dispatching' | 'started' | 'failed',
    workflow_id: null as string | null,
    started_at: null as string | null
  }
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
      if (text.includes('INSERT INTO appsea.production_analysis_handoffs')) {
        row.handoff_id = String(values[1])
        row.collection_workflow_id = String(values[2])
        row.collection_run_id = String(values[3])
        row.seed_review_id = String(values[4])
        row.analysis_run_id = String(values[5])
        row.idempotency_key = String(values[6])
        return { rows: [{ ...row }], rowCount: 1 }
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
        row.started_at = '2026-07-26T00:00:01.000Z'
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes('SET state = CASE')) {
        if (row.state !== 'dispatching') return { rows: [], rowCount: 0 }
        row.state = 'queued'
        row.failure_code = String(values[2]) as typeof row.failure_code
        row.failure_summary = String(values[3])
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes("SET state = 'failed'")) {
        if (row.state !== 'dispatching') return { rows: [], rowCount: 0 }
        row.state = 'failed'
        row.failure_code = String(values[2]) as typeof row.failure_code
        row.failure_summary = String(values[3])
        row.finished_at = '2026-07-26T00:00:02.000Z'
        return { rows: [{ ...row }], rowCount: 1 }
      }
      if (text.includes('SELECT') && text.includes('production_analysis_handoffs')) {
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

describe('production analysis handoff repository', () => {
  it('derives stable, distinct identities from the reviewed seed', () => {
    const first = productionAnalysisHandoffIdentity('workspace:one', 'run:one', 'seed-review:one')
    const replay = productionAnalysisHandoffIdentity('workspace:one', 'run:one', 'seed-review:one')
    const changed = productionAnalysisHandoffIdentity('workspace:one', 'run:one', 'seed-review:two')

    expect(replay).toEqual(first)
    expect(first.handoffId).toMatch(/^handoff:analysis:[a-f0-9]{32}$/)
    expect(first.analysisRunId).toMatch(/^analysis-run:[a-f0-9]{32}$/)
    expect(first).not.toEqual(changed)
  })

  it('claims a queued handoff and marks the Temporal start idempotently', async () => {
    const { pool, row, statements } = fakePool()
    const repository = new PostgresProductionAnalysisHandoffRepository(pool)

    const claimed = await repository.claimNext('workspace:one')
    expect(claimed).toMatchObject({ state: 'dispatching', attemptCount: 1 })
    const started = await repository.markStarted(
      'workspace:one',
      row.handoff_id,
      'workflow:analysis:workspace:one:cccccccccccccccccccccccccccccccc'
    )
    const replay = await repository.markStarted(
      'workspace:one',
      row.handoff_id,
      'workflow:analysis:workspace:one:cccccccccccccccccccccccccccccccc'
    )

    expect(started).toMatchObject({ state: 'started', workflowId: replay.workflowId })
    expect(statements.some((text) => text.includes('FOR UPDATE SKIP LOCKED'))).toBe(true)
  })

  it('returns transient dispatch failures to the bounded queue', async () => {
    const { pool, row } = fakePool()
    const repository = new PostgresProductionAnalysisHandoffRepository(pool)

    await repository.claimNext('workspace:one')
    const retry = await repository.reschedule(
      'workspace:one',
      row.handoff_id,
      'analysis_not_ready',
      'The collection needs confirmed evidence.',
      300
    )

    expect(retry).toMatchObject({ state: 'queued', failureCode: 'analysis_not_ready' })
  })

  it('records a permanent seed-integrity failure without retrying it', async () => {
    const { pool, row } = fakePool()
    const repository = new PostgresProductionAnalysisHandoffRepository(pool)

    await repository.claimNext('workspace:one')
    const failed = await repository.fail(
      'workspace:one',
      row.handoff_id,
      'seed_not_approved',
      'The reviewed seed is no longer approved.'
    )

    expect(failed).toMatchObject({ state: 'failed', failureCode: 'seed_not_approved' })
  })

  it('enqueues only the deterministic handoff identity inside completion transactions', async () => {
    const { pool, row } = fakePool()
    const client = await pool.connect()
    const identity = productionAnalysisHandoffIdentity(
      'workspace:one',
      'run:one',
      'seed-review:one'
    )
    const enqueued = await enqueueProductionAnalysisHandoffInTransaction(client, {
      workspaceId: 'workspace:one',
      handoffId: identity.handoffId,
      collectionWorkflowId: row.collection_workflow_id,
      collectionRunId: 'run:one',
      seedReviewId: 'seed-review:one',
      analysisRunId: identity.analysisRunId,
      idempotencyKey: identity.idempotencyKey,
      requestedAt: row.requested_at
    })

    expect(enqueued).toMatchObject({ state: 'queued', analysisRunId: identity.analysisRunId })
  })
})
