import { workspaceInvitationDeliveryBatchInputSchema } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresAuthRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { createWorkspaceInvitationDeliveryClient } from './workspace-invitation-delivery'
import {
  runWorkspaceInvitationBatch,
  type WorkspaceInvitationBatchResult
} from './workspace-invitation-runner'
import {
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceDatabaseConfigFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'

const taskQueue = 'appsea-workspace-invitations-v1'
const enabled =
  ['development', 'test'].includes(process.env.NODE_ENV ?? '') ||
  (process.env.NODE_ENV === 'production' && process.env.APPSEA_AUTH_INVITATIONS_ENABLED === 'true')

if (!enabled) {
  emitWorkerEvent({
    event: 'workspace_invitation_delivery_disabled',
    taskQueue,
    failureCode: 'APPSEA_WORKSPACE_INVITATIONS_DISABLED'
  })
} else {
  const batchSize = Number(process.env.APPSEA_WORKSPACE_INVITATION_DELIVERY_BATCH_SIZE ?? '100')
  const input = workspaceInvitationDeliveryBatchInputSchema.safeParse({ batchSize })
  const jobId = `workspace-invitations:${Math.floor(Date.now() / 60_000)}`
  let pool: ReturnType<typeof createDatabasePool> | undefined
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  try {
    if (!input.success) throw new Error('invalid batch size')
    const delivery = createWorkspaceInvitationDeliveryClient()
    pool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const schedulerName = taskQueue
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<WorkspaceInvitationBatchResult>(
      {
        schedulerName,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'),
          summarize: (result) => ({
            workspaceInvitationDeliveriesClaimed: result.claimed,
            workspaceInvitationDeliveriesSent: result.sent,
            workspaceInvitationDeliveriesFailed: result.failed
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease, fence }) => {
        return runWorkspaceInvitationBatch(input.data.batchSize, {
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
        event: 'workspace_invitation_delivery_finished',
        taskQueue,
        jobId,
        workspaceInvitationDeliveriesClaimed: result.claimed,
        workspaceInvitationDeliveriesSent: result.sent,
        workspaceInvitationDeliveriesFailed: result.failed
      })
    }
  } catch (error) {
    emitWorkerEvent({
      event: 'workspace_invitation_delivery_failed',
      taskQueue,
      jobId,
      failureCode: maintenanceSchedulerFailureCode(
        error,
        'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'
      )
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}
