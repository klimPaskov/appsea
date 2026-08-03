import {
  workspaceCostAlertInputSchema,
  workspaceCostAlertLimits,
  type WorkspaceCostAlertResult
} from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresOperationalAlertOutboxRepository,
  PostgresSourceQuotaRepository,
  PostgresWorkspaceCostAlertRepository
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
import { runWorkspaceCostAlert } from './workspace-cost-alert'

const taskQueue = 'appsea-workspace-cost-alerts-v1'

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

function boundedEnvironmentMicros(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback = '0'
): string {
  const value = environment[name]?.trim() || fallback
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(value)) {
    throw new Error(`${name} is outside its supported micro-unit range`)
  }
  return value
}

function eventForResult(result: WorkspaceCostAlertResult): string {
  if (result.state === 'alert') return 'workspace_cost_alert'
  if (result.state === 'incomplete') return 'workspace_cost_alert_incomplete'
  return 'workspace_cost_clear'
}

async function main(): Promise<void> {
  let servicePool: ReturnType<typeof createDatabasePool> | undefined
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  let ownerId: string | undefined
  try {
    const input = workspaceCostAlertInputSchema.parse({
      observedAt: new Date().toISOString(),
      maxWorkspaces: boundedEnvironmentInteger(
        process.env,
        'APPSEA_COST_ALERT_MAX_WORKSPACES',
        workspaceCostAlertLimits.defaultMaxWorkspaces,
        1,
        workspaceCostAlertLimits.maxWorkspaces
      ),
      maxCurrenciesPerWorkspace: boundedEnvironmentInteger(
        process.env,
        'APPSEA_COST_ALERT_MAX_CURRENCIES_PER_WORKSPACE',
        workspaceCostAlertLimits.defaultMaxCurrenciesPerWorkspace,
        1,
        workspaceCostAlertLimits.maxCurrenciesPerWorkspace
      ),
      periodSeconds: boundedEnvironmentInteger(
        process.env,
        'APPSEA_COST_ALERT_PERIOD_SECONDS',
        workspaceCostAlertLimits.defaultPeriodSeconds,
        1,
        workspaceCostAlertLimits.maxPeriodSeconds
      ),
      thresholdCurrency: (process.env.APPSEA_COST_ALERT_CURRENCY?.trim() || 'USD').toUpperCase(),
      actualThresholdMicros: boundedEnvironmentMicros(
        process.env,
        'APPSEA_COST_ALERT_ACTUAL_THRESHOLD_MICROS'
      ),
      estimatedThresholdMicros: boundedEnvironmentMicros(
        process.env,
        'APPSEA_COST_ALERT_ESTIMATED_THRESHOLD_MICROS'
      )
    })
    servicePool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const outbox = new PostgresOperationalAlertOutboxRepository(maintenancePool)
    const serviceWorkspaces = new PostgresSourceQuotaRepository(servicePool)
    const maintenanceCosts = new PostgresWorkspaceCostAlertRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<WorkspaceCostAlertResult>(
      {
        schedulerName: taskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_COST_ALERT_FAILED'),
          summarize: (result) => ({
            workspacesScanned: result.workspacesScanned,
            rowsObserved: result.rowsObserved,
            entriesObserved: result.entriesObserved,
            targetCurrencyRows: result.targetCurrencyRows,
            unsupportedCurrencyRows: result.unsupportedCurrencyRows,
            workspacesOverActualThreshold: result.workspacesOverActualThreshold,
            workspacesOverEstimatedThreshold: result.workspacesOverEstimatedThreshold,
            alerted: result.alerted ? 1 : 0,
            truncated: result.truncated ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease }) =>
        runWorkspaceCostAlert(input, {
          assertLease,
          workspaces: serviceWorkspaces,
          costs: maintenanceCosts
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
      workspaceCostAlertRows: result.rowsObserved,
      workspaceCostAlertEntries: result.entriesObserved,
      workspaceCostAlertTargetRows: result.targetCurrencyRows,
      workspaceCostAlertUnsupportedRows: result.unsupportedCurrencyRows,
      workspaceCostAlertWorkspacesOverActual: result.workspacesOverActualThreshold,
      workspaceCostAlertWorkspacesOverEstimated: result.workspacesOverEstimatedThreshold,
      workspaceCostAlertTruncated: result.truncated
    })
    if (isOperationalAlertEvent(payload)) {
      await enqueueAndDeliverOperationalAlert(payload, { outbox, ownerId })
    }
  } catch (error) {
    const payload = emitWorkerEvent({
      event: 'workspace_cost_alert_failed',
      taskQueue,
      schedulerName: taskQueue,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_COST_ALERT_FAILED')
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
