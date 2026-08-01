import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresMaintenanceSchedulerLeaseRepository } from './maintenance-scheduler-lease-repository'

const leaseToken = 'token:worker:host:1'

function fakePool(
  options: {
    acquired?: boolean
    renewed?: boolean
    released?: boolean
    leaseUntil?: string | null
    leaseToken?: string | null
  } = {}
): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('acquire_maintenance_scheduler_lease')) {
        return {
          rows: [
            {
              acquired: options.acquired ?? true,
              lease_until:
                options.leaseUntil !== undefined ? options.leaseUntil : '2026-08-01T00:15:00.000Z',
              lease_token: options.leaseToken !== undefined ? options.leaseToken : leaseToken
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('renew_maintenance_scheduler_lease')) {
        return {
          rows: [
            {
              renewed: options.renewed ?? true,
              lease_until:
                options.leaseUntil !== undefined ? options.leaseUntil : '2026-08-01T00:15:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('release_maintenance_scheduler_lease')) {
        return { rows: [{ released: options.released ?? true }], rowCount: 1 }
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

describe('maintenance scheduler lease repository', () => {
  it('acquires, renews, and releases only through narrow database functions', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresMaintenanceSchedulerLeaseRepository(pool)

    await expect(
      repository.acquire('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({
      acquired: true,
      leaseUntil: '2026-08-01T00:15:00.000Z',
      leaseToken
    })
    await expect(
      repository.renew('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({
      renewed: true,
      leaseUntil: '2026-08-01T00:15:00.000Z'
    })
    await expect(
      repository.release('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({
      released: true
    })
    expect(statements.some((text) => text.includes('acquire_maintenance_scheduler_lease'))).toBe(
      true
    )
    expect(statements.some((text) => text.includes('renew_maintenance_scheduler_lease'))).toBe(true)
    expect(statements.some((text) => text.includes('release_maintenance_scheduler_lease'))).toBe(
      true
    )
  })

  it('maps contention, lease loss, and token-safe release', async () => {
    const contended = new PostgresMaintenanceSchedulerLeaseRepository(
      fakePool({ acquired: false, leaseUntil: '2026-08-01T00:15:00.000Z', leaseToken: null }).pool
    )
    await expect(
      contended.acquire('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({
      acquired: false,
      leaseUntil: '2026-08-01T00:15:00.000Z',
      leaseToken: null
    })

    const lost = new PostgresMaintenanceSchedulerLeaseRepository(
      fakePool({ renewed: false, leaseUntil: null }).pool
    )
    await expect(
      lost.renew('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({
      renewed: false,
      leaseUntil: null
    })

    const notReleased = new PostgresMaintenanceSchedulerLeaseRepository(
      fakePool({ released: false }).pool
    )
    await expect(
      notReleased.release('appsea-source-maintenance-v1', 'worker:host:1', leaseToken)
    ).resolves.toEqual({ released: false })
  })

  it('rejects unsafe names, owners, tokens, and lease durations before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresMaintenanceSchedulerLeaseRepository(pool)
    await expect(repository.acquire('bad name', 'worker:host:1', leaseToken)).rejects.toThrow()
    await expect(
      repository.acquire('appsea-source-maintenance-v1', 'x', leaseToken)
    ).rejects.toThrow()
    await expect(
      repository.acquire('appsea-source-maintenance-v1', 'worker:host:1', 'short')
    ).rejects.toThrow()
    await expect(
      repository.acquire('appsea-source-maintenance-v1', 'worker:host:1', leaseToken, 29)
    ).rejects.toThrow(/between 30 and 3600/)
    await expect(
      repository.acquire('appsea-source-maintenance-v1', 'worker:host:1', leaseToken, 3_601)
    ).rejects.toThrow(/between 30 and 3600/)
    expect(statements).toHaveLength(0)
  })
})
