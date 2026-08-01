import { describe, expect, it } from 'vitest'
import type { PasswordResetDeliveryRecord } from '@appsea/db'
import type { MaintenanceSchedulerFence } from '@appsea/contracts'
import { runAuthRecoveryBatch } from './auth-recovery-runner'

const records: PasswordResetDeliveryRecord[] = [
  {
    deliveryId: 'delivery:one',
    email: 'one@example.com',
    tokenCiphertext: 'cipher',
    tokenNonce: 'nonce',
    tokenTag: 'tag',
    expiresAt: '2099-07-24T00:30:00.000Z'
  },
  {
    deliveryId: 'delivery:two',
    email: 'two@example.com',
    tokenCiphertext: 'cipher',
    tokenNonce: 'nonce',
    tokenTag: 'tag',
    expiresAt: '2099-07-24T00:30:00.000Z'
  }
]

describe('password recovery outbox runner', () => {
  it('completes successes and retries failures with a fixed code', async () => {
    const completed: string[] = []
    const failed: Array<[string, string]> = []
    const fences: Array<MaintenanceSchedulerFence | undefined> = []
    const fence: MaintenanceSchedulerFence = {
      schedulerName: 'appsea-auth-recovery-v1',
      ownerId: 'worker:host:1',
      leaseToken: 'token:worker:host:123'
    }
    const result = await runAuthRecoveryBatch(2, {
      auth: {
        async claimPasswordResetDeliveries(_batchSize, receivedFence) {
          fences.push(receivedFence)
          return records
        },
        async completePasswordResetDelivery(id, receivedFence) {
          fences.push(receivedFence)
          completed.push(id)
        },
        async failPasswordResetDelivery(id, code, receivedFence) {
          fences.push(receivedFence)
          failed.push([id, code])
        }
      },
      delivery: {
        async send(record) {
          if (record.deliveryId === 'delivery:two') throw new Error('provider body must not leak')
        }
      },
      fence
    })
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 })
    expect(completed).toEqual(['delivery:one'])
    expect(failed).toEqual([['delivery:two', 'APPSEA_AUTH_RECOVERY_DELIVERY_FAILED']])
    expect(fences).toEqual([fence, fence, fence])
  })

  it('bounds the claimed batch before touching the repository', async () => {
    await expect(
      runAuthRecoveryBatch(101, {
        auth: {
          async claimPasswordResetDeliveries() {
            throw new Error('must not be called')
          },
          async completePasswordResetDelivery() {},
          async failPasswordResetDelivery() {}
        },
        delivery: { async send() {} }
      })
    ).rejects.toThrow()
  })
})
