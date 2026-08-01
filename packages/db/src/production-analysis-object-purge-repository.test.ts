import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { InMemoryObjectStore } from '@appsea/object-store'
import { PostgresProductionAnalysisObjectPurgeRepository } from './production-analysis-object-purge-repository'

const workspaceId = 'workspace:one'
const now = '2026-08-01T00:00:00.000Z'

function fakePool(row: Record<string, unknown>): { pool: Pool; calls: string[] } {
  const calls: string[] = []
  let claimed = false
  const client = {
    query: async (text: string) => {
      calls.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes("set_config('appsea.workspace_id'")) {
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('WITH candidate')) {
        if (claimed) return { rows: [], rowCount: 0 }
        claimed = true
        return {
          rows: [
            {
              ...row,
              state: 'processing',
              attempt_count: 1,
              processing_started_at: now,
              failure_code: null,
              failure_summary: null
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes("SET state = 'completed'")) {
        return {
          rows: [
            {
              ...row,
              state: 'completed',
              attempt_count: 1,
              processing_started_at: null,
              completed_at: now,
              next_attempt_at: now,
              failure_code: null,
              failure_summary: null
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes("SET state = 'marked'")) {
        return {
          rows: [
            {
              ...row,
              state: 'marked',
              attempt_count: 1,
              processing_started_at: null,
              next_attempt_at: row.eligible_at,
              failure_code: null,
              failure_summary: null
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('SELECT workspace_id, purge_id')) {
        return { rows: [row], rowCount: 1 }
      }
      throw new Error(`Unexpected SQL in test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return { pool: { connect: async () => client } as unknown as Pool, calls }
}

describe('production analysis object purge repository', () => {
  it('marks and purges an eligible object, then returns a durable completion', async () => {
    const store = new InMemoryObjectStore()
    const reference = await store.put({
      workspaceId,
      kind: 'report-json',
      body: new TextEncoder().encode('{"report":true}'),
      contentType: 'application/json',
      createdAt: '2026-06-01T00:00:00.000Z',
      retentionUntil: '2026-07-01T00:00:00.000Z'
    })
    const { pool, calls } = fakePool({
      workspace_id: workspaceId,
      purge_id: 'object-purge:' + 'a'.repeat(32),
      analysis_run_id: 'analysis-run:one',
      object_uri: reference.uri,
      object_kind: reference.kind,
      object_ref: reference,
      authorization: 'retention-expired',
      requested_at: '2026-06-01T00:00:00.000Z',
      eligible_at: '2026-07-01T00:00:00.000Z',
      state: 'pending',
      attempt_count: 0,
      processing_started_at: null,
      completed_at: null,
      next_attempt_at: '2026-07-01T00:00:00.000Z',
      failure_code: null,
      failure_summary: null
    })
    const repository = new PostgresProductionAnalysisObjectPurgeRepository(pool, store)

    await expect(
      repository.processNext(workspaceId, '2099-01-01T00:00:00.000Z')
    ).resolves.toMatchObject({
      purged: true,
      record: { state: 'completed', purgeId: expect.stringContaining('object-purge:') }
    })
    await expect(store.head(workspaceId, reference)).resolves.toBeNull()
    expect(calls.some((text) => text.includes('FOR UPDATE SKIP LOCKED'))).toBe(true)
    expect(calls.some((text) => text.includes('next_attempt_at <= clock_timestamp()'))).toBe(true)
  })

  it('marks an object and waits until its retention deadline without purging early', async () => {
    const store = new InMemoryObjectStore()
    const reference = await store.put({
      workspaceId,
      kind: 'report-json',
      body: new TextEncoder().encode('{"report":true}'),
      contentType: 'application/json',
      createdAt: '2026-06-01T00:00:00.000Z',
      retentionUntil: '2026-09-01T00:00:00.000Z'
    })
    const { pool } = fakePool({
      workspace_id: workspaceId,
      purge_id: 'object-purge:' + 'b'.repeat(32),
      analysis_run_id: 'analysis-run:one',
      object_uri: reference.uri,
      object_kind: reference.kind,
      object_ref: reference,
      authorization: 'retention-expired',
      requested_at: '2026-06-01T00:00:00.000Z',
      eligible_at: '2026-09-01T00:00:00.000Z',
      state: 'pending',
      attempt_count: 0,
      processing_started_at: null,
      completed_at: null,
      next_attempt_at: '2026-09-01T00:00:00.000Z',
      failure_code: null,
      failure_summary: null
    })
    const repository = new PostgresProductionAnalysisObjectPurgeRepository(pool, store)

    await expect(repository.processNext(workspaceId, now)).resolves.toMatchObject({
      purged: false,
      record: { state: 'marked', nextAttemptAt: '2026-09-01T00:00:00.000Z' }
    })
    await expect(store.head(workspaceId, reference)).resolves.toMatchObject({
      deletionState: 'deleted'
    })
  })
})
