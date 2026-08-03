import {
  createDatabasePool,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresOperationalAlertOutboxRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { deliverOperationalAlert, operationalAlertConfigFromEnv } from './alert-delivery'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'
import { runOperationalAlertDeliveryPass } from './operational-alert-delivery'

const taskQueue = 'appsea-operational-alert-delivery-v1'

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(environment[name]?.trim() ?? String(fallback))
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its supported range`)
  }
  return value
}

async function main(): Promise<void> {
  const config = operationalAlertConfigFromEnv()
  if (!config) {
    emitWorkerEvent({
      event: 'operational_alert_delivery_disabled',
      taskQueue,
      schedulerName: taskQueue
    })
    return
  }

  let pool: ReturnType<typeof createDatabasePool> | undefined
  try {
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    pool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const outbox = new PostgresOperationalAlertOutboxRepository(pool)
    const metrics = new PostgresMaintenanceSchedulerRunRepository(pool)
    const leaseRun = await runWithMaintenanceSchedulerLease(
      {
        schedulerName: taskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_ALERT_DELIVERY_FAILED'),
          summarize: (result: {
            claimed: number
            sent: number
            failed: number
            exhausted: number
            purged: number
          }) => result
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(pool),
      async () =>
        runOperationalAlertDeliveryPass(
          {
            ownerId,
            maxAlerts: boundedInteger(process.env, 'APPSEA_ALERT_DELIVERY_MAX_ALERTS', 50, 1, 100),
            claimTtlSeconds: boundedInteger(
              process.env,
              'APPSEA_ALERT_DELIVERY_CLAIM_TTL_SECONDS',
              300,
              30,
              3_600
            ),
            retentionDays: boundedInteger(
              process.env,
              'APPSEA_ALERT_DELIVERY_RETENTION_DAYS',
              30,
              1,
              3_650
            ),
            purgeBatchSize: boundedInteger(
              process.env,
              'APPSEA_ALERT_DELIVERY_PURGE_BATCH_SIZE',
              1_000,
              1,
              10_000
            )
          },
          {
            outbox,
            deliver: (payload) => deliverOperationalAlert(payload, { config })
          }
        )
    )

    if (!leaseRun.acquired) {
      emitWorkerEvent({
        event: 'maintenance_scheduler_lease_contended',
        taskQueue,
        schedulerName: taskQueue
      })
      return
    }

    const result = leaseRun.result
    emitWorkerEvent({
      event: 'operational_alert_delivery_finished',
      taskQueue,
      schedulerName: taskQueue,
      state: result.failed > 0 ? 'failed' : 'succeeded',
      operationalAlertDeliveryClaimed: result.claimed,
      operationalAlertDeliverySent: result.sent,
      operationalAlertDeliveryFailed: result.failed,
      operationalAlertDeliveryExhausted: result.exhausted,
      operationalAlertDeliveryPurged: result.purged
    })
    if (result.failed > 0) process.exitCode = 1
  } catch {
    emitWorkerEvent({
      event: 'operational_alert_delivery_failed',
      taskQueue,
      schedulerName: taskQueue,
      failureCode: 'APPSEA_ALERT_DELIVERY_FAILED'
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
  }
}

await main()
