import { authRecoveryBatchInputSchema, type MaintenanceSchedulerFence } from '@appsea/contracts'
import type { PasswordResetDeliveryRecord, PostgresAuthRepository } from '@appsea/db'
import {
  isMaintenanceSchedulerFenceError,
  MaintenanceSchedulerLeaseLostError
} from './maintenance-scheduler'

export interface AuthRecoveryBatchResult {
  claimed: number
  sent: number
  failed: number
}

export interface AuthRecoveryBatchDependencies {
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
  auth: Pick<
    PostgresAuthRepository,
    'claimPasswordResetDeliveries' | 'completePasswordResetDelivery' | 'failPasswordResetDelivery'
  >
  delivery: { send(record: PasswordResetDeliveryRecord): Promise<void> }
}

export async function runAuthRecoveryBatch(
  batchSize: number,
  dependencies: AuthRecoveryBatchDependencies
): Promise<AuthRecoveryBatchResult> {
  const input = authRecoveryBatchInputSchema.parse({ batchSize })
  const assertLease = dependencies.assertLease ?? (async () => undefined)
  await assertLease()
  const records = await dependencies.auth.claimPasswordResetDeliveries(
    input.batchSize,
    dependencies.fence
  )
  let sent = 0
  let failed = 0
  for (const record of records) {
    try {
      await assertLease()
      if (
        !Number.isFinite(Date.parse(record.expiresAt)) ||
        Date.parse(record.expiresAt) <= Date.now()
      ) {
        throw new Error('expired delivery')
      }
      await dependencies.delivery.send(record)
      await assertLease()
      await dependencies.auth.completePasswordResetDelivery(record.deliveryId, dependencies.fence)
      sent += 1
    } catch (error) {
      if (
        error instanceof MaintenanceSchedulerLeaseLostError ||
        isMaintenanceSchedulerFenceError(error)
      ) {
        throw error
      }
      failed += 1
      try {
        await assertLease()
        await dependencies.auth.failPasswordResetDelivery(
          record.deliveryId,
          'APPSEA_AUTH_RECOVERY_DELIVERY_FAILED',
          dependencies.fence
        )
      } catch (error) {
        if (
          error instanceof MaintenanceSchedulerLeaseLostError ||
          isMaintenanceSchedulerFenceError(error)
        ) {
          throw error
        }
        // The lease remains recoverable by the database claim function. Do
        // not replace the fixed failure event with a raw database error.
      }
    }
  }
  return { claimed: records.length, sent, failed }
}
