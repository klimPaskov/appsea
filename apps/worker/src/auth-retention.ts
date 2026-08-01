import { authRetentionInputSchema } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresAuthRepository,
  PostgresMaintenanceSchedulerLeaseRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runAuthRetention } from './maintenance-runner'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'

const taskQueue = 'appsea-auth-maintenance-v1'
const retentionDays = Number(process.env.APPSEA_AUTH_RETENTION_DAYS ?? '7')
const batchSize = Number(process.env.APPSEA_AUTH_RETENTION_BATCH_SIZE ?? '1000')
const input = {
  jobId:
    process.env.APPSEA_AUTH_MAINTENANCE_JOB_ID ??
    `maintenance:auth:${Math.floor(Date.now() / 60_000)}`,
  retentionDays,
  batchSize
}
const validatedJobId = authRetentionInputSchema.safeParse(input).success
  ? authRetentionInputSchema.parse(input).jobId
  : undefined
const pool = createDatabasePool(databaseConfigFromEnv())
let maintenancePool: ReturnType<typeof createDatabasePool> | undefined

try {
  maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
  const schedulerName = taskQueue
  const ownerId = maintenanceSchedulerOwnerIdFromEnv()
  const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
  const leaseRun = await runWithMaintenanceSchedulerLease(
    { schedulerName, ownerId, leaseSeconds },
    new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
    async ({ assertLease }) =>
      runAuthRetention(input, {
        auth: new PostgresAuthRepository(pool),
        assertLease
      })
  )
  if (!leaseRun.acquired) {
    emitWorkerEvent({
      event: 'maintenance_scheduler_lease_contended',
      taskQueue,
      ...(validatedJobId ? { jobId: validatedJobId } : {}),
      schedulerName
    })
  } else {
    const result = leaseRun.result
    emitWorkerEvent({
      event: 'auth_retention_finished',
      taskQueue,
      jobId: result.jobId,
      sessionsDeleted: result.sessionsDeleted,
      rateLimitsDeleted: result.rateLimitsDeleted,
      passwordResetTokensDeleted: result.passwordResetTokensDeleted,
      workspaceInvitationsDeleted: result.workspaceInvitationsDeleted
    })
  }
} catch (error) {
  emitWorkerEvent({
    event: 'auth_retention_failed',
    taskQueue,
    ...(validatedJobId ? { jobId: validatedJobId } : {}),
    failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_RETENTION_FAILED')
  })
  process.exitCode = 1
} finally {
  await pool.end()
  if (maintenancePool) await maintenancePool.end()
}
