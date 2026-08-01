import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresWorkspaceCostRepository } from './workspace-cost-repository'

function fakePool(): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("set_config('appsea.auth_user_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes("set_config('appsea.workspace_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('workspace_memberships')) {
        return { rows: [{ role: 'viewer' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces')) {
        return { rows: [{ status: 'active' }], rowCount: 1 }
      }
      if (text.includes('clock_timestamp')) {
        return { rows: [{ now: '2026-08-01T12:00:00.000Z' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.cost_ledger_entries')) {
        return {
          rows: [
            {
              currency: 'USD',
              cost_type: 'source_request',
              entry_count: '2',
              total_cost_micros: '1250000',
              estimated_cost_micros: '250000',
              actual_cost_micros: '1000000'
            },
            {
              currency: 'USD',
              cost_type: 'fixture_workflow',
              entry_count: '1',
              total_cost_micros: '100000',
              estimated_cost_micros: '0',
              actual_cost_micros: '100000'
            },
            {
              currency: 'EUR',
              cost_type: 'licensed_feed',
              entry_count: '1',
              total_cost_micros: '900000',
              estimated_cost_micros: '900000',
              actual_cost_micros: '0'
            }
          ],
          rowCount: 3
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

describe('workspace cost repository', () => {
  it('returns server-clock bounded cross-run summaries by currency and type', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresWorkspaceCostRepository(pool)

    await expect(
      repository.readForUser('user:one', 'workspace:one', {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z'
      })
    ).resolves.toEqual({
      workspaceId: 'workspace:one',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      asOf: '2026-08-01T12:00:00.000Z',
      entryCount: 4,
      currencies: [
        {
          currency: 'USD',
          entryCount: 3,
          totalCostMicros: '1350000',
          estimatedCostMicros: '250000',
          actualCostMicros: '1100000',
          byCostType: [
            {
              costType: 'source_request',
              entryCount: 2,
              totalCostMicros: '1250000',
              estimatedCostMicros: '250000',
              actualCostMicros: '1000000'
            },
            {
              costType: 'fixture_workflow',
              entryCount: 1,
              totalCostMicros: '100000',
              estimatedCostMicros: '0',
              actualCostMicros: '100000'
            }
          ]
        },
        {
          currency: 'EUR',
          entryCount: 1,
          totalCostMicros: '900000',
          estimatedCostMicros: '900000',
          actualCostMicros: '0',
          byCostType: [
            {
              costType: 'licensed_feed',
              entryCount: 1,
              totalCostMicros: '900000',
              estimatedCostMicros: '900000',
              actualCostMicros: '0'
            }
          ]
        }
      ]
    })
    expect(statements.some((text) => text.includes('FROM appsea.cost_ledger_entries'))).toBe(true)
  })

  it('rejects invalid periods before opening a database transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresWorkspaceCostRepository(pool)

    await expect(
      repository.readForUser('user:one', 'workspace:one', {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z'
      })
    ).rejects.toThrow()
    await expect(
      repository.readForUser('user:one', 'workspace:one', {
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z'
      })
    ).rejects.toThrow(/365 days/)
    expect(statements).toHaveLength(0)
  })

  it('does not accept an end timestamp beyond the database clock', async () => {
    const { pool } = fakePool()
    const repository = new PostgresWorkspaceCostRepository(pool)

    await expect(
      repository.readForUser('user:one', 'workspace:one', {
        to: '2026-08-02T00:00:00.000Z'
      })
    ).rejects.toThrow(/future/)
  })
})
