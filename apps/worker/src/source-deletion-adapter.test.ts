import { describe, expect, it, vi } from 'vitest'
import type { DeletionTombstoneRecord, PostgresDeletionPropagationRepository } from '@appsea/db'
import { persistConnectorDeletions } from './source-deletion-adapter'

const tombstone: DeletionTombstoneRecord = {
  workspaceId: 'workspace:one',
  tombstoneId: 'tombstone:one',
  sourceId: 'source:one',
  sourceRecordId: 'record-1',
  reason: 'source-request',
  state: 'pending',
  receivedAt: '2026-07-24T00:00:00.000Z',
  processingStartedAt: null,
  completedAt: null,
  affectedObjectCount: 0,
  attemptCount: 0,
  nextAttemptAt: '2026-07-24T00:00:00.000Z',
  failureCode: null,
  failureSummary: null
}

describe('persistConnectorDeletions', () => {
  it('validates events and creates deterministic tombstone identities', async () => {
    const enqueue = vi.fn(async (input: { tombstoneId: string }) => ({
      ...tombstone,
      tombstoneId: input.tombstoneId
    }))
    const repository = { enqueue } as unknown as PostgresDeletionPropagationRepository
    const input = {
      sourceId: 'source:one',
      sourceRecordId: 'record-1',
      observedAt: '2026-07-24T00:00:00.000Z',
      reason: 'source-request'
    }
    const first = await persistConnectorDeletions(repository, 'workspace:one', [input])
    const second = await persistConnectorDeletions(repository, 'workspace:one', [input])

    expect(first[0]?.tombstoneId).toBe(second[0]?.tombstoneId)
    expect(first[0]?.tombstoneId).toMatch(/^tombstone:[a-f0-9]{48}$/)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed connector events before persistence', async () => {
    const enqueue = vi.fn()
    const repository = { enqueue } as unknown as PostgresDeletionPropagationRepository
    await expect(
      persistConnectorDeletions(repository, 'workspace:one', [
        {
          sourceId: 'source:one',
          sourceRecordId: '',
          observedAt: '2026-07-24T00:00:00.000Z',
          reason: 'source-request'
        }
      ])
    ).rejects.toThrow()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
