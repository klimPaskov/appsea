import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { withDatabaseTransaction, withWorkspaceTransaction } from './transaction'

export type DeletionTombstoneState = 'pending' | 'processing' | 'completed' | 'failed'

interface DeletionTombstoneRow extends QueryResultRow {
  workspace_id: string
  tombstone_id: string
  source_id: string
  source_record_id: string
  reason: string
  state: DeletionTombstoneState
  received_at: Date | string
  processing_started_at: Date | string | null
  completed_at: Date | string | null
  affected_object_count: number | string
  failure_code: string | null
  failure_summary: string | null
}

export interface DeletionTombstoneRecord {
  workspaceId: string
  tombstoneId: string
  sourceId: string
  sourceRecordId: string
  reason: string
  state: DeletionTombstoneState
  receivedAt: string
  processingStartedAt: string | null
  completedAt: string | null
  affectedObjectCount: number
  failureCode: string | null
  failureSummary: string | null
}

export interface DeletionPropagationResult {
  tombstone: DeletionTombstoneRecord
  sourceItemCount: number
  evidenceCount: number
  analysisCount: number
  opportunityCount: number
  recomputationJobsQueued: number
  reportCount: number
  planCount: number
  affectedObjectCount: number
}

export interface DeletionTombstoneInput {
  workspaceId: string
  tombstoneId: string
  sourceId: string
  sourceRecordId: string
  reason: string
  receivedAt: string
}

export class DeletionTombstoneStateError extends Error {
  constructor(tombstoneId: string, state: string) {
    super(`Deletion tombstone ${tombstoneId} is not in a processable state (${state})`)
    this.name = 'DeletionTombstoneStateError'
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function rowCount(result: { rowCount: number | null; rows: unknown[] }): number {
  return result.rowCount ?? result.rows.length
}

function mapTombstone(row: DeletionTombstoneRow): DeletionTombstoneRecord {
  return {
    workspaceId: row.workspace_id,
    tombstoneId: row.tombstone_id,
    sourceId: row.source_id,
    sourceRecordId: row.source_record_id,
    reason: row.reason,
    state: row.state,
    receivedAt: iso(row.received_at)!,
    processingStartedAt: iso(row.processing_started_at),
    completedAt: iso(row.completed_at),
    affectedObjectCount: Number(row.affected_object_count),
    failureCode: row.failure_code,
    failureSummary: row.failure_summary
  }
}

const tombstoneColumns = `
  workspace_id, tombstone_id, source_id, source_record_id, reason, state,
  received_at, processing_started_at, completed_at, affected_object_count,
  failure_code, failure_summary`

export class PostgresDeletionPropagationRepository {
  constructor(private readonly pool: Pool) {}

  /** Queue bounded policy-derived retention tombstones for later propagation. */
  async enqueueExpired(
    workspaceId: string,
    occurredAt: string,
    batchSize: number
  ): Promise<number> {
    const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error('retention batch size is outside the supported range')
    }
    return withWorkspaceTransaction(
      this.pool,
      validatedWorkspaceId,
      async (client) => {
        const result = await client.query<{ enqueue_expired_source_tombstones: number | string }>(
          `SELECT appsea.enqueue_expired_source_tombstones($1, $2::timestamptz, $3)`,
          [validatedWorkspaceId, occurredAt, batchSize]
        )
        return Number(result.rows[0]?.enqueue_expired_source_tombstones ?? 0)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  /** Persist a connector deletion event exactly once before processing it. */
  async enqueue(input: DeletionTombstoneInput): Promise<DeletionTombstoneRecord> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const tombstoneId = appseaIdentifierSchema.parse(input.tombstoneId)
    const sourceId = appseaIdentifierSchema.parse(input.sourceId)
    if (input.sourceRecordId.length < 1 || input.sourceRecordId.length > 240) {
      throw new Error('sourceRecordId must contain between 1 and 240 characters')
    }
    if (input.reason.length < 1 || input.reason.length > 240) {
      throw new Error('reason must contain between 1 and 240 characters')
    }
    return withWorkspaceTransaction(this.pool, workspaceId, async (client) => {
      const inserted = await client.query<DeletionTombstoneRow>(
        `INSERT INTO appsea.deletion_tombstones
           (workspace_id, tombstone_id, source_id, source_record_id, reason, state, received_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6::timestamptz)
         ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING
         RETURNING ${tombstoneColumns}`,
        [workspaceId, tombstoneId, sourceId, input.sourceRecordId, input.reason, input.receivedAt]
      )
      if (inserted.rows[0]) return mapTombstone(inserted.rows[0])
      const existingByNaturalKey = await this.readTombstoneByNaturalKeyInTransaction(
        client,
        workspaceId,
        sourceId,
        input.sourceRecordId,
        input.reason
      )
      if (existingByNaturalKey) {
        if (existingByNaturalKey.tombstoneId !== tombstoneId) {
          throw new Error('Deletion tombstone idempotency key conflicts with another tombstone')
        }
        return existingByNaturalKey
      }
      const existingById = await this.readTombstoneInTransaction(client, workspaceId, tombstoneId)
      if (existingById) {
        throw new Error('Deletion tombstone identifier conflicts with another event')
      }
      throw new Error('Deletion tombstone insert was not persisted')
    })
  }

  async listActiveWorkspaceIds(): Promise<string[]> {
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id
             FROM appsea.list_active_workspaces_for_maintenance()`
        )
        return result.rows.map((row) => appseaIdentifierSchema.parse(row.workspace_id))
      },
      { readOnly: true }
    )
  }

  /** Claim the oldest pending tombstone without waiting on another worker. */
  async claimNext(workspaceId: string): Promise<DeletionTombstoneRecord | null> {
    const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, (client) =>
      this.claimNextInTransaction(client, validatedWorkspaceId)
    )
  }

  /**
   * Claim and propagate one tombstone. The claim is committed separately so a
   * failure can be durably marked failed without rolling back the claim.
   */
  async processNext(workspaceId: string): Promise<DeletionPropagationResult | null> {
    const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const claimed = await this.claimNext(validatedWorkspaceId)
    if (!claimed) return null

    try {
      return await withWorkspaceTransaction(this.pool, validatedWorkspaceId, async (client) => {
        const counts = await this.propagateInTransaction(client, claimed)
        const tombstone = await this.completeInTransaction(
          client,
          validatedWorkspaceId,
          claimed.tombstoneId,
          counts.affectedObjectCount
        )
        return { tombstone, ...counts }
      })
    } catch (error) {
      // Persist the terminal failure in a separate transaction. The caller
      // still receives the original propagation error for retry/alerting.
      await this.fail(validatedWorkspaceId, claimed.tombstoneId)
      throw error
    }
  }

  /** Complete a claimed tombstone; repeating the same completion is a no-op. */
  async complete(
    workspaceId: string,
    tombstoneId: string,
    affectedObjectCount: number
  ): Promise<DeletionTombstoneRecord> {
    const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const validatedTombstoneId = appseaIdentifierSchema.parse(tombstoneId)
    if (!Number.isSafeInteger(affectedObjectCount) || affectedObjectCount < 0) {
      throw new Error('affectedObjectCount must be a non-negative integer')
    }
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, (client) =>
      this.completeInTransaction(
        client,
        validatedWorkspaceId,
        validatedTombstoneId,
        affectedObjectCount
      )
    )
  }

  /** Mark a claimed tombstone failed; repeating a failure is a no-op. */
  async fail(workspaceId: string, tombstoneId: string): Promise<DeletionTombstoneRecord> {
    const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const validatedTombstoneId = appseaIdentifierSchema.parse(tombstoneId)
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, async (client) => {
      const updated = await client.query<DeletionTombstoneRow>(
        `UPDATE appsea.deletion_tombstones
            SET state = 'failed',
                failure_code = 'deletion_propagation_failed',
                failure_summary = 'Deletion propagation failed before completion'
          WHERE workspace_id = $1
            AND tombstone_id = $2
            AND state = 'processing'
        RETURNING ${tombstoneColumns}`,
        [validatedWorkspaceId, validatedTombstoneId]
      )
      if (updated.rows[0]) return mapTombstone(updated.rows[0])

      const existing = await this.readTombstoneInTransaction(
        client,
        validatedWorkspaceId,
        validatedTombstoneId
      )
      if (!existing) throw new Error(`Deletion tombstone ${validatedTombstoneId} was not found`)
      if (existing.state === 'failed') return existing
      throw new DeletionTombstoneStateError(validatedTombstoneId, existing.state)
    })
  }

  // Explicit names make worker adapters self-documenting while retaining the
  // concise methods used by callers and tests.
  claimNextPending(workspaceId: string): Promise<DeletionTombstoneRecord | null> {
    return this.claimNext(workspaceId)
  }

  propagateNext(workspaceId: string): Promise<DeletionPropagationResult | null> {
    return this.processNext(workspaceId)
  }

  private async claimNextInTransaction(
    client: PoolClient,
    workspaceId: string
  ): Promise<DeletionTombstoneRecord | null> {
    const claimed = await client.query<DeletionTombstoneRow>(
      `WITH candidate AS (
         SELECT workspace_id, tombstone_id
           FROM appsea.deletion_tombstones
          WHERE workspace_id = $1
            AND (
              state = 'pending'
              OR (
                state = 'processing'
                AND processing_started_at IS NOT NULL
                AND processing_started_at <= clock_timestamp() - interval '15 minutes'
              )
            )
          ORDER BY received_at, tombstone_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE appsea.deletion_tombstones tombstone
          SET state = 'processing',
              processing_started_at = clock_timestamp(),
              failure_code = NULL,
              failure_summary = NULL
         FROM candidate
        WHERE tombstone.workspace_id = candidate.workspace_id
          AND tombstone.tombstone_id = candidate.tombstone_id
       RETURNING ${tombstoneColumns}`,
      [workspaceId]
    )
    return claimed.rows[0] ? mapTombstone(claimed.rows[0]) : null
  }

  private async readTombstoneInTransaction(
    client: PoolClient,
    workspaceId: string,
    tombstoneId: string
  ): Promise<DeletionTombstoneRecord | null> {
    const result = await client.query<DeletionTombstoneRow>(
      `SELECT ${tombstoneColumns}
         FROM appsea.deletion_tombstones
        WHERE workspace_id = $1 AND tombstone_id = $2`,
      [workspaceId, tombstoneId]
    )
    return result.rows[0] ? mapTombstone(result.rows[0]) : null
  }

  private async readTombstoneByNaturalKeyInTransaction(
    client: PoolClient,
    workspaceId: string,
    sourceId: string,
    sourceRecordId: string,
    reason: string
  ): Promise<DeletionTombstoneRecord | null> {
    const result = await client.query<DeletionTombstoneRow>(
      `SELECT ${tombstoneColumns}
         FROM appsea.deletion_tombstones
        WHERE workspace_id = $1
          AND source_id = $2
          AND source_record_id = $3
          AND reason = $4`,
      [workspaceId, sourceId, sourceRecordId, reason]
    )
    return result.rows[0] ? mapTombstone(result.rows[0]) : null
  }

  private async completeInTransaction(
    client: PoolClient,
    workspaceId: string,
    tombstoneId: string,
    affectedObjectCount: number
  ): Promise<DeletionTombstoneRecord> {
    const updated = await client.query<DeletionTombstoneRow>(
      `UPDATE appsea.deletion_tombstones
          SET state = 'completed',
              completed_at = COALESCE(completed_at, clock_timestamp()),
              affected_object_count = $3,
              failure_code = NULL,
              failure_summary = NULL
        WHERE workspace_id = $1
          AND tombstone_id = $2
          AND state = 'processing'
      RETURNING ${tombstoneColumns}`,
      [workspaceId, tombstoneId, affectedObjectCount]
    )
    if (updated.rows[0]) return mapTombstone(updated.rows[0])

    const existing = await this.readTombstoneInTransaction(client, workspaceId, tombstoneId)
    if (!existing) throw new Error(`Deletion tombstone ${tombstoneId} was not found`)
    if (existing.state === 'completed') {
      if (existing.affectedObjectCount !== affectedObjectCount) {
        throw new DeletionTombstoneStateError(tombstoneId, existing.state)
      }
      return existing
    }
    throw new DeletionTombstoneStateError(tombstoneId, existing.state)
  }

  private async propagateInTransaction(
    client: PoolClient,
    tombstone: DeletionTombstoneRecord
  ): Promise<Omit<DeletionPropagationResult, 'tombstone'>> {
    const sourceItems = await client.query(
      `UPDATE appsea.source_items source_item
          SET raw_object_ref = NULL,
              deletion_state = 'source_deleted',
              deletion_tombstone_id = $4
        WHERE source_item.workspace_id = $1
          AND source_item.source_id = $2
          AND source_item.source_record_id = $3
          AND source_item.deletion_state <> 'source_deleted'
          AND (
            source_item.deletion_tombstone_id IS NULL
            OR source_item.deletion_tombstone_id = $4
          )
        -- Raw objects are policy-controlled and must not survive a completed
        -- source deletion even when object storage is not yet provisioned.
      RETURNING source_item_id`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    const evidence = await client.query(
      `UPDATE appsea.evidence_records evidence
          SET normalized_text = '[Content removed under source deletion policy]',
              redacted = true,
              deletion_state = 'source_deleted',
              deletion_tombstone_id = $4
        WHERE evidence.workspace_id = $1
          AND evidence.deletion_state <> 'source_deleted'
          AND (evidence.deletion_tombstone_id IS NULL OR evidence.deletion_tombstone_id = $4)
          AND EXISTS (
            SELECT 1
              FROM appsea.source_items source_item
             WHERE source_item.workspace_id = evidence.workspace_id
               AND source_item.source_item_id = evidence.source_item_id
               AND source_item.source_id = $2
               AND source_item.source_record_id = $3
          )
      RETURNING evidence_id`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    const analyses = await client.query(
      `UPDATE appsea.production_analysis_runs analysis
          SET availability_state = 'invalidated',
              invalidated_at = clock_timestamp(),
              invalidation_reason = 'Source deletion tombstone ' || $4
        WHERE analysis.workspace_id = $1
          AND analysis.availability_state = 'active'
          AND EXISTS (
            SELECT 1
              FROM appsea.research_analysis_run_evidence analysis_evidence
              JOIN appsea.source_items source_item
                ON source_item.workspace_id = analysis_evidence.workspace_id
               AND source_item.source_item_id = analysis_evidence.source_item_id
             WHERE analysis_evidence.workspace_id = analysis.workspace_id
               AND analysis_evidence.analysis_run_id = analysis.analysis_run_id
               AND source_item.source_id = $2
               AND source_item.source_record_id = $3
          )
      RETURNING analysis_run_id`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    const opportunities = await client.query<
      QueryResultRow & {
        opportunity_count: number | string
        recomputation_jobs_queued: number | string
      }
    >(
      `WITH invalidated AS (
         UPDATE appsea.opportunities opportunity
            SET availability_state = 'invalidated',
                invalidated_at = clock_timestamp(),
                invalidation_reason = 'Source deletion tombstone ' || $4,
                current_score_snapshot_id = NULL,
                current_plan_package_id = NULL,
                updated_at = clock_timestamp()
          WHERE opportunity.workspace_id = $1
            AND opportunity.availability_state = 'active'
            AND EXISTS (
              SELECT 1
                FROM appsea.research_analysis_run_outputs output
                JOIN appsea.production_analysis_runs analysis
                  ON analysis.workspace_id = output.workspace_id
                 AND analysis.analysis_run_id = output.analysis_run_id
                WHERE output.workspace_id = opportunity.workspace_id
                  AND output.opportunity_id = opportunity.opportunity_id
                  AND analysis.state = 'completed'
                  AND analysis.availability_state = 'invalidated'
                  AND analysis.invalidation_reason = 'Source deletion tombstone ' || $4
            )
            AND NOT EXISTS (
              SELECT 1
                FROM appsea.research_analysis_run_outputs active_output
                JOIN appsea.production_analysis_runs active_analysis
                  ON active_analysis.workspace_id = active_output.workspace_id
                 AND active_analysis.analysis_run_id = active_output.analysis_run_id
                WHERE active_output.workspace_id = opportunity.workspace_id
                  AND active_output.opportunity_id = opportunity.opportunity_id
                  AND active_analysis.state = 'completed'
                  AND active_analysis.availability_state = 'active'
            )
         RETURNING opportunity.workspace_id, opportunity.opportunity_id, opportunity.source_run_id
       ), candidates AS (
         SELECT DISTINCT ON (invalidated.workspace_id, invalidated.opportunity_id)
                invalidated.workspace_id, invalidated.opportunity_id,
                invalidated.source_run_id AS collection_run_id,
                analysis.seed_review_id
           FROM invalidated
           JOIN appsea.research_analysis_run_outputs output
             ON output.workspace_id = invalidated.workspace_id
            AND output.opportunity_id = invalidated.opportunity_id
           JOIN appsea.production_analysis_runs analysis
             ON analysis.workspace_id = output.workspace_id
            AND analysis.analysis_run_id = output.analysis_run_id
            AND analysis.collection_run_id = invalidated.source_run_id
          WHERE analysis.state = 'completed'
            AND analysis.availability_state = 'invalidated'
            AND analysis.invalidation_reason = 'Source deletion tombstone ' || $4
          ORDER BY invalidated.workspace_id, invalidated.opportunity_id,
                   analysis.completed_at DESC NULLS LAST, analysis.analysis_run_id DESC
       ), enqueued AS (
         INSERT INTO appsea.production_analysis_recompute_jobs
           (workspace_id, recompute_id, opportunity_id, collection_run_id, seed_review_id,
            source_tombstone_id, analysis_run_id, idempotency_key, requested_at, state,
            failure_code, failure_summary, next_attempt_at, finished_at, updated_at)
         SELECT candidates.workspace_id,
                'recompute:analysis:' || md5(jsonb_build_array(candidates.workspace_id,
                                                                candidates.opportunity_id, $4)::text),
                candidates.opportunity_id,
                candidates.collection_run_id,
                candidates.seed_review_id,
                $4,
                'analysis-run:' || md5(jsonb_build_array(candidates.workspace_id,
                                                         candidates.opportunity_id, $4)::text),
                'production-analysis-recompute-' || md5(jsonb_build_array(candidates.workspace_id,
                                                                           candidates.opportunity_id, $4)::text),
                clock_timestamp(),
                CASE WHEN seed.review_state = 'approved' THEN 'queued' ELSE 'blocked' END,
                CASE WHEN seed.review_state = 'approved' THEN NULL ELSE 'seed_not_approved' END,
                CASE WHEN seed.review_state = 'approved'
                     THEN NULL
                     ELSE 'The reviewed analysis seed must be approved before repair can start.'
                END,
                clock_timestamp(),
                CASE WHEN seed.review_state = 'approved' THEN NULL ELSE clock_timestamp() END,
                clock_timestamp()
           FROM candidates
           JOIN appsea.opportunity_seed_reviews seed
             ON seed.workspace_id = candidates.workspace_id
            AND seed.seed_review_id = candidates.seed_review_id
         ON CONFLICT (workspace_id, opportunity_id, source_tombstone_id) DO NOTHING
         RETURNING opportunity_id
       )
       SELECT (SELECT count(*) FROM invalidated)::int AS opportunity_count,
              (SELECT count(*) FROM enqueued)::int AS recomputation_jobs_queued`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    const opportunityCount = Number(opportunities.rows[0]?.opportunity_count ?? 0)
    const recomputationJobsQueued = Number(opportunities.rows[0]?.recomputation_jobs_queued ?? 0)

    const reports = await client.query(
      `UPDATE appsea.report_versions report
          SET structured_report = jsonb_build_object(
                '_deletion', jsonb_build_object(
                  'state', 'source_deleted',
                  'tombstoneId', $4
                )
              ),
              markdown_object_ref = NULL,
              deletion_state = 'source_deleted',
              deletion_tombstone_id = $4
        WHERE report.workspace_id = $1
          AND report.deletion_state <> 'source_deleted'
          AND (report.deletion_tombstone_id IS NULL OR report.deletion_tombstone_id = $4)
          AND EXISTS (
            SELECT 1
              FROM appsea.research_run_opportunities run_opportunity
              JOIN appsea.research_run_source_items run_item
                ON run_item.workspace_id = run_opportunity.workspace_id
               AND run_item.run_id = run_opportunity.run_id
             JOIN appsea.source_items source_item
                ON source_item.workspace_id = run_item.workspace_id
               AND source_item.source_item_id = run_item.source_item_id
             WHERE run_opportunity.workspace_id = report.workspace_id
               AND run_opportunity.opportunity_id = report.opportunity_id
               AND source_item.source_id = $2
               AND source_item.source_record_id = $3
          )
      RETURNING report_id`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    const plans = await client.query(
      `UPDATE appsea.plan_package_versions plan
          SET fixture_files = CASE
                WHEN plan.synthetic THEN jsonb_build_object(
                  '_deletion', jsonb_build_object(
                    'state', 'source_deleted',
                    'tombstoneId', $4
                  )
                )
                ELSE NULL
              END,
              package_object_ref = CASE
                WHEN plan.synthetic THEN NULL
                ELSE 'deleted:' || $4
              END,
              deletion_state = 'source_deleted',
              deletion_tombstone_id = $4
        WHERE plan.workspace_id = $1
          AND plan.deletion_state <> 'source_deleted'
          AND (plan.deletion_tombstone_id IS NULL OR plan.deletion_tombstone_id = $4)
          AND (
            EXISTS (
              SELECT 1
                FROM appsea.research_run_source_items run_item
                JOIN appsea.source_items source_item
                  ON source_item.workspace_id = run_item.workspace_id
                 AND source_item.source_item_id = run_item.source_item_id
               WHERE run_item.workspace_id = plan.workspace_id
                 AND run_item.run_id = plan.run_id
                 AND source_item.source_id = $2
                 AND source_item.source_record_id = $3
            )
            OR EXISTS (
              SELECT 1
                FROM appsea.report_versions report
               WHERE report.workspace_id = plan.workspace_id
                 AND report.report_id = plan.report_id
                 AND report.deletion_tombstone_id = $4
            )
          )
      RETURNING plan_package_id`,
      [tombstone.workspaceId, tombstone.sourceId, tombstone.sourceRecordId, tombstone.tombstoneId]
    )

    return {
      sourceItemCount: rowCount(sourceItems),
      evidenceCount: rowCount(evidence),
      analysisCount: rowCount(analyses),
      opportunityCount,
      recomputationJobsQueued,
      reportCount: rowCount(reports),
      planCount: rowCount(plans),
      affectedObjectCount:
        rowCount(sourceItems) +
        rowCount(evidence) +
        rowCount(analyses) +
        opportunityCount +
        rowCount(reports) +
        rowCount(plans)
    }
  }
}

export { PostgresDeletionPropagationRepository as PostgresDeletionRepository }
