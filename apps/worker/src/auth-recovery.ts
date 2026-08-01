import { authRecoveryBatchInputSchema } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresAuthRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { createPasswordResetDeliveryClient } from './auth-recovery-delivery'
import { runAuthRecoveryBatch, type AuthRecoveryBatchResult } from './auth-recovery-runner'
import {
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceDatabaseConfigFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'

const taskQueue = 'appsea-auth-recovery-v1'
const enabled =
  ['development', 'test'].includes(process.env.NODE_ENV ?? '') ||
  (process.env.NODE_ENV === 'production' && process.env.APPSEA_AUTH_RECOVERY_ENABLED === 'true')

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
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  try {
    if (!input.success) throw new Error('invalid batch size')
    const delivery = createPasswordResetDeliveryClient()
    pool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const schedulerName = taskQueue
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<AuthRecoveryBatchResult>(
      {
        schedulerName,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_RECOVERY_FAILED'),
          summarize: (result) => ({
            passwordResetDeliveriesClaimed: result.claimed,
            passwordResetDeliveriesSent: result.sent,
            passwordResetDeliveriesFailed: result.failed
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease, fence }) => {
        return runAuthRecoveryBatch(input.data.batchSize, {
          auth: new PostgresAuthRepository(pool!),
          delivery,
          assertLease,
          fence
        })
      }
    )
    if (!leaseRun.acquired) {
      emitWorkerEvent({
        event: 'maintenance_scheduler_lease_contended',
        taskQueue,
        jobId,
        schedulerName
      })
    } else {
      const result = leaseRun.result
      emitWorkerEvent({
        event: 'auth_recovery_finished',
        taskQueue,
        jobId,
        passwordResetDeliveriesClaimed: result.claimed,
        passwordResetDeliveriesSent: result.sent,
        passwordResetDeliveriesFailed: result.failed
      })
    }
  } catch (error) {
    emitWorkerEvent({
      event: 'auth_recovery_failed',
      taskQueue,
      jobId,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_RECOVERY_FAILED')
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}
