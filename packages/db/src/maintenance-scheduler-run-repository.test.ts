import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresMaintenanceSchedulerRunRepository } from './maintenance-scheduler-run-repository'

const metric = {
  runId: 'maintenance:run:test',
  schedulerName: 'appsea-source-maintenance-v1' as const,
  ownerId: 'worker:test:1',
  state: 'succeeded' as const,
  startedAt: '2026-08-01T00:00:00.000Z',
  finishedAt: '2026-08-01T00:00:00.125Z',
  durationMs: 125,
  failureCode: null,
  counters: { sourceItems: 3, deletionTombstones: 1 }
}

function fakePool(): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('record_maintenance_scheduler_run')) {
        return { rows: [{ recorded: true }], rowCount: 1 }
      }
      if (text.includes('purge_maintenance_scheduler_runs')) {
        return { rows: [{ purged: 4 }], rowCount: 1 }
      }
      if (text.includes('list_maintenance_scheduler_runs')) {
        return {
          rows: [
            {
              run_id: metric.runId,
              scheduler_name: metric.schedulerName,
              owner_id: metric.ownerId,
              state: metric.state,
              started_at: metric.startedAt,
              finished_at: metric.finishedAt,
              duration_ms: metric.durationMs,
              failure_code: metric.failureCode,
              counters: metric.counters
            }
          ],
          rowCount: 1
        }
      }
      throw new Error(`Unexpected SQL in test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

describe('maintenance scheduler run repository', () => {
  it('records, lists, and purges only through migration-owned functions', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresMaintenanceSchedulerRunRepository(pool)

    await expect(repository.record(metric)).resolves.toEqual({ recorded: true })
    await expect(repository.listRecent('appsea-source-maintenance-v1', 10)).resolves.toEqual([
      metric
    ])
    await expect(repository.purge({ before: '2026-08-01T00:00:00.000Z', limit: 10 })).resolves.toBe(
      4
    )
    expect(statements.some((text) => text.includes('record_maintenance_scheduler_run'))).toBe(true)
    expect(statements.some((text) => text.includes('list_maintenance_scheduler_runs'))).toBe(true)
    expect(statements.some((text) => text.includes('purge_maintenance_scheduler_runs'))).toBe(true)
  })

  it('rejects unsafe metrics before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresMaintenanceSchedulerRunRepository(pool)
    await expect(
      repository.record({ ...metric, failureCode: 'raw database error' })
    ).rejects.toThrow()
    await expect(
      repository.record({ ...metric, state: 'failed', failureCode: null })
    ).rejects.toThrow()
    await expect(repository.listRecent('bad name')).rejects.toThrow()
    await expect(repository.listRecent(undefined, 101)).rejects.toThrow(/between 1 and 100/)
    await expect(repository.purge({ before: '2026-08-02T00:00:00.000Z', limit: 10 })).resolves.toBe(
      4
    )
    expect(statements).toHaveLength(3)
  })
})
