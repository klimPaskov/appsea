import { Connection, WorkflowClient } from '@temporalio/client'
import { sourceMaintenanceInputSchema, type SourceMaintenanceResult } from '@appsea/contracts'
import { objectStoreFromEnv } from '@appsea/object-store'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresDeletionPropagationRepository,
  PostgresProductionAnalysisAdmissionRepository,
  PostgresProductionAnalysisObjectPurgeRepository,
  PostgresProductionWorkflowAdmissionRepository,
  PostgresResearchCampaignRepository,
  PostgresResearchCampaignOrchestrationRepository,
  PostgresSourcePolicyRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresSourceCollectionLeaseRepository,
  PostgresSourceQuotaRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runSourceMaintenance } from './maintenance-runner'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  runWithMaintenanceSchedulerLease
} from './maintenance-scheduler'
import {
  defaultSourceSnapshotReconciliationDependencies,
  runNextProductionCfpbSnapshotReconciliation
} from './production-cfpb-reconciliation'
import { runCampaignRefresh } from './campaign-refresh-runner'
import { runCampaignOrchestration } from './campaign-orchestration-runner'
import {
  startProductionCollectionWorkflow,
  temporalClientConfigFromEnv,
  temporalConnectionOptions
} from '@appsea/workflows'

const taskQueue = 'appsea-source-maintenance-v1'
const quotaBatchSize = Number(process.env.APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE ?? '1000')
const deletionBatchSize = Number(process.env.APPSEA_DELETION_BATCH_SIZE ?? '100')
const retentionBatchSize = Number(process.env.APPSEA_RETENTION_BATCH_SIZE ?? '100')
const snapshotReconciliationBatchSize = Number(
  process.env.APPSEA_SOURCE_SNAPSHOT_RECONCILIATION_BATCH_SIZE ?? '1'
)
const campaignRefreshBatchSize = Number(process.env.APPSEA_CAMPAIGN_REFRESH_BATCH_SIZE ?? '1')
const campaignOrchestrationBatchSize = Number(
  process.env.APPSEA_CAMPAIGN_ORCHESTRATION_BATCH_SIZE ?? '1'
)
const quotaRetentionDays = Number(process.env.APPSEA_SOURCE_QUOTA_RETENTION_DAYS ?? '30')
const input = {
  jobId:
    process.env.APPSEA_SOURCE_MAINTENANCE_JOB_ID ??
    `maintenance:source:${Math.floor(Date.now() / 60_000)}`,
  occurredAt: new Date().toISOString(),
  quotaBatchSize,
  deletionBatchSize,
  retentionBatchSize,
  snapshotReconciliationBatchSize,
  campaignRefreshBatchSize,
  campaignOrchestrationBatchSize,
  quotaRetentionDays,
  workspaceId: process.env.APPSEA_DELETION_WORKSPACE_ID ?? null
}
const validatedJobId = sourceMaintenanceInputSchema.safeParse(input).success
  ? sourceMaintenanceInputSchema.parse(input).jobId
  : undefined
const objectStore = objectStoreFromEnv(process.env)
const pool = createDatabasePool(databaseConfigFromEnv())
let maintenancePool: ReturnType<typeof createDatabasePool> | undefined
let temporalConnection: Connection | undefined
let temporalClient: WorkflowClient | undefined

try {
  maintenancePool = createDatabasePool(maintenanceDatabaseConfigFromEnv())
  const schedulerName = taskQueue
  const ownerId = maintenanceSchedulerOwnerIdFromEnv()
  const leaseSeconds = maintenanceSchedulerLeaseSecondsFromEnv()
  const metrics = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
  const leaseRun = await runWithMaintenanceSchedulerLease<SourceMaintenanceResult>(
    {
      schedulerName,
      ownerId,
      leaseSeconds,
      metrics: {
        store: metrics,
        retentionDays: maintenanceSchedulerMetricsRetentionDaysFromEnv(),
        purgeBatchSize: maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(),
        failureCode: (error) =>
          maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_MAINTENANCE_FAILED'),
        summarize: (result) => ({
          quotaWorkspacesScanned: result.quotaWorkspacesScanned,
          deletionWorkspacesScanned: result.deletionWorkspacesScanned,
          quotaReservationsExpired: result.quotaReservationsExpired,
          quotaReservationsPurged: result.quotaReservationsPurged,
          productionWorkflowAdmissionsPurged: result.productionWorkflowAdmissionsPurged,
          productionAnalysisAdmissionsPurged: result.productionAnalysisAdmissionsPurged,
          sourceCollectionLeasesPurged: result.sourceCollectionLeasesPurged,
          productionAnalysisObjectsPurged: result.productionAnalysisObjectsPurged,
          sourceSnapshotReconciliationsProcessed: result.sourceSnapshotReconciliationsProcessed,
          sourceSnapshotReconciliationsCompleted: result.sourceSnapshotReconciliationsCompleted,
          sourceSnapshotReconciliationsIncomplete: result.sourceSnapshotReconciliationsIncomplete,
          sourceSnapshotReconciliationsFailed: result.sourceSnapshotReconciliationsFailed,
          sourceSnapshotReconciliationsRetried: result.sourceSnapshotReconciliationsRetried,
          sourceSnapshotCoverageGaps: result.sourceSnapshotCoverageGaps,
          retentionTombstonesQueued: result.retentionTombstonesQueued,
          deletionTombstonesProcessed: result.deletionTombstonesProcessed,
          deletionObjectsAffected: result.deletionObjectsAffected,
          deletionOpportunitiesInvalidated: result.deletionOpportunitiesInvalidated,
          recomputationJobsQueued: result.recomputationJobsQueued,
          campaignRefreshClaims: result.campaignRefreshClaims,
          campaignRefreshDispatched: result.campaignRefreshDispatched,
          campaignRefreshFailed: result.campaignRefreshFailed,
          campaignRefreshPolicyDenied: result.campaignRefreshPolicyDenied,
          campaignOrchestrationClaims: result.campaignOrchestrationClaims,
          campaignOrchestrationDispatched: result.campaignOrchestrationDispatched,
          campaignOrchestrationFailed: result.campaignOrchestrationFailed,
          campaignOrchestrationPolicyDenied: result.campaignOrchestrationPolicyDenied,
          campaignOrchestrationReconciled: result.campaignOrchestrationReconciled
        })
      }
    },
    new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool),
    async ({ assertLease, fence }) => {
      const quotaRepository = new PostgresSourceQuotaRepository(pool)
      const deletionRepository = new PostgresDeletionPropagationRepository(pool)
      const admissionRepository = new PostgresProductionWorkflowAdmissionRepository(pool)
      const campaignRepository = new PostgresResearchCampaignRepository(pool)
      const campaignOrchestrationRepository = new PostgresResearchCampaignOrchestrationRepository(
        pool
      )
      const policyRepository = new PostgresSourcePolicyRepository(pool)
      const analysisAdmissionRepository = new PostgresProductionAnalysisAdmissionRepository(pool)
      const objectPurgeRepository = new PostgresProductionAnalysisObjectPurgeRepository(
        pool,
        objectStore
      )
      const leaseRepository = new PostgresSourceCollectionLeaseRepository(pool)
      const snapshotDependencies = defaultSourceSnapshotReconciliationDependencies(pool)
      await assertLease()
      return runSourceMaintenance(input, {
        quota: quotaRepository,
        deletion: deletionRepository,
        admission: admissionRepository,
        analysisAdmission: analysisAdmissionRepository,
        leases: leaseRepository,
        objectPurge: objectPurgeRepository,
        fence,
        snapshotReconciliation: async (workspaceId) => {
          await assertLease()
          return runNextProductionCfpbSnapshotReconciliation(workspaceId, snapshotDependencies)
        },
        campaignRefresh: async () =>
          runCampaignRefresh(
            {
              batchSize: input.campaignRefreshBatchSize,
              claimOwner: ownerId,
              claimLeaseSeconds: leaseSeconds,
              retryAfterSeconds: 300,
              occurredAt: input.occurredAt,
              assertLease,
              fence
            },
            {
              campaigns: campaignRepository,
              policies: policyRepository,
              admission: admissionRepository,
              startWorkflow: async (request) => {
                if (!temporalClient) {
                  const config = temporalClientConfigFromEnv()
                  temporalConnection = await Connection.connect(temporalConnectionOptions(config))
                  temporalClient = new WorkflowClient({
                    connection: temporalConnection,
                    namespace: config.namespace
                  })
                }
                const handle = await startProductionCollectionWorkflow(temporalClient, request)
                return { workflowId: handle.workflowId }
              }
            }
          ),
        campaignOrchestration: async () =>
          runCampaignOrchestration(
            {
              batchSize: input.campaignOrchestrationBatchSize,
              claimOwner: ownerId,
              claimLeaseSeconds: leaseSeconds,
              retryAfterSeconds: 300,
              occurredAt: input.occurredAt,
              assertLease,
              fence
            },
            {
              orchestrations: campaignOrchestrationRepository,
              policies: policyRepository,
              admission: admissionRepository,
              startWorkflow: async (request) => {
                if (!temporalClient) {
                  const config = temporalClientConfigFromEnv()
                  temporalConnection = await Connection.connect(temporalConnectionOptions(config))
                  temporalClient = new WorkflowClient({
                    connection: temporalConnection,
                    namespace: config.namespace
                  })
                }
                const handle = await startProductionCollectionWorkflow(temporalClient, request)
                return { workflowId: handle.workflowId }
              }
            }
          ),
        assertLease
      })
    }
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
      event: 'source_quota_expiry_finished',
      taskQueue,
      jobId: result.jobId,
      quotaReservationsExpired: result.quotaReservationsExpired,
      quotaReservationsPurged: result.quotaReservationsPurged,
      productionWorkflowAdmissionsPurged: result.productionWorkflowAdmissionsPurged,
      productionAnalysisAdmissionsPurged: result.productionAnalysisAdmissionsPurged,
      sourceCollectionLeasesPurged: result.sourceCollectionLeasesPurged,
      campaignRefreshClaims: result.campaignRefreshClaims,
      campaignRefreshDispatched: result.campaignRefreshDispatched,
      campaignRefreshFailed: result.campaignRefreshFailed,
      campaignRefreshPolicyDenied: result.campaignRefreshPolicyDenied,
      campaignOrchestrationClaims: result.campaignOrchestrationClaims,
      campaignOrchestrationDispatched: result.campaignOrchestrationDispatched,
      campaignOrchestrationFailed: result.campaignOrchestrationFailed,
      campaignOrchestrationPolicyDenied: result.campaignOrchestrationPolicyDenied,
      campaignOrchestrationReconciled: result.campaignOrchestrationReconciled
    })
    if (result.campaignRefreshClaims > 0) {
      emitWorkerEvent({
        event: 'campaign_refresh_batch_finished',
        taskQueue,
        jobId: result.jobId,
        campaignRefreshClaims: result.campaignRefreshClaims,
        campaignRefreshDispatched: result.campaignRefreshDispatched,
        campaignRefreshFailed: result.campaignRefreshFailed,
        campaignRefreshPolicyDenied: result.campaignRefreshPolicyDenied,
        campaignOrchestrationClaims: result.campaignOrchestrationClaims,
        campaignOrchestrationDispatched: result.campaignOrchestrationDispatched,
        campaignOrchestrationFailed: result.campaignOrchestrationFailed,
        campaignOrchestrationPolicyDenied: result.campaignOrchestrationPolicyDenied,
        campaignOrchestrationReconciled: result.campaignOrchestrationReconciled
      })
    }
    if (result.campaignOrchestrationClaims > 0) {
      emitWorkerEvent({
        event: 'campaign_orchestration_batch_finished',
        taskQueue,
        jobId: result.jobId,
        campaignOrchestrationClaims: result.campaignOrchestrationClaims,
        campaignOrchestrationDispatched: result.campaignOrchestrationDispatched,
        campaignOrchestrationFailed: result.campaignOrchestrationFailed,
        campaignOrchestrationPolicyDenied: result.campaignOrchestrationPolicyDenied,
        campaignOrchestrationReconciled: result.campaignOrchestrationReconciled
      })
    }
    if (result.sourceSnapshotReconciliationsProcessed > 0) {
      emitWorkerEvent({
        event: 'source_snapshot_reconciliation_batch_finished',
        taskQueue,
        jobId: result.jobId,
        sourceSnapshotReconciliationsProcessed: result.sourceSnapshotReconciliationsProcessed,
        sourceSnapshotReconciliationsCompleted: result.sourceSnapshotReconciliationsCompleted,
        sourceSnapshotReconciliationsIncomplete: result.sourceSnapshotReconciliationsIncomplete,
        sourceSnapshotReconciliationsFailed: result.sourceSnapshotReconciliationsFailed,
        sourceSnapshotReconciliationsRetried: result.sourceSnapshotReconciliationsRetried,
        sourceSnapshotCoverageGaps: result.sourceSnapshotCoverageGaps
      })
    }
    if (result.retentionTombstonesQueued > 0) {
      emitWorkerEvent({
        event: 'source_retention_tombstones_queued',
        taskQueue,
        jobId: result.jobId,
        retentionTombstonesQueued: result.retentionTombstonesQueued
      })
    }
    if (result.productionAnalysisObjectsPurged > 0) {
      emitWorkerEvent({
        event: 'production_analysis_object_purge_finished',
        taskQueue,
        jobId: result.jobId,
        productionAnalysisObjectsPurged: result.productionAnalysisObjectsPurged
      })
    }
    if (result.deletionTombstonesProcessed > 0) {
      emitWorkerEvent({
        event: 'deletion_propagation_batch_finished',
        taskQueue,
        jobId: result.jobId,
        deletionTombstonesProcessed: result.deletionTombstonesProcessed,
        deletionObjectsAffected: result.deletionObjectsAffected,
        deletionOpportunitiesInvalidated: result.deletionOpportunitiesInvalidated,
        recomputationJobsQueued: result.recomputationJobsQueued
      })
    }
    emitWorkerEvent({
      event: 'source_maintenance_finished',
      taskQueue,
      jobId: result.jobId,
      workspacesScanned: result.quotaWorkspacesScanned + result.deletionWorkspacesScanned,
      quotaReservationsExpired: result.quotaReservationsExpired,
      quotaReservationsPurged: result.quotaReservationsPurged,
      productionWorkflowAdmissionsPurged: result.productionWorkflowAdmissionsPurged,
      productionAnalysisAdmissionsPurged: result.productionAnalysisAdmissionsPurged,
      sourceCollectionLeasesPurged: result.sourceCollectionLeasesPurged,
      productionAnalysisObjectsPurged: result.productionAnalysisObjectsPurged,
      sourceSnapshotReconciliationsProcessed: result.sourceSnapshotReconciliationsProcessed,
      sourceSnapshotReconciliationsCompleted: result.sourceSnapshotReconciliationsCompleted,
      sourceSnapshotReconciliationsIncomplete: result.sourceSnapshotReconciliationsIncomplete,
      sourceSnapshotReconciliationsFailed: result.sourceSnapshotReconciliationsFailed,
      sourceSnapshotReconciliationsRetried: result.sourceSnapshotReconciliationsRetried,
      sourceSnapshotCoverageGaps: result.sourceSnapshotCoverageGaps,
      campaignRefreshClaims: result.campaignRefreshClaims,
      campaignRefreshDispatched: result.campaignRefreshDispatched,
      campaignRefreshFailed: result.campaignRefreshFailed,
      campaignRefreshPolicyDenied: result.campaignRefreshPolicyDenied,
      campaignOrchestrationClaims: result.campaignOrchestrationClaims,
      campaignOrchestrationDispatched: result.campaignOrchestrationDispatched,
      campaignOrchestrationFailed: result.campaignOrchestrationFailed,
      campaignOrchestrationPolicyDenied: result.campaignOrchestrationPolicyDenied,
      campaignOrchestrationReconciled: result.campaignOrchestrationReconciled,
      retentionTombstonesQueued: result.retentionTombstonesQueued,
      deletionTombstonesProcessed: result.deletionTombstonesProcessed,
      deletionObjectsAffected: result.deletionObjectsAffected,
      deletionOpportunitiesInvalidated: result.deletionOpportunitiesInvalidated,
      recomputationJobsQueued: result.recomputationJobsQueued
    })
  }
} catch (error) {
  emitWorkerEvent({
    event: 'source_maintenance_failed',
    taskQueue,
    ...(validatedJobId ? { jobId: validatedJobId } : {}),
    failureCode: maintenanceSchedulerFailureCode(error, 'APPSEA_SOURCE_MAINTENANCE_FAILED')
  })
  process.exitCode = 1
} finally {
  await pool.end()
  if (maintenancePool) await maintenancePool.end()
  if (temporalConnection) await temporalConnection.close()
}
