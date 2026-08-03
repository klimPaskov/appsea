import { describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'
import {
  ManualImportUnavailableError,
  consumeManualImportBatchInTransaction
} from './manual-import-repository'

const row = {
  workspace_id: 'workspace:one',
  batch_id: 'batch:manual:one',
  campaign_id: 'campaign:one',
  source_id: 'manual-owner-import',
  policy_version: 'manual-owner-import-v1',
  format: 'json' as const,
  filename: 'support.json',
  record_count: 1,
  warning_count: 0,
  state: 'staged' as const,
  content_hash: 'a'.repeat(64),
  idempotency_digest: 'b'.repeat(64),
  input_hash: 'c'.repeat(64),
  run_id: null,
  created_at: '2026-08-03T00:00:00.000Z',
  consumed_at: null,
  deleted_at: null
}

type BatchState = 'staged' | 'consumed' | 'deleted' | 'failed'

function clientFor(state: BatchState = 'staged', runId: string | null = null) {
  const queries: string[] = []
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text)
      if (text.includes('SELECT workspace_id, batch_id')) {
        return { rows: [{ ...row, state, run_id: runId }] }
      }
      return { rows: [] }
    })
  }
  return { client: client as unknown as PoolClient, queries }
}

describe('manual import batch consumption', () => {
  it('consumes only a staged batch with matching lineage', async () => {
    const fake = clientFor()
    await consumeManualImportBatchInTransaction(fake.client, {
      workspaceId: 'workspace:one',
      batchId: 'batch:manual:one',
      campaignId: 'campaign:one',
      policyVersion: 'manual-owner-import-v1',
      runId: 'run:manual:one',
      observedAt: '2026-08-03T00:00:00.000Z'
    })
    expect(fake.queries.some((query) => query.includes("state = 'consumed'"))).toBe(true)
  })

  it('replays an already consumed batch for the same run', async () => {
    const fake = clientFor('consumed', 'run:manual:one')
    await expect(
      consumeManualImportBatchInTransaction(fake.client, {
        workspaceId: 'workspace:one',
        batchId: 'batch:manual:one',
        campaignId: 'campaign:one',
        policyVersion: 'manual-owner-import-v1',
        runId: 'run:manual:one',
        observedAt: '2026-08-03T00:00:00.000Z'
      })
    ).resolves.toBeUndefined()
    expect(fake.queries.some((query) => query.includes("state = 'consumed'"))).toBe(false)
  })

  it('fails closed for a deleted or missing staged batch', async () => {
    const fake = clientFor('deleted')
    await expect(
      consumeManualImportBatchInTransaction(fake.client, {
        workspaceId: 'workspace:one',
        batchId: 'batch:manual:one',
        campaignId: 'campaign:one',
        policyVersion: 'manual-owner-import-v1',
        runId: 'run:manual:one',
        observedAt: '2026-08-03T00:00:00.000Z'
      })
    ).rejects.toBeInstanceOf(ManualImportUnavailableError)
  })
})
