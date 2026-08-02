import {
  productionAnalysisRecomputeAlertInputSchema,
  productionAnalysisRecomputeAlertLimits,
  type ProductionAnalysisRecomputeAlertResult
} from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresProductionAnalysisRecomputeRepository
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
import { runProductionAnalysisRecomputeAlert } from './production-analysis-recompute-alert'

const taskQueue = 'appsea-production-analysis-recompute-alerts-v1'

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

function eventForResult(result: ProductionAnalysisRecomputeAlertResult): string {
  if (result.state === 'alert') return 'production_analysis_recompute_alert'
  if (result.state === 'incomplete') return 'production_analysis_recompute_alert_incomplete'
  return 'production_analysis_recompute_clear'
}

async function main(): Promise<void> {
  let servicePool: ReturnType<typeof createDatabasePool> | undefined
  let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
  try {
    const input = productionAnalysisRecomputeAlertInputSchema.parse({
      observedAt: new Date().toISOString(),
      maxWorkspaces: boundedEnvironmentInteger(
        process.env,
        'APPSEA_RECOMPUTE_ALERT_MAX_WORKSPACES',
        productionAnalysisRecomputeAlertLimits.defaultMaxWorkspaces,
        1,
        productionAnalysisRecomputeAlertLimits.maxWorkspaces
      ),
      maxJobsPerWorkspace: boundedEnvironmentInteger(
        process.env,
        'APPSEA_RECOMPUTE_ALERT_MAX_JOBS_PER_WORKSPACE',
        productionAnalysisRecomputeAlertLimits.defaultMaxJobsPerWorkspace,
        1,
        productionAnalysisRecomputeAlertLimits.maxJobsPerWorkspace
      ),
      alertAfterSeconds: boundedEnvironmentInteger(
        process.env,
        'APPSEA_RECOMPUTE_ALERT_AFTER_SECONDS',
        productionAnalysisRecomputeAlertLimits.defaultAlertAfterSeconds,
        1,
        productionAnalysisRecomputeAlertLimits.maxAlertAfterSeconds
      )
    })
    servicePool = createDatabasePool(databaseConfigFromEnv())
    maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
    const ownerId = maintenanceSchedulerOwnerIdFromEnv()
    const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
    const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const serviceRecomputations = new PostgresProductionAnalysisRecomputeRepository(servicePool)
    const maintenanceRecomputations = new PostgresProductionAnalysisRecomputeRepository(
      maintenancePool
    )
    const leaseRun = await runWithMaintenanceSchedulerLease<ProductionAnalysisRecomputeAlertResult>(
      {
        schedulerName: taskQueue,
        ownerId,
        leaseSeconds,
        metrics: {
          store: metrics,
          retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
          purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
          failureCode: (error) =>
            maintenanceSchedulerFailureCode(error, 'APPSEA_RECOMPUTE_ALERT_FAILED'),
          summarize: (result) => ({
            workspacesScanned: result.workspacesScanned,
            jobsObserved: result.jobsObserved,
            failedJobs: result.failedJobs,
            blockedJobs: result.blockedJobs,
            staleJobs: result.staleJobs,
            oldestOpenJobAgeSeconds: result.oldestOpenJobAgeSeconds ?? 0,
            alerted: result.alerted ? 1 : 0,
            truncated: result.truncated ? 1 : 0
          })
        }
      },
      new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
      async ({ assertLease }) =>
        runProductionAnalysisRecomputeAlert(input, {
          assertLease,
          workspaces: serviceRecomputations,
          observations: maintenanceRecomputations
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
    emitWorkerEvent({
      event: eventForResult(result),
      taskQueue,
      schedulerName: taskQueue,
      state: result.state,
      workspacesScanned: result.workspacesScanned,
      productionAnalysisRecomputeJobs: result.jobsObserved,
      productionAnalysisRecomputeFailed: result.failedJobs,
      productionAnalysisRecomputeBlocked: result.blockedJobs,
      productionAnalysisRecomputeStale: result.staleJobs,
      productionAnalysisRecomputeOldestAgeSeconds: result.oldestOpenJobAgeSeconds ?? 0,
      productionAnalysisRecomputeTruncated: result.truncated
    })
  } catch (error) {
    emitWorkerEvent({
      event: 'production_analysis_recompute_alert_failed',
      taskQueue,
      schedulerName: taskQueue,
      failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_RECOMPUTE_ALERT_FAILED')
    })
    process.exitCode = 1
  } finally {
    if (servicePool) await servicePool.end()
    if (maintenancePool) await maintenancePool.end()
  }
}

await main()
