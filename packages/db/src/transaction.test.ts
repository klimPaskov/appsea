import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  MaintenanceSchedulerFenceError,
  withDatabaseTransaction,
  withWorkspaceTransaction
} from './transaction'

const fence = {
  schedulerName: 'appsea-source-maintenance-v1',
  ownerId: 'worker:host:1',
  leaseToken: 'token:worker:host:123'
} as const

function fakePool(asserted: boolean): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.includes('assert_maintenance_scheduler_lease')) {
        return { rows: [{ asserted }], rowCount: 1 }
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

describe('maintenance scheduler transaction fencing', () => {
  it('asserts the fence after transaction context and before the mutation', async () => {
    const { pool, statements } = fakePool(true)
    await expect(
      withWorkspaceTransaction(
        pool,
        'workspace:fence',
        async (client) => {
          await client.query('SELECT appsea.fenced_mutation()')
          return 'committed'
        },
        { maintenanceFence: fence }
      )
    ).resolves.toBe('committed')
    expect(statements).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      "SELECT set_config('appsea.workspace_id', $1, true)",
      'SELECT appsea.assert_maintenance_scheduler_lease($1, $2, $3) AS asserted',
      'SELECT appsea.fenced_mutation()',
      'COMMIT'
    ])
  })

  it('fails closed and rolls back before invoking a stale-fenced mutation', async () => {
    const { pool, statements } = fakePool(false)
    let mutationInvoked = false
    await expect(
      withDatabaseTransaction(
        pool,
        async () => {
          mutationInvoked = true
          return 'unsafe'
        },
        { maintenanceFence: fence }
      )
    ).rejects.toBeInstanceOf(MaintenanceSchedulerFenceError)
    expect(mutationInvoked).toBe(false)
    expect(statements).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'SELECT appsea.assert_maintenance_scheduler_lease($1, $2, $3) AS asserted',
      'ROLLBACK'
    ])
  })
})
