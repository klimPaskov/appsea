import { describe, expect, it } from 'vitest'
import type { MaintenanceSchedulerFence } from '@appsea/contracts'
import { runAuthMfaKeyRotationBatch } from './auth-mfa-key-rotation-runner'

describe('MFA key rotation runner', () => {
  it('asserts the lease and passes the private fence to one bounded batch', async () => {
    const fence: MaintenanceSchedulerFence = {
      schedulerName: 'appsea-auth-mfa-rotation-v1',
      ownerId: 'worker:host:1',
      leaseToken: 'token:worker:host:123'
    }
    const calls: Array<{ batchSize: number; fence?: MaintenanceSchedulerFence }> = []
    let leaseChecks = 0
    const result = await runAuthMfaKeyRotationBatch(100, {
      fence,
      assertLease: async () => {
        leaseChecks += 1
      },
      auth: {
        async rewrapMfaKeyBatch(input, receivedFence) {
          calls.push({
            batchSize: input.batchSize,
            ...(receivedFence ? { fence: receivedFence } : {})
          })
          return {
            currentKeyVersion: 2,
            previousKeyVersion: 1,
            batchSize: input.batchSize,
            rewrappedAccounts: 3,
            remainingPreviousKeyAccounts: 4,
            completed: false
          }
        }
      }
    })
    expect(leaseChecks).toBe(1)
    expect(calls).toEqual([{ batchSize: 100, fence }])
    expect(result.completed).toBe(false)
  })

  it('rejects an unsafe batch before touching the repository', async () => {
    await expect(
      runAuthMfaKeyRotationBatch(1_001, {
        auth: {
          async rewrapMfaKeyBatch() {
            throw new Error('must not be called')
          }
        }
      })
    ).rejects.toThrow()
  })
})
