import type { ObjectStore } from '@appsea/object-store'
import {
  objectReferenceSchema,
  appseaIdentifierSchema,
  type ObjectReference
} from '@appsea/contracts'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { withWorkspaceTransaction } from './transaction'

export const productionAnalysisObjectPurgeLimits = {
  maxBatchSize: 1_000,
  staleClaimSeconds: 15 * 60,
  maxAttempts: 5
} as const

export type ProductionAnalysisObjectPurgeState =
  'pending' | 'processing' | 'marked' | 'completed' | 'failed'

interface ObjectPurgeRow extends QueryResultRow {
  workspace_id: string
  purge_id: string
  analysis_run_id: string
  object_uri: string
  object_kind: string
  object_ref: unknown
  authorization: 'retention-expired'
  requested_at: Date | string
  eligible_at: Date | string
  state: ProductionAnalysisObjectPurgeState
  attempt_count: number | string
  processing_started_at: Date | string | null
  completed_at: Date | string | null
  next_attempt_at: Date | string
  failure_code: string | null
  failure_summary: string | null
}

export interface ProductionAnalysisObjectPurgeRecord {
  workspaceId: string
  purgeId: string
  analysisRunId: string
  objectUri: string
  objectKind: ObjectReference['kind']
  objectReference: ObjectReference
  authorization: 'retention-expired'
  requestedAt: string
  eligibleAt: string
  state: ProductionAnalysisObjectPurgeState
  attemptCount: number
  processingStartedAt: string | null
  completedAt: string | null
  nextAttemptAt: string
  failureCode: string | null
  failureSummary: string | null
}

export interface ProductionAnalysisObjectPurgeResult {
  record: ProductionAnalysisObjectPurgeRecord
  purged: boolean
}

const columns = `
  workspace_id, purge_id, analysis_run_id, object_uri, object_kind, object_ref,
  authorization, requested_at, eligible_at, state, attempt_count,
  processing_started_at, completed_at, next_attempt_at, failure_code, failure_summary`

function identifier(value: string, label: string): string {
  try {
    return appseaIdentifierSchema.parse(value)
  } catch {
    throw new Error(`${label} is not a persistence-safe identifier`)
  }
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp`)
  return parsed.toISOString()
}

function mapRow(row: ObjectPurgeRow): ProductionAnalysisObjectPurgeRecord {
  const objectReference = objectReferenceSchema.parse(row.object_ref)
  if (objectReference.uri !== row.object_uri || objectReference.kind !== row.object_kind) {
    throw new Error('Object purge reference does not match its immutable URI metadata')
  }
  return {
    workspaceId: row.workspace_id,
    purgeId: row.purge_id,
    analysisRunId: row.analysis_run_id,
    objectUri: row.object_uri,
    objectKind: objectReference.kind,
    objectReference,
    authorization: row.authorization,
    requestedAt: timestamp(row.requested_at, 'requestedAt')!,
    eligibleAt: timestamp(row.eligible_at, 'eligibleAt')!,
    state: row.state,
    attemptCount: Number(row.attempt_count),
    processingStartedAt: timestamp(row.processing_started_at, 'processingStartedAt'),
    completedAt: timestamp(row.completed_at, 'completedAt'),
    nextAttemptAt: timestamp(row.next_attempt_at, 'nextAttemptAt')!,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary
  }
}

function validateTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp`)
  return parsed.toISOString()
}

function failureSummary(error: unknown): string {
  // Never persist provider or filesystem exception text. The job remains
  // inspectable through a fixed code and bounded operator-facing message.
  return error instanceof Error && error.name === 'ObjectStoreError'
    ? 'The object store rejected a purge attempt; retry or inspect the adapter.'
    : 'The object store purge attempt failed; retry or inspect the adapter.'
}

export class PostgresProductionAnalysisObjectPurgeRepository {
  constructor(
    private readonly pool: Pool,
    private readonly objectStore: ObjectStore
  ) {}

  /** Claim one due object purge without waiting on another worker. */
  async claimNext(
    workspaceId: string,
    now: string
  ): Promise<ProductionAnalysisObjectPurgeRecord | null> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    // Validate the caller's correlation timestamp, but use PostgreSQL's clock
    // for eligibility and stale-claim decisions. Retention must not be
    // bypassable by an operator-supplied future timestamp.
    validateTimestamp(now, 'now')
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const result = await client.query<ObjectPurgeRow>(
        `WITH candidate AS (
           SELECT workspace_id, purge_id
             FROM appsea.production_analysis_object_purge_jobs
            WHERE workspace_id = $1
              AND (
                (
                  state IN ('pending', 'marked', 'failed')
                  AND next_attempt_at <= clock_timestamp()
                  AND (state <> 'failed' OR attempt_count < $2)
                )
                OR (
                  state = 'processing'
                  AND attempt_count <= $2
                  AND processing_started_at IS NOT NULL
                  AND processing_started_at <= clock_timestamp() - ($3::text || ' seconds')::interval
                )
              )
            ORDER BY next_attempt_at, requested_at, purge_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE appsea.production_analysis_object_purge_jobs job
            SET state = 'processing',
                attempt_count = job.attempt_count + 1,
                processing_started_at = clock_timestamp(),
                failure_code = NULL,
                failure_summary = NULL
           FROM candidate
          WHERE job.workspace_id = candidate.workspace_id
            AND job.purge_id = candidate.purge_id
         RETURNING ${columns}`,
        [
          parsedWorkspaceId,
          productionAnalysisObjectPurgeLimits.maxAttempts,
          productionAnalysisObjectPurgeLimits.staleClaimSeconds
        ]
      )
      return result.rows[0] ? mapRow(result.rows[0]) : null
    })
  }

  /** Complete a claimed purge. Repeating completion is an idempotent no-op. */
  async complete(
    workspaceId: string,
    purgeId: string,
    completedAt: string
  ): Promise<ProductionAnalysisObjectPurgeRecord> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedPurgeId = identifier(purgeId, 'purgeId')
    const parsedCompletedAt = validateTimestamp(completedAt, 'completedAt')
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<ObjectPurgeRow>(
        `UPDATE appsea.production_analysis_object_purge_jobs
            SET state = 'completed',
                processing_started_at = NULL,
                completed_at = COALESCE(completed_at, $3::timestamptz),
                next_attempt_at = $3::timestamptz,
                failure_code = NULL,
                failure_summary = NULL
          WHERE workspace_id = $1
            AND purge_id = $2
            AND state = 'processing'
        RETURNING ${columns}`,
        [parsedWorkspaceId, parsedPurgeId, parsedCompletedAt]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedPurgeId)
      if (!existing) throw new Error(`Object purge job ${parsedPurgeId} was not found`)
      if (existing.state === 'completed') return existing
      throw new Error(`Object purge job ${parsedPurgeId} is not processing`)
    })
  }

  /** Persist that the object is tombstoned but its retention window is not due. */
  async markWaiting(
    workspaceId: string,
    purgeId: string,
    nextAttemptAt: string
  ): Promise<ProductionAnalysisObjectPurgeRecord> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedPurgeId = identifier(purgeId, 'purgeId')
    const parsedNextAttemptAt = validateTimestamp(nextAttemptAt, 'nextAttemptAt')
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<ObjectPurgeRow>(
        `UPDATE appsea.production_analysis_object_purge_jobs
            SET state = 'marked',
                processing_started_at = NULL,
                next_attempt_at = $3::timestamptz,
                failure_code = NULL,
                failure_summary = NULL
          WHERE workspace_id = $1
            AND purge_id = $2
            AND state = 'processing'
        RETURNING ${columns}`,
        [parsedWorkspaceId, parsedPurgeId, parsedNextAttemptAt]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedPurgeId)
      if (!existing) throw new Error(`Object purge job ${parsedPurgeId} was not found`)
      if (existing.state === 'marked') return existing
      throw new Error(`Object purge job ${parsedPurgeId} is not processing`)
    })
  }

  /** Mark a failure while leaving bounded retry metadata visible. */
  async fail(
    workspaceId: string,
    purgeId: string,
    nextAttemptAt: string
  ): Promise<ProductionAnalysisObjectPurgeRecord> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedPurgeId = identifier(purgeId, 'purgeId')
    const parsedNextAttemptAt = validateTimestamp(nextAttemptAt, 'nextAttemptAt')
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<ObjectPurgeRow>(
        `UPDATE appsea.production_analysis_object_purge_jobs
            SET state = 'failed',
                processing_started_at = NULL,
                next_attempt_at = $3::timestamptz,
                failure_code = 'object_store_purge_failed',
                failure_summary = 'The object store purge attempt failed; retry is bounded.'
          WHERE workspace_id = $1
            AND purge_id = $2
            AND state = 'processing'
        RETURNING ${columns}`,
        [parsedWorkspaceId, parsedPurgeId, parsedNextAttemptAt]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedPurgeId)
      if (!existing) throw new Error(`Object purge job ${parsedPurgeId} was not found`)
      if (existing.state === 'failed') return existing
      throw new Error(`Object purge job ${parsedPurgeId} is not processing`)
    })
  }

  /** Run one external mark/purge pass with a durable claim boundary. */
  async processNext(
    workspaceId: string,
    now: string
  ): Promise<ProductionAnalysisObjectPurgeResult | null> {
    const parsedNow = validateTimestamp(now, 'now')
    const claimed = await this.claimNext(workspaceId, parsedNow)
    if (!claimed) return null
    const serverObservedAt = claimed.processingStartedAt

    try {
      if (!serverObservedAt) throw new Error('Object purge claim has no server timestamp')
      const head = await this.objectStore.head(claimed.workspaceId, claimed.objectReference)
      if (head?.deletionState !== 'deleted') {
        try {
          await this.objectStore.markDeleted(
            claimed.workspaceId,
            claimed.objectReference,
            serverObservedAt,
            'Source deletion retention purge'
          )
        } catch (error) {
          // A concurrent cleanup may have removed the object after the head
          // read. The subsequent purge is still idempotent and removes any
          // orphaned local files, so only non-not-found failures retry.
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'not-found') {
            throw error
          }
        }
      }

      if (Date.parse(claimed.eligibleAt) > Date.parse(serverObservedAt)) {
        const waiting = await this.markWaiting(
          claimed.workspaceId,
          claimed.purgeId,
          claimed.eligibleAt
        )
        return { record: waiting, purged: false }
      }

      await this.objectStore.purge(claimed.workspaceId, {
        reference: claimed.objectReference,
        authorization: claimed.authorization,
        now: serverObservedAt
      })
      const completed = await this.complete(claimed.workspaceId, claimed.purgeId, serverObservedAt)
      return { record: completed, purged: true }
    } catch (error) {
      const retryAt = new Date(
        Date.parse(serverObservedAt ?? claimed.requestedAt) +
          Math.min(2 ** claimed.attemptCount, 60) * 1_000
      ).toISOString()
      await this.fail(claimed.workspaceId, claimed.purgeId, retryAt)
      throw new Error(failureSummary(error), { cause: error })
    }
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    purgeId: string
  ): Promise<ProductionAnalysisObjectPurgeRecord | null> {
    const result = await client.query<ObjectPurgeRow>(
      `SELECT ${columns}
         FROM appsea.production_analysis_object_purge_jobs
        WHERE workspace_id = $1 AND purge_id = $2`,
      [workspaceId, purgeId]
    )
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }
}
