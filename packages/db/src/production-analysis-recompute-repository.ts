import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  productionAnalysisRecomputeAlertObservationSchema,
  type ProductionAnalysisRecomputeAlertObservation
} from '@appsea/contracts'
import { withDatabaseTransaction, withWorkspaceTransaction } from './transaction'

export type ProductionAnalysisRecomputeState =
  'queued' | 'dispatching' | 'started' | 'blocked' | 'satisfied' | 'failed'

export type ProductionAnalysisRecomputeFailureCode =
  | 'analysis_not_ready'
  | 'seed_not_approved'
  | 'recompute_dispatch_failed'
  | 'analysis_already_repaired'

export const productionAnalysisRecomputeLimits = {
  staleClaimSeconds: 15 * 60,
  maxAttempts: 24
} as const

export interface ProductionAnalysisRecomputeRecord {
  workspaceId: string
  recomputeId: string
  opportunityId: string
  collectionRunId: string
  seedReviewId: string
  sourceTombstoneId: string | null
  correctionId: string | null
  analysisRunId: string
  idempotencyKey: string
  requestedAt: string
  state: ProductionAnalysisRecomputeState
  attemptCount: number
  workflowId: string | null
  failureCode: ProductionAnalysisRecomputeFailureCode | null
  failureSummary: string | null
  nextAttemptAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

interface RecomputeRow extends QueryResultRow {
  workspace_id: string
  recompute_id: string
  opportunity_id: string
  collection_run_id: string
  seed_review_id: string
  source_tombstone_id: string | null
  correction_id: string | null
  analysis_run_id: string
  idempotency_key: string
  requested_at: Date | string
  state: ProductionAnalysisRecomputeState
  attempt_count: number | string
  workflow_id: string | null
  failure_code: ProductionAnalysisRecomputeFailureCode | null
  failure_summary: string | null
  next_attempt_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
  updated_at: Date | string
}

interface RecomputeAlertRow extends QueryResultRow {
  state: string
  attempt_count: number | string
  requested_at: Date | string
  next_attempt_at: Date | string
  updated_at: Date | string
}

export class ProductionAnalysisRecomputeStateError extends Error {
  constructor(recomputeId: string, state: string) {
    super(`Production analysis recomputation ${recomputeId} is not dispatchable (${state})`)
    this.name = 'ProductionAnalysisRecomputeStateError'
  }
}

const recomputeColumns = `
  workspace_id, recompute_id, opportunity_id, collection_run_id, seed_review_id,
  source_tombstone_id, correction_id, analysis_run_id, idempotency_key, requested_at, state,
  attempt_count, workflow_id, failure_code, failure_summary, next_attempt_at,
  started_at, finished_at, updated_at`

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapRow(row: RecomputeRow): ProductionAnalysisRecomputeRecord {
  return {
    workspaceId: row.workspace_id,
    recomputeId: row.recompute_id,
    opportunityId: row.opportunity_id,
    collectionRunId: row.collection_run_id,
    seedReviewId: row.seed_review_id,
    sourceTombstoneId:
      row.source_tombstone_id === null
        ? null
        : appseaIdentifierSchema.parse(row.source_tombstone_id),
    correctionId:
      row.correction_id === null ? null : appseaIdentifierSchema.parse(row.correction_id),
    analysisRunId: row.analysis_run_id,
    idempotencyKey: row.idempotency_key,
    requestedAt: iso(row.requested_at)!,
    state: row.state,
    attemptCount: Number(row.attempt_count),
    workflowId: row.workflow_id,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    nextAttemptAt: iso(row.next_attempt_at)!,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    updatedAt: iso(row.updated_at)!
  }
}

export class PostgresProductionAnalysisRecomputeRepository {
  constructor(private readonly pool: Pool) {}

  listActiveWorkspaceIds(): Promise<string[]> {
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM appsea.list_active_workspaces_for_maintenance()`
        )
        return result.rows.map((row) => appseaIdentifierSchema.parse(row.workspace_id))
      },
      { readOnly: true }
    )
  }

  /**
   * Read only bounded state and timestamps through the maintenance-role
   * security-definer function. Identifiers, failure summaries, and lineage
   * fields deliberately remain outside this alert projection.
   */
  async listAlertObservations(
    workspaceId: string,
    limit = 50
  ): Promise<ProductionAnalysisRecomputeAlertObservation[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('recomputation alert list limit must be between 1 and 100')
    }
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<RecomputeAlertRow>(
          `SELECT state, attempt_count, requested_at, next_attempt_at, updated_at
             FROM appsea.list_production_analysis_recompute_alerts($1, $2)`,
          [parsedWorkspaceId, limit]
        )
        return result.rows.map((row) =>
          productionAnalysisRecomputeAlertObservationSchema.parse({
            state: row.state,
            attemptCount: Number(row.attempt_count),
            requestedAt: iso(row.requested_at),
            nextAttemptAt: iso(row.next_attempt_at),
            updatedAt: iso(row.updated_at)
          })
        )
      },
      { readOnly: true }
    )
  }

  /**
   * Claim due work, first closing jobs superseded by a newer active analysis.
   * A dispatching row is reclaimable after the stale lease window so a worker
   * crash cannot strand the repair queue. The deterministic Temporal workflow
   * identity makes a late start replay-safe.
   */
  async claimNext(workspaceId: string): Promise<ProductionAnalysisRecomputeRecord | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      await client.query(
        `UPDATE appsea.production_analysis_recompute_jobs job
            SET state = 'satisfied',
                failure_code = NULL,
                failure_summary = NULL,
                finished_at = COALESCE(job.finished_at, clock_timestamp()),
                updated_at = clock_timestamp()
          WHERE job.workspace_id = $1
            AND job.state IN ('queued', 'blocked')
            AND (
              EXISTS (
                SELECT 1
                  FROM appsea.opportunities opportunity
                 WHERE opportunity.workspace_id = job.workspace_id
                   AND opportunity.opportunity_id = job.opportunity_id
                   AND opportunity.availability_state = 'active'
              )
              OR EXISTS (
                SELECT 1
                  FROM appsea.research_analysis_run_outputs output
                  JOIN appsea.production_analysis_runs analysis
                    ON analysis.workspace_id = output.workspace_id
                   AND analysis.analysis_run_id = output.analysis_run_id
                 WHERE output.workspace_id = job.workspace_id
                   AND output.opportunity_id = job.opportunity_id
                   AND analysis.state = 'completed'
                   AND analysis.availability_state = 'active'
              )
            )`,
        [parsedWorkspaceId]
      )
      await client.query(
        `UPDATE appsea.production_analysis_recompute_jobs job
            SET state = 'blocked',
                failure_code = 'seed_not_approved',
                failure_summary = 'The reviewed repair seed must be approved before repair can start.',
                next_attempt_at = clock_timestamp(),
                finished_at = COALESCE(job.finished_at, clock_timestamp()),
                updated_at = clock_timestamp()
          WHERE job.workspace_id = $1
            AND job.state = 'queued'
            AND NOT EXISTS (
              SELECT 1
                FROM appsea.opportunity_seed_reviews seed
               WHERE seed.workspace_id = job.workspace_id
                 AND seed.seed_review_id = job.seed_review_id
                 AND seed.review_state = 'approved'
            )`,
        [parsedWorkspaceId]
      )
      await client.query(
        `UPDATE appsea.production_analysis_recompute_jobs job
            SET state = 'failed',
                failure_code = 'recompute_dispatch_failed',
                failure_summary = 'The recomputation dispatch claim expired after the retry limit.',
                finished_at = COALESCE(job.finished_at, clock_timestamp()),
                updated_at = clock_timestamp()
          WHERE job.workspace_id = $1
            AND job.state = 'dispatching'
            AND job.attempt_count >= $2
            AND job.updated_at <= clock_timestamp() - ($3::text || ' seconds')::interval`,
        [
          parsedWorkspaceId,
          productionAnalysisRecomputeLimits.maxAttempts,
          productionAnalysisRecomputeLimits.staleClaimSeconds
        ]
      )
      const claimed = await client.query<RecomputeRow>(
        `WITH candidate AS (
           SELECT workspace_id, recompute_id
             FROM appsea.production_analysis_recompute_jobs job
            WHERE job.workspace_id = $1
              AND job.next_attempt_at <= clock_timestamp()
              AND EXISTS (
                SELECT 1
                  FROM appsea.opportunities opportunity
                 WHERE opportunity.workspace_id = job.workspace_id
                   AND opportunity.opportunity_id = job.opportunity_id
                   AND opportunity.availability_state = 'invalidated'
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM appsea.research_analysis_run_outputs output
                  JOIN appsea.production_analysis_runs analysis
                    ON analysis.workspace_id = output.workspace_id
                   AND analysis.analysis_run_id = output.analysis_run_id
                 WHERE output.workspace_id = job.workspace_id
                   AND output.opportunity_id = job.opportunity_id
                   AND analysis.state = 'completed'
                   AND analysis.availability_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM appsea.production_analysis_runs running_analysis
                 WHERE running_analysis.workspace_id = job.workspace_id
                   AND running_analysis.collection_run_id = job.collection_run_id
                   AND running_analysis.seed_review_id = job.seed_review_id
                   AND running_analysis.state IN ('queued', 'running')
              )
              AND (
                job.state IN ('queued', 'blocked')
                OR (
                  job.state = 'dispatching'
                  AND job.updated_at <= clock_timestamp() - ($2::text || ' seconds')::interval
                  AND job.attempt_count < $3
                )
              )
              AND EXISTS (
                SELECT 1
                  FROM appsea.opportunity_seed_reviews seed
                 WHERE seed.workspace_id = job.workspace_id
                   AND seed.seed_review_id = job.seed_review_id
                   AND seed.review_state = 'approved'
              )
            ORDER BY job.next_attempt_at, job.recompute_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE appsea.production_analysis_recompute_jobs job
            SET state = 'dispatching',
                attempt_count = job.attempt_count + 1,
                failure_code = NULL,
                failure_summary = NULL,
                finished_at = NULL,
                updated_at = clock_timestamp()
           FROM candidate
          WHERE job.workspace_id = candidate.workspace_id
            AND job.recompute_id = candidate.recompute_id
         RETURNING ${recomputeColumns}`,
        [
          parsedWorkspaceId,
          productionAnalysisRecomputeLimits.staleClaimSeconds,
          productionAnalysisRecomputeLimits.maxAttempts
        ]
      )
      return claimed.rows[0] ? mapRow(claimed.rows[0]) : null
    })
  }

  async markStarted(
    workspaceId: string,
    recomputeId: string,
    workflowId: string
  ): Promise<ProductionAnalysisRecomputeRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRecomputeId = appseaIdentifierSchema.parse(recomputeId)
    const parsedWorkflowId = appseaIdentifierSchema.parse(workflowId)
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<RecomputeRow>(
        `UPDATE appsea.production_analysis_recompute_jobs
            SET state = 'started', workflow_id = $3,
                started_at = COALESCE(started_at, clock_timestamp()),
                finished_at = NULL, failure_code = NULL, failure_summary = NULL,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND recompute_id = $2 AND state = 'dispatching'
        RETURNING ${recomputeColumns}`,
        [parsedWorkspaceId, parsedRecomputeId, parsedWorkflowId]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedRecomputeId)
      if (!existing)
        throw new Error(`Production analysis recomputation ${parsedRecomputeId} was not found`)
      if (existing.state === 'started' && existing.workflowId === parsedWorkflowId) return existing
      throw new ProductionAnalysisRecomputeStateError(parsedRecomputeId, existing.state)
    })
  }

  async reschedule(
    workspaceId: string,
    recomputeId: string,
    failureCode: ProductionAnalysisRecomputeFailureCode,
    failureSummary: string,
    delaySeconds: number
  ): Promise<ProductionAnalysisRecomputeRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRecomputeId = appseaIdentifierSchema.parse(recomputeId)
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 86_400) {
      throw new Error('recomputation retry delay is outside the supported range')
    }
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('recomputation failure summary is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<RecomputeRow>(
        `UPDATE appsea.production_analysis_recompute_jobs
            SET state = CASE
                  WHEN $3 = 'seed_not_approved' THEN 'blocked'
                  WHEN attempt_count >= 24 THEN 'failed'
                  ELSE 'queued'
                END,
                failure_code = $3,
                failure_summary = $4,
                next_attempt_at = CASE
                  WHEN $3 = 'seed_not_approved' THEN clock_timestamp()
                  WHEN attempt_count >= 24 THEN clock_timestamp()
                  ELSE clock_timestamp() + ($5::text || ' seconds')::interval
                END,
                finished_at = CASE
                  WHEN $3 = 'seed_not_approved' OR attempt_count >= 24 THEN clock_timestamp()
                  ELSE NULL
                END,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND recompute_id = $2 AND state = 'dispatching'
        RETURNING ${recomputeColumns}`,
        [parsedWorkspaceId, parsedRecomputeId, failureCode, failureSummary, delaySeconds]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedRecomputeId)
      if (!existing)
        throw new Error(`Production analysis recomputation ${parsedRecomputeId} was not found`)
      if (
        existing.state === 'queued' ||
        existing.state === 'blocked' ||
        existing.state === 'failed'
      ) {
        return existing
      }
      throw new ProductionAnalysisRecomputeStateError(parsedRecomputeId, existing.state)
    })
  }

  async fail(
    workspaceId: string,
    recomputeId: string,
    failureCode: ProductionAnalysisRecomputeFailureCode,
    failureSummary: string
  ): Promise<ProductionAnalysisRecomputeRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRecomputeId = appseaIdentifierSchema.parse(recomputeId)
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('recomputation failure summary is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<RecomputeRow>(
        `UPDATE appsea.production_analysis_recompute_jobs
            SET state = 'failed', failure_code = $3, failure_summary = $4,
                next_attempt_at = clock_timestamp(), finished_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND recompute_id = $2 AND state = 'dispatching'
        RETURNING ${recomputeColumns}`,
        [parsedWorkspaceId, parsedRecomputeId, failureCode, failureSummary]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedRecomputeId)
      if (!existing)
        throw new Error(`Production analysis recomputation ${parsedRecomputeId} was not found`)
      if (existing.state === 'failed' && existing.failureCode === failureCode) return existing
      throw new ProductionAnalysisRecomputeStateError(parsedRecomputeId, existing.state)
    })
  }

  async read(
    workspaceId: string,
    recomputeId: string
  ): Promise<ProductionAnalysisRecomputeRecord | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRecomputeId = appseaIdentifierSchema.parse(recomputeId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      (client) => this.readInTransaction(client, parsedWorkspaceId, parsedRecomputeId),
      { readOnly: true }
    )
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    recomputeId: string
  ): Promise<ProductionAnalysisRecomputeRecord | null> {
    const result = await client.query<RecomputeRow>(
      `SELECT ${recomputeColumns}
         FROM appsea.production_analysis_recompute_jobs
        WHERE workspace_id = $1 AND recompute_id = $2`,
      [workspaceId, recomputeId]
    )
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }
}
