import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  assertProductionAnalysisAdmissionConsumed,
  PostgresProductionAnalysisAdmissionRepository,
  ProductionAnalysisAdmissionConflictError,
  ProductionAnalysisConcurrencyLimitError,
  ProductionAnalysisRateLimitError
} from './production-analysis-admission-repository'

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
      if (text.includes('admit_production_analysis_workflow')) {
        if (conflict) {
          throw Object.assign(new Error('production analysis admission conflicts'), {
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
      if (text.includes('consume_production_analysis_workflow_admission')) {
        return { rows: [{ consumed: true }], rowCount: 1 }
      }
      if (text.includes('release_production_analysis_workflow_admission')) {
        return { rows: [{ released: true }], rowCount: 1 }
      }
      if (text.includes('purge_production_analysis_workflow_admissions')) {
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

describe('production analysis admission repository', () => {
  it('admits a user digest without retaining the raw idempotency key', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionAnalysisAdmissionRepository(pool)

    await expect(repository.admitForUser(common)).resolves.toMatchObject({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0
    })
    const admission = statements.find((text) => text.includes('admit_production_analysis_workflow'))
    expect(admission).toBeDefined()
    expect(admission).not.toContain('idempotencyKey')
  })

  it('maps replay and bounded rate/concurrency decisions', async () => {
    await expect(
      new PostgresProductionAnalysisAdmissionRepository(fakePool('replayed').pool).admitForUser(
        common
      )
    ).resolves.toMatchObject({ decision: 'replayed', replayed: true })
    await expect(
      new PostgresProductionAnalysisAdmissionRepository(fakePool('rate_limited').pool).admitForUser(
        common
      )
    ).rejects.toBeInstanceOf(ProductionAnalysisRateLimitError)
    await expect(
      new PostgresProductionAnalysisAdmissionRepository(
        fakePool('concurrency_limited').pool
      ).admitForUser(common)
    ).rejects.toBeInstanceOf(ProductionAnalysisConcurrencyLimitError)
  })

  it('consumes and releases only through worker-safe functions', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionAnalysisAdmissionRepository(pool)

    await expect(
      repository.consume(
        common.workspaceId,
        common.idempotencyDigest,
        common.inputHash,
        common.userId
      )
    ).resolves.toBe(true)
    await expect(
      repository.release(
        common.workspaceId,
        common.idempotencyDigest,
        common.inputHash,
        common.userId
      )
    ).resolves.toBe(true)
    expect(
      statements.some((text) => text.includes('consume_production_analysis_workflow_admission'))
    ).toBe(true)
    expect(
      statements.some((text) => text.includes('release_production_analysis_workflow_admission'))
    ).toBe(true)
  })

  it('fails closed when initialization has no reservation', () => {
    expect(() => assertProductionAnalysisAdmissionConsumed(false)).toThrow(
      'requires an active admission reservation'
    )
    expect(() => assertProductionAnalysisAdmissionConsumed(true)).not.toThrow()
  })

  it('rejects malformed digests before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionAnalysisAdmissionRepository(pool)
    await expect(repository.admitForUser({ ...common, inputHash: 'not-a-digest' })).rejects.toThrow(
      /SHA-256/
    )
    expect(statements).toHaveLength(0)
  })

  it('purges through the bounded database function', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresProductionAnalysisAdmissionRepository(pool)
    await expect(repository.purge('workspace:one', '2026-07-01T00:00:00.000Z', 10)).resolves.toBe(3)
    expect(
      statements.some((text) => text.includes('purge_production_analysis_workflow_admissions'))
    ).toBe(true)
  })

  it('exposes idempotency conflicts as a typed error', async () => {
    const repository = new PostgresProductionAnalysisAdmissionRepository(
      fakePool('admitted', true).pool
    )
    await expect(repository.admitForUser(common)).rejects.toBeInstanceOf(
      ProductionAnalysisAdmissionConflictError
    )
  })
})
