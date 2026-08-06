import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { PostgresOperationalAlertOutboxRepository } from './operational-alert-outbox-repository'

const payload = {
  schemaVersion: 1 as const,
  service: 'appsea-worker' as const,
  observedAt: '2026-08-04T00:00:00.000Z',
  event: 'source_quota_reconciliation_alert',
  taskQueue: 'appsea-source-quota-alerts-v1',
  schedulerName: 'appsea-source-quota-alerts-v1',
  sourceQuotaReconciliationOpenCases: 2,
  sourceQuotaReconciliationTruncated: false
}

const deliveryId = 'alert:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ownerId = 'worker:alerts:one'
const claimId = '00000000-0000-4000-8000-000000000001'

function fakePool(): { pool: Pool; statements: string[] } {
  const statements: string[] = []
  const client = {
    query: async (text: string) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('enqueue_operational_alert')) {
        return { rows: [{ enqueued: true }], rowCount: 1 }
      }
      if (text.includes('claim_operational_alerts')) {
        return {
          rows: [
            {
              delivery_id: deliveryId,
              payload,
              attempt_count: 1,
              claim_id: claimId,
              claimed_by: ownerId,
              claim_expires_at: '2026-08-04T00:05:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('complete_operational_alert')) {
        return { rows: [{ completed: true }], rowCount: 1 }
      }
      if (text.includes('fail_operational_alert')) {
        return { rows: [{ applied: true, state: 'pending' }], rowCount: 1 }
      }
      if (text.includes('purge_operational_alerts')) {
        return { rows: [{ purged: 3 }], rowCount: 1 }
      }
      if (text.includes('read_operational_alert_outbox_status')) {
        return {
          rows: [
            {
              observed_at: '2026-08-04T00:00:00.000Z',
              pending_count: 2,
              sending_count: 1,
              exhausted_count: 0,
              oldest_open_age_seconds: 301,
              truncated: false,
              state: 'alert'
            }
          ],
          rowCount: 1
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

describe('operational alert outbox repository', () => {
  it('uses only maintenance-owned functions for enqueue, claim, completion, failure, purge, and status', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresOperationalAlertOutboxRepository(pool)

    await expect(
      repository.enqueue({
        deliveryId,
        payload,
        payloadHash: 'b'.repeat(64),
        availableAt: payload.observedAt
      })
    ).resolves.toEqual({ enqueued: true })
    await expect(
      repository.claim({ ownerId, claimId, limit: 10, claimTtlSeconds: 300 })
    ).resolves.toMatchObject([{ deliveryId, attemptCount: 1, claimId, claimedBy: ownerId }])
    await expect(
      repository.complete({ deliveryId, ownerId, claimId, sentAt: payload.observedAt })
    ).resolves.toEqual({ completed: true })
    await expect(
      repository.fail({
        deliveryId,
        ownerId,
        claimId,
        failureCode: 'APPSEA_ALERT_DELIVERY_FAILED',
        retryAt: payload.observedAt
      })
    ).resolves.toEqual({ applied: true, state: 'pending' })
    await expect(repository.purge({ before: '2026-08-04T00:00:00.000Z', limit: 10 })).resolves.toBe(
      3
    )
    await expect(repository.readStatus({ limit: 10, alertAfterSeconds: 300 })).resolves.toEqual({
      observedAt: '2026-08-04T00:00:00.000Z',
      pendingCount: 2,
      sendingCount: 1,
      exhaustedCount: 0,
      oldestOpenAgeSeconds: 301,
      truncated: false,
      state: 'alert'
    })

    expect(statements.some((text) => text.includes('enqueue_operational_alert'))).toBe(true)
    expect(statements.some((text) => text.includes('claim_operational_alerts'))).toBe(true)
    expect(statements.some((text) => text.includes('complete_operational_alert'))).toBe(true)
    expect(statements.some((text) => text.includes('fail_operational_alert'))).toBe(true)
    expect(statements.some((text) => text.includes('purge_operational_alerts'))).toBe(true)
    expect(statements.some((text) => text.includes('read_operational_alert_outbox_status'))).toBe(
      true
    )
    expect(statements.some((text) => text.includes('operational_alert_outbox '))).toBe(false)
  })

  it('rejects unsafe inputs before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresOperationalAlertOutboxRepository(pool)

    await expect(
      repository.enqueue({
        deliveryId,
        payload: { ...payload, raw: 'secret text' },
        payloadHash: 'b'.repeat(64),
        availableAt: payload.observedAt
      })
    ).rejects.toThrow()
    await expect(
      repository.claim({ ownerId, claimId, limit: 101, claimTtlSeconds: 300 })
    ).rejects.toThrow()
    await expect(
      repository.fail({
        deliveryId,
        ownerId,
        claimId,
        failureCode: 'raw provider error',
        retryAt: payload.observedAt
      })
    ).rejects.toThrow()
    await expect(repository.readStatus({ limit: 10, alertAfterSeconds: 0 })).rejects.toThrow()
    expect(statements).toHaveLength(0)
  })
})
