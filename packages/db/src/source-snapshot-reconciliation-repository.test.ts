import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  PostgresSourceSnapshotReconciliationRepository,
  SourceSnapshotReconciliationIncompleteError,
  SourceSnapshotReconciliationPolicyDeniedError
} from './source-snapshot-reconciliation-repository'

const input = {
  workspaceId: 'workspace:one',
  reconciliationId: 'reconciliation:source:0123456789abcdef0123456789abcdef',
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-policy-v1',
  idempotencyKey: 'a'.repeat(64),
  pageSize: 2,
  maxRecords: 10,
  requestedAt: '2026-07-24T00:00:00.000Z'
}

function jobRow() {
  return {
    workspace_id: input.workspaceId,
    reconciliation_id: input.reconciliationId,
    source_id: input.sourceId,
    policy_version: input.policyVersion,
    idempotency_key: input.idempotencyKey,
    input_hash: 'b'.repeat(64),
    page_size: input.pageSize,
    max_records: input.maxRecords,
    requested_at: input.requestedAt,
    state: 'queued' as 'queued' | 'running' | 'completed' | 'incomplete' | 'failed',
    attempt_count: 0,
    claim_token_hash: null as string | null,
    claim_expires_at: null as string | null,
    observed_at: null as string | null,
    next_offset: 0,
    pages_scanned: 0,
    source_record_count: 0,
    deletion_count: 0,
    coverage_gaps: [] as string[],
    warnings: [] as string[],
    failure_code: null,
    failure_summary: null,
    finished_at: null as string | null,
    next_attempt_at: new Date(Date.now() - 1_000).toISOString(),
    updated_at: new Date().toISOString()
  }
}

function fakePool(options: { deny?: boolean } = {}): {
  pool: Pool
  statements: string[]
} {
  const statements: string[] = []
  const state = { job: jobRow(), pageHash: null as string | null }
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('set_config')) return { rows: [], rowCount: 1 }
      if (text.includes('INSERT INTO appsea.source_snapshot_reconciliation_jobs')) {
        if (options.deny) {
          throw Object.assign(
            new Error('source snapshot reconciliation requires an active approved deletion policy'),
            {
              code: '42501'
            }
          )
        }
        state.job.input_hash = String(values[5])
        return { rows: [state.job], rowCount: 1 }
      }
      if (
        text.includes('FROM appsea.source_snapshot_reconciliation_jobs') &&
        !text.includes('FOR UPDATE') &&
        !text.includes('WITH candidate')
      ) {
        return { rows: [state.job], rowCount: 1 }
      }
      if (
        text.includes('FROM appsea.source_snapshot_reconciliation_jobs') &&
        text.includes('FOR UPDATE') &&
        !text.includes('WITH candidate')
      ) {
        return { rows: [state.job], rowCount: 1 }
      }
      if (text.includes('WITH candidate AS')) {
        const tokenHash = String(values[2] ?? values[1])
        state.job.state = 'running'
        state.job.attempt_count += 1
        state.job.claim_token_hash = tokenHash
        state.job.claim_expires_at = new Date(Date.now() + 60_000).toISOString()
        state.job.observed_at = '2026-07-24T00:00:00.000Z'
        state.job.next_attempt_at = new Date().toISOString()
        state.job.updated_at = new Date().toISOString()
        return { rows: [state.job], rowCount: 1 }
      }
      if (text.includes('SELECT appsea.assert_source_collection_lease')) {
        return { rows: [{ active: true }], rowCount: 1 }
      }
      if (text.includes('INSERT INTO appsea.source_snapshot_reconciliation_pages')) {
        state.pageHash = String(values[5])
        return {
          rows: [
            {
              page_hash: state.pageHash,
              source_record_count: values[4],
              short_page: values[6]
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('INSERT INTO appsea.source_snapshot_reconciliation_items')) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('SELECT page_hash')) {
        return {
          rows: state.pageHash
            ? [{ page_hash: state.pageHash, source_record_count: 1, short_page: true }]
            : [],
          rowCount: state.pageHash ? 1 : 0
        }
      }
      if (text.includes('SET next_offset = next_offset +')) {
        const count = Number(values[2])
        state.job.next_offset += count
        state.job.pages_scanned += 1
        state.job.source_record_count += count
        state.job.warnings = [...new Set([...state.job.warnings, ...(values[3] as string[])])]
        state.job.updated_at = new Date().toISOString()
        return { rows: [state.job], rowCount: 1 }
      }
      if (text.includes('SELECT EXISTS')) return { rows: [{ exists: true }], rowCount: 1 }
      if (text.includes('INSERT INTO appsea.deletion_tombstones')) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('SET state = $3')) {
        state.job.state = String(values[2]) as typeof state.job.state
        state.job.deletion_count += Number(values[3])
        state.job.failure_code = values[6] as null
        state.job.failure_summary = values[7] as null
        state.job.claim_token_hash = null
        state.job.claim_expires_at = null
        state.job.finished_at = new Date().toISOString()
        state.job.updated_at = new Date().toISOString()
        return { rows: [state.job], rowCount: 1 }
      }
      throw new Error(`Unexpected SQL in snapshot test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return { pool: { connect: async () => client } as unknown as Pool, statements }
}

describe('source snapshot reconciliation repository', () => {
  it('claims pages and finalizes missing source items atomically behind the lease assertion', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceSnapshotReconciliationRepository(pool)
    const enqueued = await repository.enqueue(input)
    expect(enqueued.state).toBe('queued')
    const claim = await repository.claimById(input.workspaceId, input.reconciliationId)
    expect(claim).toMatchObject({ state: 'running', attemptCount: 1 })
    if (!claim) throw new Error('expected claim')
    const checkpoint = await repository.appendPage(
      input.workspaceId,
      input.reconciliationId,
      claim.claimToken,
      {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 1,
        sourceRecordIds: ['123456'],
        shortPage: true,
        warnings: []
      }
    )
    expect(checkpoint).toMatchObject({ nextOffset: 1, pagesScanned: 1 })
    const finished = await repository.finish({
      workspaceId: input.workspaceId,
      reconciliationId: input.reconciliationId,
      claimToken: claim.claimToken,
      fullSnapshot: true,
      coverageGaps: [],
      warnings: [],
      lease: {
        leaseId:
          'lease:source-snapshot:reconciliation:source:0123456789abcdef0123456789abcdef:attempt:1',
        inputHash: claim.inputHash
      }
    })
    expect(finished).toMatchObject({ state: 'completed', deletionCount: 1 })
    expect(
      statements.some((statement) => statement.includes('assert_source_collection_lease'))
    ).toBe(true)
    expect(statements.some((statement) => statement.includes('deletion_tombstones'))).toBe(true)
  })

  it('fails closed on policy denial and malformed reconciliation identifiers before network work', async () => {
    const denied = new PostgresSourceSnapshotReconciliationRepository(fakePool({ deny: true }).pool)
    await expect(denied.enqueue(input)).rejects.toBeInstanceOf(
      SourceSnapshotReconciliationPolicyDeniedError
    )
    const { pool, statements } = fakePool()
    const repository = new PostgresSourceSnapshotReconciliationRepository(pool)
    await expect(
      repository.enqueue({ ...input, reconciliationId: 'not-a-reconciliation' })
    ).rejects.toThrow(/deterministic source reconciliation/)
    expect(statements).toHaveLength(0)
  })

  it('does not finalize a full snapshot when persisted page warnings exist', async () => {
    const { pool } = fakePool()
    const repository = new PostgresSourceSnapshotReconciliationRepository(pool)
    await repository.enqueue(input)
    const claim = await repository.claimById(input.workspaceId, input.reconciliationId)
    if (!claim) throw new Error('expected claim')
    await repository.appendPage(input.workspaceId, input.reconciliationId, claim.claimToken, {
      offset: 0,
      pageSize: 2,
      sourceRecordCount: 1,
      sourceRecordIds: ['123456'],
      shortPage: true,
      warnings: ['malformed source identifier']
    })
    await expect(
      repository.finish({
        workspaceId: input.workspaceId,
        reconciliationId: input.reconciliationId,
        claimToken: claim.claimToken,
        fullSnapshot: true,
        coverageGaps: [],
        warnings: ['malformed source identifier'],
        lease: {
          leaseId:
            'lease:source-snapshot:reconciliation:source:0123456789abcdef0123456789abcdef:attempt:1',
          inputHash: claim.inputHash
        }
      })
    ).rejects.toBeInstanceOf(SourceSnapshotReconciliationIncompleteError)
  })
})
