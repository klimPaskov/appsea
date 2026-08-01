import {
  sourceQuotaReconciliationResolveInputSchema,
  sourceQuotaReconciliationListQuerySchema
} from '@appsea/contracts'
import { createDatabasePool, PostgresSourceQuotaRepository } from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { maintenanceDatabaseConfigFromEnv } from './maintenance-scheduler'

const taskQueue = 'appsea-source-maintenance-v1'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const workspaceId = requiredEnv('APPSEA_SOURCE_QUOTA_RECONCILIATION_WORKSPACE_ID')
const limit = sourceQuotaReconciliationListQuerySchema.parse({
  limit: Number(process.env.APPSEA_SOURCE_QUOTA_RECONCILIATION_LIMIT ?? '50')
}).limit
const reservationId = process.env.APPSEA_SOURCE_QUOTA_RECONCILIATION_RESERVATION_ID?.trim()
const pool = createDatabasePool(maintenanceDatabaseConfigFromEnv())

try {
  const repository = new PostgresSourceQuotaRepository(pool)
  if (!reservationId) {
    const cases = await repository.listReconciliationCases(workspaceId, { limit })
    console.log(
      JSON.stringify({
        workspaceId,
        openCaseCount: cases.length,
        cases: cases.map((caseRow) => ({
          reservationId: caseRow.reservationId,
          sourceId: caseRow.sourceId,
          policyVersion: caseRow.policyVersion,
          runId: caseRow.runId,
          requestedRecords: caseRow.requestedRecords,
          requestedCostMicros: caseRow.requestedCostMicros,
          actualRecords: caseRow.actualRecords,
          actualCostMicros: caseRow.actualCostMicros,
          firstSeenAt: caseRow.firstSeenAt,
          lastSeenAt: caseRow.lastSeenAt
        }))
      })
    )
  } else {
    const resolutionCode = requiredEnv('APPSEA_SOURCE_QUOTA_RECONCILIATION_RESOLUTION_CODE')
    const actorId = requiredEnv('APPSEA_SOURCE_QUOTA_RECONCILIATION_ACTOR_ID')
    const linkedRunId = process.env.APPSEA_SOURCE_QUOTA_RECONCILIATION_LINKED_RUN_ID?.trim() ?? null
    const resolved = await repository.resolveReconciliationCase(
      sourceQuotaReconciliationResolveInputSchema.parse({
        workspaceId,
        reservationId,
        resolutionCode,
        linkedRunId,
        actorId
      })
    )
    console.log(
      JSON.stringify({
        workspaceId,
        reservationId: resolved.reservationId,
        state: resolved.state,
        resolutionCode: resolved.resolutionCode,
        linkedRunId: resolved.linkedRunId,
        resolutionActorId: resolved.resolutionActorId,
        resolvedAt: resolved.resolvedAt
      })
    )
  }
  emitWorkerEvent({
    event: 'source_quota_reconciliation_finished',
    taskQueue,
    jobId: `maintenance:quota-reconciliation:${workspaceId}`
  })
} catch {
  emitWorkerEvent({
    event: 'source_quota_reconciliation_failed',
    taskQueue,
    failureCode: 'APPSEA_SOURCE_QUOTA_RECONCILIATION_FAILED'
  })
  process.exitCode = 1
} finally {
  await pool.end()
}
