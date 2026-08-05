import {
  sourceHealthAlertInputSchema,
  sourceHealthAlertLimits,
  type SourceHealthAlertResult
} from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresOperationalAlertOutboxRepository,
  PostgresSourcePolicyRepository,
  PostgresSourceQuotaRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import {
  deliverOperationalAlert,
  enqueueAndDeliverOperationalAlert,
  isOperationalAlertEvent
} from './alert-delivery'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'
import { runSourceHealthAlert } from './source-health-alert'

const taskQueue = 'appsea-source-health-alerts-v1'

function boundedEnvironmentInteger(
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

function eventForResult(result: SourceHealthAlertResult): string {
  if (result.state === 'alert') return 'source_health_alert'
  if (result.state === 'incomplete') return 'source_health_alert_incomplete'
  return 'source_health_clear'
}

async function main(): Promise<void> {
  let servicePool: ReturnType<typeof createDatabasePool> | undefined
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  let ownerId: string | undefined
  try {
    const input = sourceHealthAlertInputSchema.parse({
      observedAt: new Date().toISOString(),
      maxWorkspaces: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_HEALTH_ALERT_MAX_WORKSPACES',
        sourceHealthAlertLimits.defaultMaxWorkspaces,
        1,
        sourceHealthAlertLimits.maxWorkspaces
      ),
      maxSourcesPerWorkspace: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_HEALTH_ALERT_MAX_SOURCES_PER_WORKSPACE',
        sourceHealthAlertLimits.defaultMaxSourcesPerWorkspace,
        1,
        sourceHealthAlertLimits.maxSourcesPerWorkspace
      ),
      alertAfterSeconds: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_HEALTH_ALERT_AFTER_SECONDS',
        sourceHealthAlertLimits.defaultAlertAfterSeconds,
        1,
        sourceHealthAlertLimits.maxAlertAfterSeconds
      )
    })
    servicePool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const outbox = new PostgresOperationalAlertOutboxRepository(maintenancePool)
    const serviceWorkspaces = new PostgresSourceQuotaRepository(servicePool)
    const maintenanceSources = new PostgresSourcePolicyRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<SourceHealthAlertResult>(
      {
        schedulerName: taskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_HEALTH_ALERT_FAILED'),
          summarize: (result) => ({
            workspacesScanned: result.workspacesScanned,
            sourcesObserved: result.sourcesObserved,
            collectibleSources: result.collectibleSources,
            blockedSources: result.blockedSources,
            unknownSources: result.unknownSources,
            degradedSources: result.degradedSources,
            staleSources: result.staleSources,
            exhaustedSources: result.exhaustedSources,
            oldestDegradedAgeSeconds: result.oldestDegradedAgeSeconds ?? 0,
            alerted: result.alerted ? 1 : 0,
            truncated: result.truncated ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease }) =>
        runSourceHealthAlert(input, {
          assertLease,
          workspaces: serviceWorkspaces,
          observations: maintenanceSources
        })
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
    console.log(JSON.stringify(result))
    const payload = emitWorkerEvent({
      event: eventForResult(result),
      taskQueue,
      schedulerName: taskQueue,
      state: result.state,
      workspacesScanned: result.workspacesScanned,
      sourceHealthSourcesObserved: result.sourcesObserved,
      sourceHealthCollectibleSources: result.collectibleSources,
      sourceHealthBlockedSources: result.blockedSources,
      sourceHealthUnknownSources: result.unknownSources,
      sourceHealthDegradedSources: result.degradedSources,
      sourceHealthStaleSources: result.staleSources,
      sourceHealthExhaustedSources: result.exhaustedSources,
      sourceHealthOldestDegradedAgeSeconds: result.oldestDegradedAgeSeconds ?? 0,
      sourceHealthTruncated: result.truncated
    })
    if (isOperationalAlertEvent(payload)) {
      await enqueueAndDeliverOperationalAlert(payload, { outbox, ownerId })
    }
  } catch (error) {
    const payload = emitWorkerEvent({
      event: 'source_health_alert_failed',
      taskQueue,
      schedulerName: taskQueue,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_HEALTH_ALERT_FAILED')
    })
    try {
      if (maintenancePool && ownerId) {
        await enqueueAndDeliverOperationalAlert(payload, {
          outbox: new PostgresOperationalAlertOutboxRepository(maintenancePool),
          ownerId
        })
      } else {
        await deliverOperationalAlert(payload)
      }
    } catch {
      emitWorkerEvent({
        event: 'operational_alert_delivery_failed',
        taskQueue,
        schedulerName: taskQueue,
        failureCode: 'APPSEA_ALERT_DELIVERY_FAILED'
      })
    }
    process.exitCode = 1
  } finally {
    if (servicePool) await servicePool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}

await main()
