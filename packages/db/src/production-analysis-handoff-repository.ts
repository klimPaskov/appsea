import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { contentHash } from './hash'
import { withDatabaseTransaction, withWorkspaceTransaction } from './transaction'

export type ProductionAnalysisHandoffState = 'queued' | 'dispatching' | 'started' | 'failed'
export type ProductionAnalysisHandoffFailureCode =
  'analysis_not_ready' | 'seed_not_approved' | 'handoff_dispatch_failed'

export interface ProductionAnalysisHandoffRecord {
  workspaceId: string
  handoffId: string
  collectionWorkflowId: string
  collectionRunId: string
  seedReviewId: string
  analysisRunId: string
  idempotencyKey: string
  requestedAt: string
  state: ProductionAnalysisHandoffState
  attemptCount: number
  workflowId: string | null
  failureCode: ProductionAnalysisHandoffFailureCode | null
  failureSummary: string | null
  nextAttemptAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface ProductionAnalysisHandoffEnqueueInput {
  workspaceId: string
  handoffId: string
  collectionWorkflowId: string
  collectionRunId: string
  seedReviewId: string
  analysisRunId: string
  idempotencyKey: string
  requestedAt: string
}

export class ProductionAnalysisHandoffConflictError extends Error {
  constructor() {
    super('Production analysis handoff identity conflicts with an existing handoff')
    this.name = 'ProductionAnalysisHandoffConflictError'
  }
}

export class ProductionAnalysisHandoffStateError extends Error {
  constructor(handoffId: string, state: string) {
    super(`Production analysis handoff ${handoffId} is not in a dispatchable state (${state})`)
    this.name = 'ProductionAnalysisHandoffStateError'
  }
}

interface HandoffRow extends QueryResultRow {
  workspace_id: string
  handoff_id: string
  collection_workflow_id: string
  collection_run_id: string
  seed_review_id: string
  analysis_run_id: string
  idempotency_key: string
  requested_at: Date | string
  state: ProductionAnalysisHandoffState
  attempt_count: number | string
  workflow_id: string | null
  failure_code: ProductionAnalysisHandoffFailureCode | null
  failure_summary: string | null
  next_attempt_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
  updated_at: Date | string
}

const handoffColumns = `
  workspace_id, handoff_id, collection_workflow_id, collection_run_id,
  seed_review_id, analysis_run_id, idempotency_key, requested_at, state,
  attempt_count, workflow_id, failure_code, failure_summary, next_attempt_at,
  started_at, finished_at, updated_at`

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapRow(row: HandoffRow): ProductionAnalysisHandoffRecord {
  return {
    workspaceId: row.workspace_id,
    handoffId: row.handoff_id,
    collectionWorkflowId: row.collection_workflow_id,
    collectionRunId: row.collection_run_id,
    seedReviewId: row.seed_review_id,
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

/** Stable identifiers make a completion replay safe without retaining a raw key. */
export function productionAnalysisHandoffIdentity(
  workspaceId: string,
  collectionRunId: string,
  seedReviewId: string
): { handoffId: string; analysisRunId: string; idempotencyKey: string } {
  const digest = contentHash({
    endpoint: 'production-analysis-handoff',
    version: 'production-analysis-handoff-v1',
    workspaceId,
    collectionRunId,
    seedReviewId
  }).slice(0, 32)
  return {
    handoffId: `handoff:analysis:${digest}`,
    analysisRunId: `analysis-run:${digest}`,
    idempotencyKey: `production-analysis-handoff-${digest}`
  }
}

function validatedEnqueueInput(
  input: ProductionAnalysisHandoffEnqueueInput
): ProductionAnalysisHandoffEnqueueInput {
  return {
    ...input,
    workspaceId: appseaIdentifierSchema.parse(input.workspaceId),
    handoffId: appseaIdentifierSchema.parse(input.handoffId),
    collectionWorkflowId: appseaIdentifierSchema.parse(input.collectionWorkflowId),
    collectionRunId: appseaIdentifierSchema.parse(input.collectionRunId),
    seedReviewId: appseaIdentifierSchema.parse(input.seedReviewId),
    analysisRunId: appseaIdentifierSchema.parse(input.analysisRunId)
  }
}

/** Enqueue inside the collection completion transaction. */
export async function enqueueProductionAnalysisHandoffInTransaction(
  client: PoolClient,
  input: ProductionAnalysisHandoffEnqueueInput
): Promise<ProductionAnalysisHandoffRecord> {
  const parsed = validatedEnqueueInput(input)
  const identity = productionAnalysisHandoffIdentity(
    parsed.workspaceId,
    parsed.collectionRunId,
    parsed.seedReviewId
  )
  if (
    identity.handoffId !== parsed.handoffId ||
    identity.analysisRunId !== parsed.analysisRunId ||
    identity.idempotencyKey !== parsed.idempotencyKey
  ) {
    throw new ProductionAnalysisHandoffConflictError()
  }
  const inserted = await client.query<HandoffRow>(
    `INSERT INTO appsea.production_analysis_handoffs
       (workspace_id, handoff_id, collection_workflow_id, collection_run_id,
        seed_review_id, analysis_run_id, idempotency_key, requested_at, state,
        next_attempt_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, 'queued', $8::timestamptz, $8::timestamptz)
     ON CONFLICT (workspace_id, collection_workflow_id) DO NOTHING
     RETURNING ${handoffColumns}`,
    [
      parsed.workspaceId,
      parsed.handoffId,
      parsed.collectionWorkflowId,
      parsed.collectionRunId,
      parsed.seedReviewId,
      parsed.analysisRunId,
      parsed.idempotencyKey,
      parsed.requestedAt
    ]
  )
  if (inserted.rows[0]) return mapRow(inserted.rows[0])
  const existing = await client.query<HandoffRow>(
    `SELECT ${handoffColumns}
       FROM appsea.production_analysis_handoffs
      WHERE workspace_id = $1 AND collection_workflow_id = $2
      FOR UPDATE`,
    [parsed.workspaceId, parsed.collectionWorkflowId]
  )
  const row = existing.rows[0]
  if (
    !row ||
    row.handoff_id !== parsed.handoffId ||
    row.collection_run_id !== parsed.collectionRunId ||
    row.seed_review_id !== parsed.seedReviewId ||
    row.analysis_run_id !== parsed.analysisRunId ||
    row.idempotency_key !== parsed.idempotencyKey
  ) {
    throw new ProductionAnalysisHandoffConflictError()
  }
  return mapRow(row)
}

export class PostgresProductionAnalysisHandoffRepository {
  constructor(private readonly pool: Pool) {}

  async listActiveWorkspaceIds(): Promise<string[]> {
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

  /** Claim queued work or recover a dispatch claim abandoned by a crashed worker. */
  async claimNext(workspaceId: string): Promise<ProductionAnalysisHandoffRecord | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const claimed = await client.query<HandoffRow>(
        `WITH candidate AS (
           SELECT workspace_id, handoff_id
             FROM appsea.production_analysis_handoffs
            WHERE workspace_id = $1
              AND (
                (state = 'queued' AND next_attempt_at <= clock_timestamp())
                OR (state = 'dispatching'
                    AND updated_at <= clock_timestamp() - interval '15 minutes')
              )
            ORDER BY next_attempt_at, handoff_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE appsea.production_analysis_handoffs handoff
            SET state = 'dispatching',
                attempt_count = handoff.attempt_count + 1,
                failure_code = NULL,
                failure_summary = NULL,
                updated_at = clock_timestamp()
           FROM candidate
          WHERE handoff.workspace_id = candidate.workspace_id
            AND handoff.handoff_id = candidate.handoff_id
         RETURNING ${handoffColumns}`,
        [parsedWorkspaceId]
      )
      return claimed.rows[0] ? mapRow(claimed.rows[0]) : null
    })
  }

  async markStarted(
    workspaceId: string,
    handoffId: string,
    workflowId: string
  ): Promise<ProductionAnalysisHandoffRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedHandoffId = appseaIdentifierSchema.parse(handoffId)
    const parsedWorkflowId = appseaIdentifierSchema.parse(workflowId)
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<HandoffRow>(
        `UPDATE appsea.production_analysis_handoffs
            SET state = 'started', workflow_id = $3,
                started_at = COALESCE(started_at, clock_timestamp()),
                finished_at = NULL, failure_code = NULL, failure_summary = NULL,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND handoff_id = $2 AND state = 'dispatching'
        RETURNING ${handoffColumns}`,
        [parsedWorkspaceId, parsedHandoffId, parsedWorkflowId]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedHandoffId)
      if (!existing) throw new Error(`Production analysis handoff ${parsedHandoffId} was not found`)
      if (existing.state === 'started' && existing.workflowId === parsedWorkflowId) return existing
      throw new ProductionAnalysisHandoffStateError(parsedHandoffId, existing.state)
    })
  }

  async reschedule(
    workspaceId: string,
    handoffId: string,
    failureCode: ProductionAnalysisHandoffFailureCode,
    failureSummary: string,
    delaySeconds: number
  ): Promise<ProductionAnalysisHandoffRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedHandoffId = appseaIdentifierSchema.parse(handoffId)
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 86_400) {
      throw new Error('handoff retry delay is outside the supported range')
    }
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('handoff failure summary is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<HandoffRow>(
        `UPDATE appsea.production_analysis_handoffs
            SET state = CASE WHEN attempt_count >= 24 THEN 'failed' ELSE 'queued' END,
                failure_code = $3,
                failure_summary = $4,
                next_attempt_at = CASE
                  WHEN attempt_count >= 24 THEN clock_timestamp()
                  ELSE clock_timestamp() + ($5::text || ' seconds')::interval
                END,
                finished_at = CASE WHEN attempt_count >= 24 THEN clock_timestamp() ELSE NULL END,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND handoff_id = $2 AND state = 'dispatching'
        RETURNING ${handoffColumns}`,
        [parsedWorkspaceId, parsedHandoffId, failureCode, failureSummary, delaySeconds]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedHandoffId)
      if (!existing) throw new Error(`Production analysis handoff ${parsedHandoffId} was not found`)
      if (existing.state === 'queued' || existing.state === 'failed') return existing
      throw new ProductionAnalysisHandoffStateError(parsedHandoffId, existing.state)
    })
  }

  async fail(
    workspaceId: string,
    handoffId: string,
    failureCode: ProductionAnalysisHandoffFailureCode,
    failureSummary: string
  ): Promise<ProductionAnalysisHandoffRecord> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedHandoffId = appseaIdentifierSchema.parse(handoffId)
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('handoff failure summary is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const updated = await client.query<HandoffRow>(
        `UPDATE appsea.production_analysis_handoffs
            SET state = 'failed',
                failure_code = $3,
                failure_summary = $4,
                next_attempt_at = clock_timestamp(),
                finished_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND handoff_id = $2 AND state = 'dispatching'
        RETURNING ${handoffColumns}`,
        [parsedWorkspaceId, parsedHandoffId, failureCode, failureSummary]
      )
      if (updated.rows[0]) return mapRow(updated.rows[0])
      const existing = await this.readInTransaction(client, parsedWorkspaceId, parsedHandoffId)
      if (!existing) throw new Error(`Production analysis handoff ${parsedHandoffId} was not found`)
      if (existing.state === 'failed' && existing.failureCode === failureCode) return existing
      throw new ProductionAnalysisHandoffStateError(parsedHandoffId, existing.state)
    })
  }

  async read(
    workspaceId: string,
    handoffId: string
  ): Promise<ProductionAnalysisHandoffRecord | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedHandoffId = appseaIdentifierSchema.parse(handoffId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      (client) => this.readInTransaction(client, parsedWorkspaceId, parsedHandoffId),
      { readOnly: true }
    )
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    handoffId: string
  ): Promise<ProductionAnalysisHandoffRecord | null> {
    const result = await client.query<HandoffRow>(
      `SELECT ${handoffColumns}
         FROM appsea.production_analysis_handoffs
        WHERE workspace_id = $1 AND handoff_id = $2`,
      [workspaceId, handoffId]
    )
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }
}
