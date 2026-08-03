import {
  authMfaKeyRotationRewrapInputSchema,
  type AuthMfaKeyRotationRewrapResult
} from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresAuthRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runAuthMfaKeyRotationBatch } from './auth-mfa-key-rotation-runner'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'

const taskQueue = 'appsea-auth-mfa-rotation-v1'
const batchSize = Number(process.env.APPSEA_AUTH_MFA_ROTATION_BATCH_SIZE ?? '100')
const input = authMfaKeyRotationRewrapInputSchema.safeParse({ batchSize })
const jobId = 'maintenance:auth:mfa-rotation'

if (!input.success) {
  emitWorkerEvent({
    event: 'auth_mfa_rotation_failed',
    taskQueue,
    jobId,
    failureCode: 'APPSEA_AUTH_MFA_ROTATION_INVALID_BATCH'
  })
  process.exitCode = 1
} else {
  const pool = createDatabasePool(databaseConfigFromEnv())
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  try {
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const schedulerName = taskQueue
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<AuthMfaKeyRotationRewrapResult>(
      {
        schedulerName,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_MFA_ROTATION_FAILED'),
          summarize: (result) => ({
            rewrappedAccounts: result.rewrappedAccounts,
            remainingPreviousKeyAccounts: result.remainingPreviousKeyAccounts,
            completedBatches: result.completed ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease, fence }) =>
        runAuthMfaKeyRotationBatch(input.data.batchSize, {
          auth: new PostgresAuthRepository(pool),
          assertLease,
          fence
        })
    )
    if (!leaseRun.acquired) {
      emitWorkerEvent({
        event: 'maintenance_scheduler_lease_contended',
        taskQueue,
        schedulerName,
        jobId
      })
    } else {
      const result = leaseRun.result
      emitWorkerEvent({
        event: 'auth_mfa_rotation_finished',
        taskQueue,
        jobId,
        currentKeyVersion: result.currentKeyVersion,
        previousKeyVersion: result.previousKeyVersion,
        batchSize: result.batchSize,
        rewrappedAccounts: result.rewrappedAccounts,
        remainingPreviousKeyAccounts: result.remainingPreviousKeyAccounts,
        completed: result.completed
      })
    }
  } catch (error) {
    emitWorkerEvent({
      event: 'auth_mfa_rotation_failed',
      taskQueue,
      jobId,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_MFA_ROTATION_FAILED')
    })
    process.exitCode = 1
  } finally {
    await pool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}
