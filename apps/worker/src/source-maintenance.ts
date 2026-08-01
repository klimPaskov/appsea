import { sourceMaintenanceInputSchema } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresDeletionPropagationRepository,
  PostgresProductionAnalysisAdmissionRepository,
  PostgresProductionWorkflowAdmissionRepository,
  PostgresSourceCollectionLeaseRepository,
  PostgresSourceQuotaRepository
} from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runSourceMaintenance } from './maintenance-runner'

const taskQueue = 'appsea-source-maintenance-v1'
const quotaBatchSize = Number(process.env.APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE ?? '1000')
const deletionBatchSize = Number(process.env.APPSEA_DELETION_BATCH_SIZE ?? '100')
const retentionBatchSize = Number(process.env.APPSEA_RETENTION_BATCH_SIZE ?? '100')
const quotaRetentionDays = Number(process.env.APPSEA_SOURCE_QUOTA_RETENTION_DAYS ?? '30')
const input = {
  jobId:
    process.env.APPSEA_SOURCE_MAINTENANCE_JOB_ID ??
    `maintenance:source:${Math.floor(Date.now() / 60_000)}`,
  occurredAt: new Date().toISOString(),
  quotaBatchSize,
  deletionBatchSize,
  retentionBatchSize,
  quotaRetentionDays,
  workspaceId: process.env.APPSEA_DELETION_WORKSPACE_ID ?? null
}
const validatedJobId = sourceMaintenanceInputSchema.safeParse(input).success
  ? sourceMaintenanceInputSchema.parse(input).jobId
  : undefined
const pool = createDatabasePool(databaseConfigFromEnv())

try {
  const quotaRepository = new PostgresSourceQuotaRepository(pool)
  const deletionRepository = new PostgresDeletionPropagationRepository(pool)
  const admissionRepository = new PostgresProductionWorkflowAdmissionRepository(pool)
  const analysisAdmissionRepository = new PostgresProductionAnalysisAdmissionRepository(pool)
  const leaseRepository = new PostgresSourceCollectionLeaseRepository(pool)
  const result = await runSourceMaintenance(input, {
    quota: quotaRepository,
    deletion: deletionRepository,
    admission: admissionRepository,
    analysisAdmission: analysisAdmissionRepository,
    leases: leaseRepository
  })
  emitWorkerEvent({
    event: 'source_quota_expiry_finished',
    taskQueue,
    jobId: result.jobId,
    quotaReservationsExpired: result.quotaReservationsExpired,
    quotaReservationsPurged: result.quotaReservationsPurged,
    productionWorkflowAdmissionsPurged: result.productionWorkflowAdmissionsPurged,
    productionAnalysisAdmissionsPurged: result.productionAnalysisAdmissionsPurged,
    sourceCollectionLeasesPurged: result.sourceCollectionLeasesPurged
  })
  if (result.retentionTombstonesQueued > 0) {
    emitWorkerEvent({
      event: 'source_retention_tombstones_queued',
      taskQueue,
      jobId: result.jobId,
      retentionTombstonesQueued: result.retentionTombstonesQueued
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
    retentionTombstonesQueued: result.retentionTombstonesQueued,
    deletionTombstonesProcessed: result.deletionTombstonesProcessed,
    deletionObjectsAffected: result.deletionObjectsAffected,
    deletionOpportunitiesInvalidated: result.deletionOpportunitiesInvalidated,
    recomputationJobsQueued: result.recomputationJobsQueued
  })
} catch {
  emitWorkerEvent({
    event: 'source_maintenance_failed',
    taskQueue,
    ...(validatedJobId ? { jobId: validatedJobId } : {}),
    failureCode: 'APPSEA_SOURCE_MAINTENANCE_FAILED'
  })
  process.exitCode = 1
} finally {
  await pool.end()
}
