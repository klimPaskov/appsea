import { authRecoveryBatchInputSchema } from '@appsea/contracts'
import { createDatabasePool, databaseConfigFromEnv, PostgresAuthRepository } from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { createPasswordResetDeliveryClient } from './auth-recovery-delivery'
import { runAuthRecoveryBatch } from './auth-recovery-runner'

const taskQueue = 'appsea-auth-recovery-v1'
const enabled =
  process.env.NODE_ENV !== 'production' || process.env.APPSEA_AUTH_RECOVERY_ENABLED === 'true'

if (!enabled) {
  emitWorkerEvent({
    event: 'auth_recovery_disabled',
    taskQueue,
    failureCode: 'APPSEA_AUTH_RECOVERY_DISABLED'
  })
} else {
  const batchSize = Number(process.env.APPSEA_AUTH_RECOVERY_DELIVERY_BATCH_SIZE ?? '100')
  const input = authRecoveryBatchInputSchema.safeParse({ batchSize })
  const jobId = `auth-recovery:${Math.floor(Date.now() / 60_000)}`
  let pool: ReturnType<typeof createDatabasePool> | undefined
  try {
    if (!input.success) throw new Error('invalid batch size')
    const delivery = createPasswordResetDeliveryClient()
    pool = createDatabasePool(databaseConfigFromEnv())
    const result = await runAuthRecoveryBatch(input.data.batchSize, {
      auth: new PostgresAuthRepository(pool),
      delivery
    })
    emitWorkerEvent({
      event: 'auth_recovery_finished',
      taskQueue,
      jobId,
      passwordResetDeliveriesClaimed: result.claimed,
      passwordResetDeliveriesSent: result.sent,
      passwordResetDeliveriesFailed: result.failed
    })
  } catch {
    emitWorkerEvent({
      event: 'auth_recovery_failed',
      taskQueue,
      jobId,
      failureCode: 'APPSEA_AUTH_RECOVERY_FAILED'
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
  }
}
