import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  PostgresSourceCollectionLeaseRepository,
  SourceCollectionLeaseConflictError,
  SourceCollectionLeasePolicyDeniedError,
  SourceCollectionLeaseTerminalError
} from './source-collection-lease-repository'

const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
const common = {
  workspaceId: 'workspace:one',
  leaseId: 'lease:source-collection:test',
  sourceId: 'source:one',
  policyVersion: 'v1',
  inputHash: 'a'.repeat(64),
  observedAt: '2026-07-10T00:00:00.000Z',
  expiresAt
}

function fakePool(
  decision: 'acquired' | 'replayed' | 'expired' | 'released' | 'revoked' = 'acquired',
  active = true,
  conflict = false,
  policyDenied = false
): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('set_config')) return { rows: [], rowCount: 1 }
      if (text.includes('acquire_source_collection_lease')) {
        if (policyDenied) {
          throw Object.assign(new Error('source collection lease requires an approved policy'), {
            code: '42501'
          })
        }
        if (conflict) {
          throw Object.assign(new Error('source collection lease conflicts with prior input'), {
            code: '23505'
          })
        }
        return {
          rows: [{ decision, observed_at: common.observedAt, expires_at: common.expiresAt }],
          rowCount: 1
        }
      }
      if (text.includes('assert_source_collection_lease')) {
        if (conflict) {
          throw Object.assign(new Error('source collection lease assertion conflicts'), {
            code: '23505'
          })
        }
        return { rows: [{ active }], rowCount: 1 }
      }
      if (text.includes('release_source_collection_lease')) {
        return { rows: [{ released: true }], rowCount: 1 }
      }
      if (text.includes('purge_source_collection_leases')) {
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

describe('source collection lease repository', () => {
  it('acquires a lease and maps its immutable observed timestamp', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceCollectionLeaseRepository(pool)

    await expect(repository.acquire(common)).resolves.toMatchObject({
      decision: 'acquired',
      replayed: false,
      observedAt: common.observedAt
    })
    expect(statements.some((text) => text.includes('acquire_source_collection_lease'))).toBe(true)
  })

  it('maps an idempotent replay without accepting terminal leases', async () => {
    const replayRepository = new PostgresSourceCollectionLeaseRepository(fakePool('replayed').pool)
    await expect(replayRepository.acquire(common)).resolves.toMatchObject({ replayed: true })

    const terminalRepository = new PostgresSourceCollectionLeaseRepository(fakePool('expired').pool)
    await expect(terminalRepository.acquire(common)).rejects.toBeInstanceOf(
      SourceCollectionLeaseTerminalError
    )
  })

  it('asserts, releases, and purges only through database functions', async () => {
    const { pool, statements } = fakePool('acquired', true)
    const repository = new PostgresSourceCollectionLeaseRepository(pool)

    await expect(
      repository.assertActive(common.workspaceId, common.leaseId, common.inputHash)
    ).resolves.toBe(true)
    await expect(
      repository.release(common.workspaceId, common.leaseId, common.inputHash)
    ).resolves.toBe(true)
    await expect(
      repository.purge(common.workspaceId, '2026-07-01T00:00:00.000Z', 10)
    ).resolves.toBe(3)
    expect(statements.some((text) => text.includes('assert_source_collection_lease'))).toBe(true)
    expect(statements.some((text) => text.includes('release_source_collection_lease'))).toBe(true)
    expect(statements.some((text) => text.includes('purge_source_collection_leases'))).toBe(true)
  })

  it('fails closed on policy denial and idempotency conflict', async () => {
    const denied = new PostgresSourceCollectionLeaseRepository(
      fakePool('acquired', true, false, true).pool
    )
    await expect(denied.acquire(common)).rejects.toBeInstanceOf(
      SourceCollectionLeasePolicyDeniedError
    )
    const conflict = new PostgresSourceCollectionLeaseRepository(
      fakePool('acquired', true, true).pool
    )
    await expect(conflict.acquire(common)).rejects.toBeInstanceOf(
      SourceCollectionLeaseConflictError
    )
  })

  it('rejects malformed identifiers before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceCollectionLeaseRepository(pool)

    await expect(repository.acquire({ ...common, inputHash: 'not-a-digest' })).rejects.toThrow(
      /SHA-256/
    )
    expect(statements).toHaveLength(0)
  })
})
