import {
  sourceQuotaReconciliationAlertInputSchema,
  sourceQuotaReconciliationAlertLimits,
  type SourceQuotaReconciliationAlertResult
} from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresSourceQuotaRepository
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
import { runSourceQuotaReconciliationAlert } from './source-quota-reconciliation-alert'

const taskQueue = 'appsea-source-quota-alerts-v1'

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

function eventForResult(result: SourceQuotaReconciliationAlertResult): string {
  if (result.state === 'alert') return 'source_quota_reconciliation_alert'
  if (result.state === 'incomplete') return 'source_quota_reconciliation_alert_incomplete'
  return 'source_quota_reconciliation_clear'
}

async function main(): Promise<void> {
  let servicePool: ReturnType<typeof createDatabasePool> | undefined
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  try {
    const input = sourceQuotaReconciliationAlertInputSchema.parse({
      observedAt: new Date().toISOString(),
      maxWorkspaces: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_QUOTA_ALERT_MAX_WORKSPACES',
        sourceQuotaReconciliationAlertLimits.defaultMaxWorkspaces,
        1,
        sourceQuotaReconciliationAlertLimits.maxWorkspaces
      ),
      maxCasesPerWorkspace: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_QUOTA_ALERT_MAX_CASES_PER_WORKSPACE',
        sourceQuotaReconciliationAlertLimits.defaultMaxCasesPerWorkspace,
        1,
        sourceQuotaReconciliationAlertLimits.maxCasesPerWorkspace
      ),
      alertAfterSeconds: boundedEnvironmentInteger(
        process.env,
        'APPSEA_SOURCE_QUOTA_ALERT_AFTER_SECONDS',
        sourceQuotaReconciliationAlertLimits.defaultAlertAfterSeconds,
        1,
        sourceQuotaReconciliationAlertLimits.maxAlertAfterSeconds
      )
    })
    servicePool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const serviceQuotaRepository = new PostgresSourceQuotaRepository(servicePool)
    const maintenanceQuotaRepository = new PostgresSourceQuotaRepository(maintenancePool)
    const leaseRun = await runWithMaintenanceSchedulerLease<SourceQuotaReconciliationAlertResult>(
      {
        schedulerName: taskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_QUOTA_ALERT_FAILED'),
          summarize: (result) => ({
            workspacesScanned: result.workspacesScanned,
            openCases: result.openCases,
            oldestOpenCaseAgeSeconds: result.oldestOpenCaseAgeSeconds ?? 0,
            alerted: result.alerted ? 1 : 0,
            truncated: result.truncated ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease }) => {
        return runSourceQuotaReconciliationAlert(input, {
          assertLease,
          workspaces: serviceQuotaRepository,
          cases: maintenanceQuotaRepository
        })
      }
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
    emitWorkerEvent({
      event: eventForResult(result),
      taskQueue,
      schedulerName: taskQueue,
      state: result.state,
      workspacesScanned: result.workspacesScanned,
      sourceQuotaReconciliationOpenCases: result.openCases,
      sourceQuotaReconciliationOldestAgeSeconds: result.oldestOpenCaseAgeSeconds ?? 0,
      sourceQuotaReconciliationTruncated: result.truncated
    })
  } catch (error) {
    emitWorkerEvent({
      event: 'source_quota_reconciliation_alert_failed',
      taskQueue,
      schedulerName: taskQueue,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_QUOTA_ALERT_FAILED')
    })
    process.exitCode = 1
  } finally {
    if (servicePool) await servicePool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}

await main()
