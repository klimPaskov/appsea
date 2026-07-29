import { describe, expect, it } from 'vitest'
import type { WorkspaceInvitationDeliveryRecord } from '@appsea/db'
import { runWorkspaceInvitationBatch } from './workspace-invitation-runner'

const records: WorkspaceInvitationDeliveryRecord[] = [
  {
    deliveryId: 'delivery:one',
    invitationId: 'invite:one',
    workspaceId: 'workspace:one',
    email: 'one@example.com',
    tokenCiphertext: 'cipher',
    tokenNonce: 'nonce',
    tokenTag: 'tag',
    role: 'viewer',
    expiresAt: '2099-07-24T00:30:00.000Z'
  },
  {
    deliveryId: 'delivery:two',
    invitationId: 'invite:two',
    workspaceId: 'workspace:one',
    email: 'two@example.com',
    tokenCiphertext: 'cipher',
    tokenNonce: 'nonce',
    tokenTag: 'tag',
    role: 'editor',
    expiresAt: '2099-07-24T00:30:00.000Z'
  }
]

describe('workspace invitation outbox runner', () => {
  it('completes successes and retries failures with a fixed code', async () => {
    const completed: string[] = []
    const failed: Array<[string, string]> = []
    const result = await runWorkspaceInvitationBatch(2, {
      auth: {
        async claimWorkspaceInvitationDeliveries() {
          return records
        },
        async completeWorkspaceInvitationDelivery(id) {
          completed.push(id)
        },
        async failWorkspaceInvitationDelivery(id, code) {
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
    expect(failed).toEqual([['delivery:two', 'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED']])
  })

  it('bounds the claimed batch before touching the repository', async () => {
    await expect(
      runWorkspaceInvitationBatch(101, {
        auth: {
          async claimWorkspaceInvitationDeliveries() {
            throw new Error('must not be called')
          },
          async completeWorkspaceInvitationDelivery() {},
          async failWorkspaceInvitationDelivery() {}
        },
        delivery: { async send() {} }
      })
    ).rejects.toThrow()
  })
})
