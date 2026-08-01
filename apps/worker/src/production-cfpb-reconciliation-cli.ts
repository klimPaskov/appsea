import { contentHash, createDatabasePool, databaseConfigFromEnv, sha256 } from '@appsea/db'
import { sourceSnapshotReconciliationInputSchema } from '@appsea/contracts'
import {
  runProductionCfpbSnapshotReconciliation,
  defaultSourceSnapshotReconciliationDependencies
} from './production-cfpb-reconciliation'
import { emitWorkerEvent } from './observability'

const taskQueue = 'appsea-source-reconciliation-v1'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const workspaceId = requiredEnv('APPSEA_SOURCE_RECONCILIATION_WORKSPACE_ID')
const rawIdempotencyKey = requiredEnv('APPSEA_SOURCE_RECONCILIATION_IDEMPOTENCY_KEY')
const policyVersion = requiredEnv('APPSEA_SOURCE_RECONCILIATION_POLICY_VERSION')
const idempotencyKey = sha256(rawIdempotencyKey)
const reconciliationId = `reconciliation:source:${contentHash({
  workspaceId,
  sourceId: 'cfpb-consumer-complaints',
  idempotencyKey
}).slice(0, 32)}`
const input = sourceSnapshotReconciliationInputSchema.parse({
  workspaceId,
  reconciliationId,
  sourceId: 'cfpb-consumer-complaints',
  policyVersion,
  idempotencyKey,
  pageSize: Number(process.env.APPSEA_SOURCE_RECONCILIATION_PAGE_SIZE ?? '100'),
  maxRecords: Number(process.env.APPSEA_SOURCE_RECONCILIATION_MAX_RECORDS ?? '1000'),
  requestedAt:
    process.env.APPSEA_SOURCE_RECONCILIATION_REQUESTED_AT?.trim() ?? new Date().toISOString()
})

const pool = createDatabasePool(databaseConfigFromEnv())
try {
  const result = await runProductionCfpbSnapshotReconciliation(
    input,
    defaultSourceSnapshotReconciliationDependencies(pool)
  )
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
  console.log(
    JSON.stringify({
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
    })
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
