import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import {
  defaultSourceSnapshotReconciliationDependencies,
  runNextProductionCfpbSnapshotReconciliation
} from './production-cfpb-reconciliation'
import { emitWorkerEvent } from './observability'

const taskQueue = 'appsea-source-reconciliation-v1'

const workspaceId = process.env.APPSEA_SOURCE_RECONCILIATION_WORKSPACE_ID?.trim()
if (!workspaceId) throw new Error('APPSEA_SOURCE_RECONCILIATION_WORKSPACE_ID is required')

const pool = createDatabasePool(databaseConfigFromEnv())
try {
  const result = await runNextProductionCfpbSnapshotReconciliation(
    workspaceId,
    defaultSourceSnapshotReconciliationDependencies(pool)
  )
  if (result) {
    emitWorkerEvent({
      event: 'source_snapshot_reconciliation_finished',
      taskQueue,
      jobId: result.reconciliationId,
      state: result.state,
      attempt: result.attemptCount,
      snapshotPagesScanned: result.pagesScanned,
      snapshotSourceRecords: result.sourceRecordCount,
      snapshotDeletionsQueued: result.deletionCount,
      snapshotCoverageGaps: result.coverageGaps.length,
      ...(result.failureCode ? { failureCode: result.failureCode } : {})
    })
  }
  console.log(
    JSON.stringify(
      result
        ? {
            state: result.state,
            reconciliationId: result.reconciliationId,
            sourceId: result.sourceId,
            policyVersion: result.policyVersion,
            attemptCount: result.attemptCount,
            pagesScanned: result.pagesScanned,
            sourceRecordCount: result.sourceRecordCount,
            deletionCount: result.deletionCount,
            coverageGapCount: result.coverageGaps.length,
            warningCount: result.warnings.length
          }
        : { state: 'idle', workspaceId }
    )
  )
} catch {
  emitWorkerEvent({
    event: 'source_snapshot_reconciliation_failed',
    taskQueue,
    failureCode: 'APPSEA_SOURCE_SNAPSHOT_RECONCILIATION_FAILED'
  })
  process.exitCode = 1
} finally {
  await pool.end()
}
