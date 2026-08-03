import { randomUUID } from 'node:crypto'
import {
  operationalAlertOutboxLimits,
  type OperationalAlertOutboxClaim,
  type OperationalAlertOutboxPurgeInput,
  type OperationalAlertPayload
} from '@appsea/contracts'
import type { OperationalAlertOutboxStore } from './alert-delivery'

export interface OperationalAlertOutboxMaintenanceStore extends OperationalAlertOutboxStore {
  purge(input: OperationalAlertOutboxPurgeInput): Promise<number>
}

export interface OperationalAlertDeliveryPassInput {
  ownerId: string
  maxAlerts: number
  claimTtlSeconds: number
  retentionDays: number
  purgeBatchSize: number
}

export interface OperationalAlertDeliveryPassDependencies {
  outbox: OperationalAlertOutboxMaintenanceStore
  deliver: (payload: OperationalAlertPayload) => Promise<'disabled' | 'sent'>
  now?: () => Date
}

export interface OperationalAlertDeliveryPassResult {
  claimed: number
  sent: number
  failed: number
  exhausted: number
  purged: number
}

function validateInput(input: OperationalAlertDeliveryPassInput): void {
  if (!Number.isSafeInteger(input.maxAlerts) || input.maxAlerts < 1 || input.maxAlerts > 100) {
    throw new Error('maxAlerts must be between 1 and 100')
  }
  if (
    !Number.isSafeInteger(input.claimTtlSeconds) ||
    input.claimTtlSeconds < operationalAlertOutboxLimits.minClaimTtlSeconds ||
    input.claimTtlSeconds > operationalAlertOutboxLimits.maxClaimTtlSeconds
  ) {
    throw new Error('claimTtlSeconds must be between 30 and 3600')
  }
  if (
    !Number.isSafeInteger(input.retentionDays) ||
    input.retentionDays < 1 ||
    input.retentionDays > 3_650
  ) {
    throw new Error('retentionDays must be between 1 and 3650')
  }
  if (
    !Number.isSafeInteger(input.purgeBatchSize) ||
    input.purgeBatchSize < 1 ||
    input.purgeBatchSize > 10_000
  ) {
    throw new Error('purgeBatchSize must be between 1 and 10000')
  }
}

function retryAt(claim: OperationalAlertOutboxClaim, now: Date): string {
  const delayMs = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, claim.attemptCount - 1))
  return new Date(now.getTime() + delayMs).toISOString()
}

/**
 * Drain a bounded batch of durable alert claims. A provider failure is kept as
 * a fixed-code retry/exhaustion state; no exception text or payload is logged.
 */
export async function runOperationalAlertDeliveryPass(
  input: OperationalAlertDeliveryPassInput,
  dependencies: OperationalAlertDeliveryPassDependencies
): Promise<OperationalAlertDeliveryPassResult> {
  validateInput(input)
  const now = dependencies.now ?? (() => new Date())
  const claimed = await dependencies.outbox.claim({
    ownerId: input.ownerId,
    claimId: randomUUID(),
    limit: input.maxAlerts,
    claimTtlSeconds: input.claimTtlSeconds
  })
  let sent = 0
  let failed = 0
  let exhausted = 0

  for (const claim of claimed) {
    try {
      const result = await dependencies.deliver(claim.payload)
      if (result === 'disabled') {
        throw new Error('disabled')
      }
      const completed = await dependencies.outbox.complete({
        deliveryId: claim.deliveryId,
        ownerId: claim.claimedBy,
        claimId: claim.claimId,
        sentAt: now().toISOString()
      })
      if (!completed.completed) throw new Error('claim lost')
      sent += 1
    } catch {
      const failure = await dependencies.outbox.fail({
        deliveryId: claim.deliveryId,
        ownerId: claim.claimedBy,
        claimId: claim.claimId,
        failureCode: 'APPSEA_ALERT_DELIVERY_FAILED',
        retryAt: retryAt(claim, now())
      })
      if (failure.applied && failure.state === 'exhausted') exhausted += 1
      failed += 1
    }
  }

  const retentionBefore = new Date(
    now().getTime() - input.retentionDays * 24 * 60 * 60 * 1_000
  ).toISOString()
  const purged = await dependencies.outbox.purge({
    before: retentionBefore,
    limit: input.purgeBatchSize
  })
  return { claimed: claimed.length, sent, failed, exhausted, purged }
}
