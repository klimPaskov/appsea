import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresSourceQuotaRepository } from './source-quota-repository'

function fakePool(): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.reserve_source_quota')) {
        return {
          rows: [
            {
              reservation_id: 'quota:source:one',
              status: 'reserved',
              replayed: false,
              requested_records: 2,
              requested_cost_micros: '15'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('expire_source_quota_reservations')) {
        return { rows: [{ expired_count: '3' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

const common = {
  workspaceId: 'workspace:one',
  sourceId: 'source:one',
  policyVersion: 'policy-v1',
  runId: 'run:one',
  idempotencyKey: 'a'.repeat(64),
  reservationId: 'quota:source:one',
  requestedRecords: 2,
  requestedCostMicros: 15,
  expiresAt: '2026-07-24T00:10:00.000Z',
  occurredAt: '2026-07-24T00:00:00.000Z'
}

describe('PostgresSourceQuotaRepository', () => {
  it('uses the security-definer reservation boundary and preserves hashed identity', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceQuotaRepository(pool)
    await expect(repository.reserve(common)).resolves.toEqual({
      reservationId: 'quota:source:one',
      status: 'reserved',
      replayed: false,
      requestedRecords: 2,
      requestedCostMicros: 15
    })
    const reservation = statements.find((statement) =>
      statement.text.includes('FROM appsea.reserve_source_quota')
    )
    expect(reservation?.values[5]).toBe('a'.repeat(64))
    expect(reservation?.values).not.toContain('sensitive query')
  })

  it('settles and expires through database functions', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceQuotaRepository(pool)
    await repository.commit({
      workspaceId: common.workspaceId,
      reservationId: common.reservationId,
      actualRecords: 1,
      actualCostMicros: 15,
      occurredAt: common.occurredAt
    })
    await repository.release({
      workspaceId: common.workspaceId,
      reservationId: common.reservationId,
      occurredAt: common.occurredAt
    })
    await expect(repository.expireStale(common.workspaceId, common.occurredAt, 10)).resolves.toBe(3)
    expect(statements.some((statement) => statement.text.includes('commit_source_quota'))).toBe(
      true
    )
    expect(statements.some((statement) => statement.text.includes('release_source_quota'))).toBe(
      true
    )
    expect(statements.some((statement) => statement.text.includes('expire_source_quota'))).toBe(
      true
    )
  })

  it('rejects unsafe or unbounded reservation input before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceQuotaRepository(pool)
    await expect(repository.reserve({ ...common, idempotencyKey: 'not-a-digest' })).rejects.toThrow(
      /SHA-256/
    )
    await expect(repository.reserve({ ...common, requestedRecords: 0 })).rejects.toThrow(/positive/)
    expect(statements).toHaveLength(0)
  })
})
