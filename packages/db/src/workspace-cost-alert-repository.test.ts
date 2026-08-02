import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresWorkspaceCostAlertRepository } from './workspace-cost-alert-repository'

function fakePool(): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("set_config('appsea.workspace_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('FROM appsea.list_workspace_cost_alerts')) {
        return {
          rows: [
            {
              currency: 'USD',
              entry_count: '2',
              total_cost_micros: '1500000',
              estimated_cost_micros: '500000',
              actual_cost_micros: '1000000'
            },
            {
              currency: 'EUR',
              entry_count: '1',
              total_cost_micros: '900000',
              estimated_cost_micros: '900000',
              actual_cost_micros: '0'
            }
          ],
          rowCount: 2
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

describe('workspace cost alert repository', () => {
  it('reads bounded currency aggregates through the maintenance projection', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresWorkspaceCostAlertRepository(pool)

    await expect(
      repository.listAlertObservations(
        'workspace:one',
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        16
      )
    ).resolves.toEqual([
      {
        currency: 'USD',
        entryCount: 2,
        totalCostMicros: '1500000',
        estimatedCostMicros: '500000',
        actualCostMicros: '1000000'
      },
      {
        currency: 'EUR',
        entryCount: 1,
        totalCostMicros: '900000',
        estimatedCostMicros: '900000',
        actualCostMicros: '0'
      }
    ])
    expect(statements.some((text) => text.includes('list_workspace_cost_alerts'))).toBe(true)
  })

  it('rejects unsafe periods and currency limits before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresWorkspaceCostAlertRepository(pool)

    await expect(
      repository.listAlertObservations(
        'workspace:one',
        '2026-08-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z',
        16
      )
    ).rejects.toThrow(/between one moment and 365 days/)
    await expect(
      repository.listAlertObservations(
        'workspace:one',
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        17
      )
    ).rejects.toThrow(/between 1 and 16/)
    expect(statements).toHaveLength(0)
  })
})
