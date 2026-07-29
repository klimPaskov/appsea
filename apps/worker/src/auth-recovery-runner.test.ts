import { describe, expect, it } from 'vitest'
import type { PasswordResetDeliveryRecord } from '@appsea/db'
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
    const result = await runAuthRecoveryBatch(2, {
      auth: {
        async claimPasswordResetDeliveries() {
          return records
        },
        async completePasswordResetDelivery(id) {
          completed.push(id)
        },
        async failPasswordResetDelivery(id, code) {
          failed.push([id, code])
        }
      },
      delivery: {
        async send(record) {
          if (record.deliveryId === 'delivery:two') throw new Error('provider body must not leak')
        }
      }
    })
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 })
    expect(completed).toEqual(['delivery:one'])
    expect(failed).toEqual([['delivery:two', 'APPSEA_AUTH_RECOVERY_DELIVERY_FAILED']])
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
