import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  PostgresProductionWorkflowAdmissionRepository,
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError
} from './production-workflow-admission-repository'

const common = {
  workspaceId: 'workspace:one',
  userId: 'user:one',
  idempotencyDigest: 'a'.repeat(64),
  inputHash: 'b'.repeat(64)
}

function fakePool(
  decision: 'admitted' | 'replayed' | 'rate_limited' | 'concurrency_limited' = 'admitted',
  conflict = false
): { pool: Pool; statements: string[] } {
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
        return { rows: [{ role: 'editor' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces')) {
        return { rows: [{ status: 'active' }], rowCount: 1 }
      }
      if (text.includes('admit_production_collection_workflow')) {
        if (conflict) {
          throw Object.assign(new Error('production workflow idempotency digest conflicts'), {
            code: '23505'
          })
        }
        return {
          rows: [
            {
              decision,
              retry_after_seconds: decision === 'rate_limited' ? 42 : 60,
              reservation_expires_at: '2026-08-01T00:05:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('consume_production_collection_workflow_admission')) {
        return { rows: [{ consumed: true }], rowCount: 1 }
      }
      if (text.includes('purge_production_collection_workflow_admissions')) {
        return { rows: [{ purged_count: '3' }], rowCount: 1 }
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

describe('production workflow admission repository', () => {
  it('admits a new digest and does not persist the raw idempotency key', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(repository.admitForUser(common)).resolves.toMatchObject({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0
    })
    const admission = statements.find((text) =>
      text.includes('admit_production_collection_workflow')
    )
    expect(admission).toBeDefined()
    expect(admission).not.toContain('idempotencyKey')
  })

  it('allows an idempotent replay without consuming another slot', async () => {
    const { pool } = fakePool('replayed')
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(repository.admitForUser(common)).resolves.toMatchObject({
      decision: 'replayed',
      replayed: true
    })
  })

  it('returns bounded, typed failures for rate and concurrency limits', async () => {
    const rate = new PostgresProductionWorkflowAdmissionRepository(fakePool('rate_limited').pool)
    await expect(rate.admitForUser(common)).rejects.toBeInstanceOf(ProductionWorkflowRateLimitError)
    const concurrency = new PostgresProductionWorkflowAdmissionRepository(
      fakePool('concurrency_limited').pool
    )
    await expect(concurrency.admitForUser(common)).rejects.toBeInstanceOf(
      ProductionWorkflowConcurrencyLimitError
    )
  })

  it('consumes through the worker-safe security-definer function', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(
      repository.consume(common.workspaceId, common.idempotencyDigest, common.inputHash)
    ).resolves.toBe(true)
    expect(
      statements.some((text) => text.includes('consume_production_collection_workflow_admission'))
    ).toBe(true)
  })

  it('rejects malformed digests before opening a database transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(
      repository.admitForUser({ ...common, idempotencyDigest: 'not-a-digest' })
    ).rejects.toThrow(/SHA-256/)
    expect(statements).toHaveLength(0)
  })

  it('purges only through the bounded database function', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(repository.purge('workspace:one', '2026-07-01T00:00:00.000Z', 10)).resolves.toBe(3)
    expect(
      statements.some((text) => text.includes('purge_production_collection_workflow_admissions'))
    ).toBe(true)
  })

  it('exposes an explicit conflict type for an idempotency collision', async () => {
    const { pool } = fakePool('admitted', true)
    const repository = new PostgresProductionWorkflowAdmissionRepository(pool)

    await expect(repository.admitForUser(common)).rejects.toBeInstanceOf(
      ProductionWorkflowAdmissionConflictError
    )
  })
})
