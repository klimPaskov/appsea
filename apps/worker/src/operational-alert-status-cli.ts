import {
  createDatabasePool,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresOperationalAlertOutboxRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'
import {
  operationalAlertStatusEnabled,
  operationalAlertStatusEvent,
  operationalAlertStatusFailureCode,
  operationalAlertStatusInputFromEnv,
  operationalAlertStatusTaskQueue
} from './operational-alert-status'

async function main(): Promise<void> {
  if (!operationalAlertStatusEnabled()) {
    emitWorkerEvent({
      event: 'operational_alert_outbox_status_disabled',
      taskQueue: operationalAlertStatusTaskQueue,
      schedulerName: operationalAlertStatusTaskQueue,
      failureCode: 'APPSEA_ALERT_STATUS_DISABLED'
    })
    return
  }

  let pool: ReturnType<typeof createDatabasePool> | undefined
  try {
    const input = operationalAlertStatusInputFromEnv()
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    pool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const metrics = new PostgresMaintenanceSchedulerRunRepository(pool)
    const outbox = new PostgresOperationalAlertOutboxRepository(pool)
    const leaseRun = await runWithMaintenanceSchedulerLease(
      {
        schedulerName: operationalAlertStatusTaskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, operationalAlertStatusFailureCode),
          summarize: (result: {
            pendingCount: number
            sendingCount: number
            exhaustedCount: number
            oldestOpenAgeSeconds: number | null
            truncated: boolean
          }) => ({
            pending: result.pendingCount,
            sending: result.sendingCount,
            exhausted: result.exhaustedCount,
            oldestOpenAgeSeconds: result.oldestOpenAgeSeconds ?? 0,
            truncated: result.truncated ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(pool),
      async () => outbox.readStatus(input)
    )

    if (!leaseRun.acquired) {
      emitWorkerEvent({
        event: 'maintenance_scheduler_lease_contended',
        taskQueue: operationalAlertStatusTaskQueue,
        schedulerName: operationalAlertStatusTaskQueue
      })
      return
    }

    const result = leaseRun.result
    console.log(JSON.stringify(result))
    emitWorkerEvent({
      event: operationalAlertStatusEvent(result),
      taskQueue: operationalAlertStatusTaskQueue,
      schedulerName: operationalAlertStatusTaskQueue,
      state: result.state,
      operationalAlertOutboxPending: result.pendingCount,
      operationalAlertOutboxSending: result.sendingCount,
      operationalAlertOutboxExhausted: result.exhaustedCount,
      ...(result.oldestOpenAgeSeconds === null
        ? {}
        : { operationalAlertOutboxOldestAgeSeconds: result.oldestOpenAgeSeconds }),
      operationalAlertOutboxTruncated: result.truncated
    })
  } catch (error) {
    emitWorkerEvent({
      event: 'operational_alert_outbox_status_failed',
      taskQueue: operationalAlertStatusTaskQueue,
      schedulerName: operationalAlertStatusTaskQueue,
      failureCode: maintenanceSchedulerFailureCode(error, operationalAlertStatusFailureCode)
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
  }
}

await main()
