import { describe, expect, it, vi } from 'vitest'
import type { OperationalAlertOutboxClaim, OperationalAlertPayload } from '@appsea/contracts'
import type { OperationalAlertOutboxMaintenanceStore } from './operational-alert-delivery'
import { runOperationalAlertDeliveryPass } from './operational-alert-delivery'

const payload: OperationalAlertPayload = {
  schemaVersion: 1,
  service: 'appsea-worker',
  observedAt: '2026-08-04T00:00:00.000Z',
  event: 'source_quota_reconciliation_alert',
  taskQueue: 'appsea-source-quota-alerts-v1',
  schedulerName: 'appsea-source-quota-alerts-v1',
  sourceQuotaReconciliationOpenCases: 2,
  sourceQuotaReconciliationTruncated: false
}

function claim(attemptCount = 1): OperationalAlertOutboxClaim {
  return {
    deliveryId: 'alert:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    payload,
    attemptCount,
    claimId: '00000000-0000-4000-8000-000000000001',
    claimedBy: 'worker:alerts:one',
    claimExpiresAt: '2026-08-04T00:05:00.000Z'
  }
}

function fakeOutbox(claims: OperationalAlertOutboxClaim[]): {
  outbox: OperationalAlertOutboxMaintenanceStore
  completed: string[]
  failures: Array<{ deliveryId: string; failureCode: string }>
} {
  const completed: string[] = []
  const failures: Array<{ deliveryId: string; failureCode: string }> = []
  return {
    outbox: {
      enqueue: vi.fn(async () => ({ enqueued: true })),
      claim: vi.fn(async () => claims),
      complete: vi.fn(async ({ deliveryId }) => {
        completed.push(deliveryId)
        return { completed: true }
      }),
      fail: vi.fn(async ({ deliveryId, failureCode }) => {
        failures.push({ deliveryId, failureCode })
        return { applied: true, state: 'pending' as const }
      }),
      purge: vi.fn(async () => 2)
    },
    completed,
    failures
  }
}

const input = {
  ownerId: 'worker:alerts:one',
  maxAlerts: 10,
  claimTtlSeconds: 300,
  retentionDays: 30,
  purgeBatchSize: 100
}

describe('operational alert delivery pass', () => {
  it('completes successful claims and purges retained terminal rows', async () => {
    const fake = fakeOutbox([claim()])
    const deliver = vi.fn(async () => 'sent' as const)

    await expect(
      runOperationalAlertDeliveryPass(input, {
        outbox: fake.outbox,
        deliver,
        now: () => new Date('2026-08-04T00:00:00.000Z')
      })
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0, purged: 2 })
    expect(deliver).toHaveBeenCalledWith(payload)
    expect(fake.completed).toEqual([claim().deliveryId])
    expect(fake.failures).toEqual([])
  })

  it('keeps provider failures retryable and marks the fixed failure code', async () => {
    const fake = fakeOutbox([claim(2)])
    const deliver = vi.fn(async () => {
      throw new Error('provider body must not leak')
    })

    await expect(
      runOperationalAlertDeliveryPass(input, {
        outbox: fake.outbox,
        deliver,
        now: () => new Date('2026-08-04T00:00:00.000Z')
      })
    ).resolves.toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0, purged: 2 })
    expect(fake.completed).toEqual([])
    expect(fake.failures).toEqual([
      { deliveryId: claim().deliveryId, failureCode: 'APPSEA_ALERT_DELIVERY_FAILED' }
    ])
  })

  it('validates bounded pass inputs before claiming work', async () => {
    const fake = fakeOutbox([])
    await expect(
      runOperationalAlertDeliveryPass(
        { ...input, maxAlerts: 101 },
        { outbox: fake.outbox, deliver: async () => 'sent' }
      )
    ).rejects.toThrow(/maxAlerts/)
    expect(fake.outbox.claim).not.toHaveBeenCalled()
  })
})
