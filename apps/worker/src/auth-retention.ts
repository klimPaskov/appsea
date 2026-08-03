import { authRetentionInputSchema, type AuthRetentionResult } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresAuthRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runAuthRetention } from './maintenance-runner'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
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
  const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
  const leaseRun = await runWithMaintenanceSchedulerLease<AuthRetentionResult>(
    {
      schedulerName,
      ownerId,
      leaseSeconds,
      metrics: {
        store: metrics,
        retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
        purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
        failureCode: (error) =>
          maintenanceSchedulerFailureCode(error, 'APPSEA_AUTH_RETENTION_FAILED'),
        summarize: (result) => ({
          sessionsDeleted: result.sessionsDeleted,
          rateLimitsDeleted: result.rateLimitsDeleted,
          passwordResetTokensDeleted: result.passwordResetTokensDeleted,
          workspaceInvitationsDeleted: result.workspaceInvitationsDeleted,
          mfaChallengesDeleted: result.mfaChallengesDeleted,
          mfaEventsDeleted: result.mfaEventsDeleted,
          mfaPendingEnrollmentsDeleted: result.mfaPendingEnrollmentsDeleted
        })
      }
    },
    new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
    async ({ assertLease, fence }) =>
      runAuthRetention(input, {
        auth: new PostgresAuthRepository(pool),
        assertLease,
        fence
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
      workspaceInvitationsDeleted: result.workspaceInvitationsDeleted,
      mfaChallengesDeleted: result.mfaChallengesDeleted,
      mfaEventsDeleted: result.mfaEventsDeleted,
      mfaPendingEnrollmentsDeleted: result.mfaPendingEnrollmentsDeleted
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
