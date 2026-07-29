import { authRecoveryBatchInputSchema } from '@appsea/contracts'
import type { PasswordResetDeliveryRecord, PostgresAuthRepository } from '@appsea/db'

export interface AuthRecoveryBatchResult {
  claimed: number
  sent: number
  failed: number
}

export interface AuthRecoveryBatchDependencies {
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
  const records = await dependencies.auth.claimPasswordResetDeliveries(input.batchSize)
  let sent = 0
  let failed = 0
  for (const record of records) {
    try {
      if (
        !Number.isFinite(Date.parse(record.expiresAt)) ||
        Date.parse(record.expiresAt) <= Date.now()
      ) {
        throw new Error('expired delivery')
      }
      await dependencies.delivery.send(record)
      await dependencies.auth.completePasswordResetDelivery(record.deliveryId)
      sent += 1
    } catch {
      failed += 1
      try {
        await dependencies.auth.failPasswordResetDelivery(
          record.deliveryId,
          'APPSEA_AUTH_RECOVERY_DELIVERY_FAILED'
        )
      } catch {
        // The lease remains recoverable by the database claim function. Do
        // not replace the fixed failure event with a raw database error.
      }
    }
  }
  return { claimed: records.length, sent, failed }
}
