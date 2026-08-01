import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresDeletionPropagationRepository } from './deletion-propagation-repository'

const initialTombstone = {
  workspace_id: 'workspace:one',
  tombstone_id: 'tombstone:one',
  source_id: 'source:one',
  source_record_id: 'record-1',
  reason: 'source-request',
  state: 'pending' as const,
  received_at: '2026-07-24T00:00:00.000Z',
  processing_started_at: null,
  completed_at: null,
  affected_object_count: 0,
  attempt_count: 0,
  next_attempt_at: '2026-07-24T00:00:00.000Z',
  failure_code: null,
  failure_summary: null
}

type MutableTombstone = Omit<
  typeof initialTombstone,
  | 'state'
  | 'processing_started_at'
  | 'completed_at'
  | 'next_attempt_at'
  | 'failure_code'
  | 'failure_summary'
> & {
  state: 'pending' | 'processing' | 'completed' | 'failed'
  processing_started_at: string | null
  completed_at: string | null
  attempt_count: number
  next_attempt_at: string | null
  failure_code: string | null
  failure_summary: string | null
}

function fakePool(seed: Partial<MutableTombstone> = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
  getTombstone: () => MutableTombstone
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const tombstone: MutableTombstone = { ...initialTombstone, ...seed }
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("set_config('appsea.workspace_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('INSERT INTO appsea.deletion_tombstones')) {
        return { rows: [{ ...tombstone }], rowCount: 1 }
      }
      if (text.includes('candidate AS')) {
        if (tombstone.state === 'processing' && tombstone.attempt_count >= 8) {
          tombstone.state = 'failed'
          tombstone.processing_started_at = null
          tombstone.next_attempt_at = null
          tombstone.failure_code = 'deletion_propagation_failed'
          tombstone.failure_summary = 'Deletion propagation exhausted its bounded retry budget.'
          return { rows: [], rowCount: 0 }
        }
        if (!['pending', 'failed'].includes(tombstone.state)) return { rows: [], rowCount: 0 }
        tombstone.state = 'processing'
        tombstone.attempt_count += 1
        tombstone.processing_started_at = '2026-07-24T00:00:01.000Z'
        tombstone.next_attempt_at = null
        tombstone.failure_code = null
        tombstone.failure_summary = null
        return { rows: [{ ...tombstone }], rowCount: 1 }
      }
      if (text.includes('UPDATE appsea.source_items')) {
        return { rows: [{ source_item_id: 'source-item:one' }], rowCount: 1 }
      }
      if (text.includes('UPDATE appsea.evidence_records')) {
        return {
          rows: [{ evidence_id: 'evidence:one' }, { evidence_id: 'evidence:two' }],
          rowCount: 2
        }
      }
      if (text.includes('UPDATE appsea.production_analysis_runs')) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('UPDATE appsea.opportunities')) {
        return {
          rows: [{ opportunity_count: 1, recomputation_jobs_queued: 1 }],
          rowCount: 1
        }
      }
      if (text.includes('UPDATE appsea.report_versions')) {
        return { rows: [{ report_id: 'report:one' }], rowCount: 1 }
      }
      if (text.includes('UPDATE appsea.plan_package_versions')) {
        return { rows: [{ plan_package_id: 'plan:one' }], rowCount: 1 }
      }
      if (text.includes("SET state = 'completed'")) {
        if (tombstone.state !== 'processing') return { rows: [], rowCount: 0 }
        tombstone.state = 'completed'
        tombstone.processing_started_at = null
        tombstone.completed_at = '2026-07-24T00:00:02.000Z'
        tombstone.affected_object_count = Number(values[2])
        tombstone.next_attempt_at = null
        tombstone.failure_code = null
        tombstone.failure_summary = null
        return { rows: [{ ...tombstone }], rowCount: 1 }
      }
      if (text.includes("SET state = 'failed'")) {
        if (tombstone.state !== 'processing') return { rows: [], rowCount: 0 }
        tombstone.state = 'failed'
        tombstone.processing_started_at = null
        tombstone.next_attempt_at = '2026-07-24T00:01:01.000Z'
        tombstone.failure_code = 'deletion_propagation_failed'
        tombstone.failure_summary = 'Deletion propagation failed; a bounded retry is scheduled.'
        return { rows: [{ ...tombstone }], rowCount: 1 }
      }
      if (text.includes('SELECT') && text.includes('deletion_tombstones')) {
        if (values[1] !== tombstone.tombstone_id) return { rows: [], rowCount: 0 }
        return { rows: [{ ...tombstone }], rowCount: 1 }
      }
      throw new Error(`Unexpected SQL in test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements,
    getTombstone: () => ({ ...tombstone })
  }
}

describe('PostgresDeletionPropagationRepository', () => {
  it('enqueues a connector deletion event idempotently', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)

    const result = await repository.enqueue({
      workspaceId: 'workspace:one',
      tombstoneId: 'tombstone:one',
      sourceId: 'source:one',
      sourceRecordId: 'record-1',
      reason: 'source-request',
      receivedAt: '2026-07-24T00:00:00.000Z'
    })

    expect(result).toMatchObject({ tombstoneId: 'tombstone:one', state: 'pending' })
    expect(statements.some(({ text }) => text.includes('ON CONFLICT'))).toBe(true)
  })

  it('claims the oldest pending tombstone with a skip-locked transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)

    const claimed = await repository.claimNext('workspace:one')

    expect(claimed?.state).toBe('processing')
    expect(claimed?.attemptCount).toBe(1)
    expect(statements.some(({ text }) => text.includes('FOR UPDATE SKIP LOCKED'))).toBe(true)
  })

  it('schedules a retry after a propagation failure', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)

    await repository.claimNext('workspace:one')
    const failed = await repository.fail('workspace:one', 'tombstone:one')

    expect(failed).toMatchObject({
      state: 'failed',
      attemptCount: 1,
      failureCode: 'deletion_propagation_failed'
    })
    expect(failed.nextAttemptAt).not.toBeNull()
    expect(failed.failureSummary).toContain('retry')
    const failureStatement = statements.find(({ text }) => text.includes('next_attempt_at = CASE'))
    expect(failureStatement?.text).toContain('attempt_count < $3')
  })

  it('terminalizes an exhausted stale claim without reprocessing it', async () => {
    const { pool, getTombstone, statements } = fakePool({
      state: 'processing',
      attempt_count: 8,
      processing_started_at: '2026-07-23T00:00:00.000Z',
      next_attempt_at: null
    })
    const repository = new PostgresDeletionPropagationRepository(pool)

    const claimed = await repository.claimNext('workspace:one')

    expect(claimed).toBeNull()
    expect(getTombstone()).toMatchObject({
      state: 'failed',
      attempt_count: 8,
      next_attempt_at: null,
      failure_code: 'deletion_propagation_failed'
    })
    expect(statements.some(({ text }) => text.includes('attempt_count >= $2'))).toBe(true)
  })

  it('propagates availability state and completes with the affected row count', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)

    const result = await repository.processNext('workspace:one')

    expect(result).toMatchObject({
      sourceItemCount: 1,
      evidenceCount: 2,
      analysisCount: 0,
      opportunityCount: 1,
      recomputationJobsQueued: 1,
      reportCount: 1,
      planCount: 1,
      affectedObjectCount: 6,
      tombstone: { state: 'completed', affectedObjectCount: 6 }
    })
    expect(statements.some(({ text }) => text.includes("deletion_state = 'source_deleted'"))).toBe(
      true
    )
    expect(statements.some(({ text }) => text.includes('production_analysis_recompute_jobs'))).toBe(
      true
    )
    expect(statements.some(({ text }) => text.includes("SET state = 'completed'"))).toBe(true)
  })

  it('returns an already completed tombstone unchanged on repeated completion', async () => {
    const { pool } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)
    await repository.processNext('workspace:one')

    const completed = await repository.complete('workspace:one', 'tombstone:one', 6)

    expect(completed.state).toBe('completed')
    expect(completed.affectedObjectCount).toBe(6)
  })

  it('fails a claimed tombstone idempotently', async () => {
    const { pool } = fakePool()
    const repository = new PostgresDeletionPropagationRepository(pool)
    await repository.claimNext('workspace:one')

    const first = await repository.fail('workspace:one', 'tombstone:one')
    const second = await repository.fail('workspace:one', 'tombstone:one')

    expect(first.state).toBe('failed')
    expect(second).toEqual(first)
  })
})
