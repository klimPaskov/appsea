import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  productionCollectionWorkflowCheckpointWriteSchema,
  productionCollectionWorkflowCompletionInputSchema,
  productionCollectionWorkflowHashMaterialSchema,
  productionCollectionWorkflowJobInitializeInputSchema,
  productionCollectionWorkflowTerminationInputSchema,
  productionCollectionWorkflowCancelResultSchema,
  researchCampaignRunReadModelSchema,
  type ProductionCollectionWorkflowCheckpointWrite,
  type ProductionCollectionWorkflowCompletionInput,
  type ProductionCollectionWorkflowExecutionMetadata,
  type ProductionCollectionWorkflowInput,
  type ProductionCollectionWorkflowPersistenceActivityResult,
  type ProductionCollectionWorkflowStatus,
  type ProductionCollectionWorkflowCancelResult,
  type MaintenanceSchedulerFence,
  type ResearchCampaignRunReadModel,
  workflowIdSchema,
  workflowJobCheckpointSchema,
  workflowJobStateSchema,
  workflowActorSchema
} from '@appsea/contracts'
import { contentHash } from './hash'
import {
  withAuthenticatedWorkspaceTransaction,
  withDatabaseTransaction,
  withServiceWorkspaceTransaction,
  withWorkspaceTransaction
} from './transaction'
import {
  WorkflowCheckpointConflictError,
  WorkflowJobConflictError,
  WorkflowJobStateError
} from './workflow-job-repository'
import {
  enqueueProductionAnalysisHandoffInTransaction,
  productionAnalysisHandoffIdentity
} from './production-analysis-handoff-repository'
import {
  assertProductionWorkflowAdmissionConsumed,
  consumeProductionWorkflowAdmissionInTransaction
} from './production-workflow-admission-repository'

interface ProductionWorkflowRow extends QueryResultRow {
  workspace_id: string
  workflow_id: string
  temporal_first_execution_run_id: string
  workflow_type: string
  workflow_version: string
  task_queue: string
  campaign_id: string
  requested_research_run_id: string
  source_id: string
  policy_version: string
  analysis_seed_review_id: string | null
  recollection_tombstone_id: string | null
  idempotency_digest: string
  input_hash: string
  requested_by_actor_type: 'user' | 'service'
  requested_by_actor_id: string
  state: string
  checkpoint: string
  budget_currency: string
  max_source_items: number
  max_cost_micros: string
  max_activity_attempts: number
  consumed_source_items: number
  consumed_cost_micros: string
  activity_attempts: number
  persisted_run_id: string | null
  failure_code: string | null
  failure_summary: string | null
  requested_at: Date | string
  started_at: Date | string
  updated_at: Date | string
  finished_at: Date | string | null
  cancellation_requested_at: Date | string | null
  cancellation_requested_by: string | null
  cancellation_request_id: string | null
}

interface StoredHashRow extends QueryResultRow {
  content_hash: string
}

function asIso(value: Date | string | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
}

const checkpointRanks: Record<ProductionCollectionWorkflowCheckpointWrite['checkpoint'], number> = {
  accepted: 0,
  initialized: 1,
  inspected: 2,
  budget_approved: 3,
  persisting: 4,
  persisted: 5,
  completed: 6,
  failed: 6,
  canceled: 6,
  budget_rejected: 6
}

function eventId(prefix: string, row: ProductionWorkflowRow): string {
  return `${prefix}:production-workflow:${contentHash({ workspaceId: row.workspace_id, workflowId: row.workflow_id }).slice(0, 32)}`
}

function mapRow(row: ProductionWorkflowRow): ProductionCollectionWorkflowStatus & {
  workspaceId: string
  workflowId: string
  campaignId: string
  runId: string
  sourceId: string
  policyVersion: string
  idempotencyDigest: string
  analysisSeedReviewId: string | null
  recollectionTombstoneId: string | null
  requestedBy: ProductionCollectionWorkflowInput['requestedBy']
  requestedAt: string
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  cancellationRequestedAt: string | null
} {
  return {
    workflowId: row.workflow_id,
    temporalFirstExecutionRunId: row.temporal_first_execution_run_id,
    inputHash: row.input_hash,
    state: workflowJobStateSchema.parse(row.state),
    checkpoint: workflowJobCheckpointSchema.parse(row.checkpoint),
    activityAttempts: row.activity_attempts,
    consumedSourceItems: row.consumed_source_items,
    consumedCostMicros: Number(row.consumed_cost_micros),
    result: null,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    runId: row.requested_research_run_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    idempotencyDigest: row.idempotency_digest,
    analysisSeedReviewId: row.analysis_seed_review_id,
    recollectionTombstoneId: row.recollection_tombstone_id ?? null,
    requestedBy: workflowActorSchema.parse({
      actorType: row.requested_by_actor_type,
      actorId: row.requested_by_actor_id
    }),
    requestedAt: asIso(row.requested_at)!,
    startedAt: asIso(row.started_at)!,
    updatedAt: asIso(row.updated_at)!,
    finishedAt: asIso(row.finished_at),
    cancellationRequestedAt: asIso(row.cancellation_requested_at)
  }
}

function mapCampaignRun(row: ProductionWorkflowRow): ResearchCampaignRunReadModel {
  return researchCampaignRunReadModelSchema.parse({
    campaignId: row.campaign_id,
    workflowId: row.workflow_id,
    runId: row.requested_research_run_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    state: row.state,
    checkpoint: row.checkpoint,
    activityAttempts: row.activity_attempts,
    consumedSourceItems: row.consumed_source_items,
    consumedCostMicros: Number(row.consumed_cost_micros),
    analysisSeedReviewId: row.analysis_seed_review_id,
    recollectionTombstoneId: row.recollection_tombstone_id,
    requestedAt: asIso(row.requested_at)!,
    startedAt: asIso(row.started_at)!,
    updatedAt: asIso(row.updated_at)!,
    finishedAt: asIso(row.finished_at),
    cancellationRequestedAt: asIso(row.cancellation_requested_at)
  })
}

async function readForUpdate(
  client: PoolClient,
  workspaceId: string,
  workflowId: string
): Promise<ProductionWorkflowRow | undefined> {
  const result = await client.query<ProductionWorkflowRow>(
    `SELECT *
       FROM appsea.production_collection_workflow_jobs
      WHERE workspace_id = $1 AND workflow_id = $2
      FOR UPDATE`,
    [workspaceId, workflowId]
  )
  return result.rows[0]
}

async function actorRole(
  client: PoolClient,
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const result = await client.query<{ role: string }>(
    `SELECT role
       FROM appsea.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2
      FOR SHARE`,
    [workspaceId, userId]
  )
  return result.rows[0]?.role ?? null
}

export interface ProductionCollectionWorkflowCancellationTarget {
  workspaceId: string
  workflowId: string
}

export class ProductionCollectionWorkflowPermissionError extends Error {
  constructor() {
    super('The workspace role cannot manage a production collection workflow')
    this.name = 'ProductionCollectionWorkflowPermissionError'
  }
}

function assertIdentity(
  row: ProductionWorkflowRow,
  execution: ProductionCollectionWorkflowExecutionMetadata
): void {
  if (
    row.workflow_id !== execution.workflowId ||
    row.temporal_first_execution_run_id !== execution.temporalFirstExecutionRunId ||
    row.workflow_type !== execution.workflowType ||
    row.workflow_version !== execution.workflowVersion ||
    row.task_queue !== execution.taskQueue
  ) {
    throw new WorkflowJobConflictError()
  }
}

async function insertCheckpoint(
  client: PoolClient,
  checkpoint: ProductionCollectionWorkflowCheckpointWrite
): Promise<void> {
  const hash = contentHash(checkpoint)
  await client.query(
    `INSERT INTO appsea.production_collection_workflow_checkpoints
       (workspace_id, workflow_id, checkpoint_key, sequence_no, checkpoint, state,
        activity_attempt, consumed_source_items, consumed_cost_micros, content_hash, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT DO NOTHING`,
    [
      checkpoint.workspaceId,
      checkpoint.execution.workflowId,
      checkpoint.checkpointKey,
      checkpoint.sequenceNo,
      checkpoint.checkpoint,
      checkpoint.state,
      checkpoint.activityAttempt,
      checkpoint.consumedSourceItems,
      checkpoint.consumedCostMicros,
      hash,
      checkpoint.occurredAt
    ]
  )
  const stored = await client.query<StoredHashRow>(
    `SELECT content_hash
       FROM appsea.production_collection_workflow_checkpoints
      WHERE workspace_id = $1 AND workflow_id = $2 AND checkpoint_key = $3`,
    [checkpoint.workspaceId, checkpoint.execution.workflowId, checkpoint.checkpointKey]
  )
  if (stored.rows[0]?.content_hash !== hash) throw new WorkflowCheckpointConflictError()
}

async function insertTerminalLedger(
  client: PoolClient,
  row: ProductionWorkflowRow,
  state: 'completed' | 'failed' | 'canceled' | 'budget_rejected',
  sourceItems: number,
  costMicros: number,
  occurredAt: string,
  persistedRunId: string | null
): Promise<void> {
  const payload = {
    workflowId: row.workflow_id,
    workflowType: row.workflow_type,
    workflowVersion: row.workflow_version,
    campaignId: row.campaign_id,
    requestedResearchRunId: row.requested_research_run_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    requestedBy: {
      actorType: row.requested_by_actor_type,
      actorId: row.requested_by_actor_id
    },
    state,
    sourceItems,
    costMicros
  }
  await client.query(
    `INSERT INTO appsea.cost_ledger_entries
       (workspace_id, cost_entry_id, campaign_id, run_id, source_id, cost_type, quantity,
        unit, amount, currency, estimate, recorded_at)
     VALUES ($1, $2, $3, $4, $5, 'production_collection_workflow', $6, 'source_item',
             $7, 'USD', false, $8)
     ON CONFLICT DO NOTHING`,
    [
      row.workspace_id,
      eventId('cost', row),
      row.campaign_id,
      persistedRunId,
      row.source_id,
      sourceItems,
      (costMicros / 1_000_000).toFixed(6),
      occurredAt
    ]
  )
  await client.query(
    `INSERT INTO appsea.audit_events
       (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
        target_id, correlation_id, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, 'production_collection_workflow', $6, $6, $7::jsonb, $8)
     ON CONFLICT DO NOTHING`,
    [
      row.workspace_id,
      eventId('audit', row),
      row.requested_by_actor_type,
      row.requested_by_actor_id,
      `production_collection.workflow.${state}`,
      row.workflow_id,
      JSON.stringify(payload),
      occurredAt
    ]
  )
  await client.query(
    `INSERT INTO appsea.outbox_events
       (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
        schema_version, correlation_id, payload, occurred_at)
     VALUES ($1, $2, $3, 'production_collection_workflow', $4,
             'production-collection-workflow-v1', $4, $5::jsonb, $6)
     ON CONFLICT DO NOTHING`,
    [
      row.workspace_id,
      eventId('outbox', row),
      `production_collection.workflow.${state}`,
      row.workflow_id,
      JSON.stringify(payload),
      occurredAt
    ]
  )
}

export class PostgresProductionCollectionWorkflowRepository {
  constructor(private readonly pool: Pool) {}

  /** Persist cancellation intent before attempting the external Temporal call. */
  async requestCancellationForUser(
    userId: string,
    workspaceId: string,
    workflowId: string
  ): Promise<ProductionCollectionWorkflowCancelResult | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedWorkflowId = workflowIdSchema.parse(workflowId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') {
          throw new ProductionCollectionWorkflowPermissionError()
        }
        const workspace = await client.query<{
          fixture_only: boolean
          visibility: string
          status: string
        }>(
          `SELECT fixture_only, visibility, status
             FROM appsea.workspaces
            WHERE workspace_id = $1
            FOR SHARE`,
          [parsedWorkspaceId]
        )
        const workspaceRow = workspace.rows[0]
        if (
          !workspaceRow ||
          workspaceRow.fixture_only ||
          workspaceRow.visibility !== 'private' ||
          workspaceRow.status !== 'active'
        ) {
          throw new ProductionCollectionWorkflowPermissionError()
        }

        const row = await readForUpdate(client, parsedWorkspaceId, parsedWorkflowId)
        if (!row) return null
        const terminal = ['completed', 'failed', 'canceled', 'budget_rejected'].includes(row.state)
        if (terminal) {
          return productionCollectionWorkflowCancelResultSchema.parse({
            workflowId: parsedWorkflowId,
            campaignId: row.campaign_id,
            state: 'already_terminal',
            cancellationRequestedAt: asIso(row.cancellation_requested_at)
          })
        }

        const requestId = `cancel:production-workflow:${contentHash({
          workspaceId: parsedWorkspaceId,
          workflowId: parsedWorkflowId
        }).slice(0, 48)}`
        const updated = await client.query<ProductionWorkflowRow>(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.production_collection_workflow_jobs job
              SET cancellation_requested_at = COALESCE(job.cancellation_requested_at, clock.now),
                  cancellation_requested_by = COALESCE(job.cancellation_requested_by, $3),
                  cancellation_request_id = COALESCE(job.cancellation_request_id, $4),
                  updated_at = GREATEST(job.updated_at, clock.now)
             FROM clock
            WHERE job.workspace_id = $1
              AND job.workflow_id = $2
              AND job.state IN ('queued', 'running')
            RETURNING job.*`,
          [parsedWorkspaceId, parsedWorkflowId, parsedUserId, requestId]
        )
        const updatedRow = updated.rows[0] ?? row
        if (!row.cancellation_requested_at && updated.rows[0]) {
          const occurredAt = asIso(updatedRow.cancellation_requested_at)!
          const metadata = JSON.stringify({
            workflowId: parsedWorkflowId,
            campaignId: row.campaign_id,
            sourceId: row.source_id
          })
          await client.query(
            `INSERT INTO appsea.audit_events
               (workspace_id, audit_event_id, actor_type, actor_id, action,
                target_type, target_id, correlation_id, metadata, occurred_at)
             VALUES ($1, $2, 'user', $3,
                     'research.production_workflow.cancellation_requested',
                     'production_collection_workflow', $4, $4, $5::jsonb, $6)
             ON CONFLICT DO NOTHING`,
            [
              parsedWorkspaceId,
              `audit:production-workflow-cancel:${requestId}`,
              parsedUserId,
              parsedWorkflowId,
              metadata,
              occurredAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.outbox_events
               (workspace_id, outbox_event_id, event_type, aggregate_type,
                aggregate_id, schema_version, correlation_id, payload, occurred_at)
             VALUES ($1, $2, 'research.production_workflow.cancellation_requested',
                     'production_collection_workflow', $3,
                     'production-collection-workflow-v1', $3, $4::jsonb, $5)
             ON CONFLICT DO NOTHING`,
            [
              parsedWorkspaceId,
              `outbox:production-workflow-cancel:${requestId}`,
              parsedWorkflowId,
              JSON.stringify({
                workspaceId: parsedWorkspaceId,
                campaignId: row.campaign_id,
                workflowId: parsedWorkflowId
              }),
              occurredAt
            ]
          )
        }
        return productionCollectionWorkflowCancelResultSchema.parse({
          workflowId: parsedWorkflowId,
          campaignId: updatedRow.campaign_id,
          state: 'requested',
          cancellationRequestedAt: asIso(updatedRow.cancellation_requested_at)
        })
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async listWorkspaceIdsForService(): Promise<string[]> {
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

  async listCancellationTargetsForService(workspaceId: string, limit = 100): Promise<string[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Production workflow cancellation limit must be between 1 and 100')
    }
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ workflow_id: string }>(
          `SELECT workflow_id
             FROM appsea.production_collection_workflow_jobs
            WHERE workspace_id = $1
              AND cancellation_requested_at IS NOT NULL
              AND state IN ('queued', 'running')
            ORDER BY cancellation_requested_at, workflow_id
            LIMIT $2`,
          [parsedWorkspaceId, limit]
        )
        return result.rows.map((row) => workflowIdSchema.parse(row.workflow_id))
      },
      { readOnly: true }
    )
  }

  async prepareCancellationForService(
    workspaceId: string,
    workflowId: string,
    fence?: MaintenanceSchedulerFence
  ): Promise<ProductionCollectionWorkflowCancellationTarget | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedWorkflowId = workflowIdSchema.parse(workflowId)
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const row = await readForUpdate(client, parsedWorkspaceId, parsedWorkflowId)
        if (
          !row ||
          !row.cancellation_requested_at ||
          ['completed', 'failed', 'canceled', 'budget_rejected'].includes(row.state)
        ) {
          return null
        }
        return { workspaceId: parsedWorkspaceId, workflowId: parsedWorkflowId }
      },
      { maintenanceFence: fence }
    )
  }

  async initialize(
    input: Parameters<typeof productionCollectionWorkflowJobInitializeInputSchema.parse>[0]
  ): Promise<ReturnType<typeof mapRow>> {
    const parsed = productionCollectionWorkflowJobInitializeInputSchema.parse(input)
    const requestedBy = parsed.input.requestedBy ?? {
      actorType: 'service' as const,
      actorId: 'appsea-worker' as const
    }
    const { inputHash, ...hashMaterialCandidate } = parsed.input
    const hashMaterial = productionCollectionWorkflowWorkflowHashMaterial(hashMaterialCandidate)
    if (
      inputHash !== contentHash(hashMaterial) ||
      parsed.execution.workflowVersion !== parsed.input.workflowVersion
    ) {
      throw new WorkflowJobConflictError()
    }
    return withWorkspaceTransaction(
      this.pool,
      parsed.input.workspaceId,
      async (client) => {
        const workspace = await client.query<
          QueryResultRow & { fixture_only: boolean; status: string; visibility: string }
        >(
          `SELECT fixture_only, status, visibility
             FROM appsea.workspaces
            WHERE workspace_id = $1
            FOR UPDATE`,
          [parsed.input.workspaceId]
        )
        const workspaceRow = workspace.rows[0]
        if (
          !workspaceRow ||
          workspaceRow.fixture_only ||
          workspaceRow.status !== 'active' ||
          workspaceRow.visibility !== 'private'
        ) {
          throw new WorkflowJobStateError(
            'Production collection workflows require an active private non-fixture workspace'
          )
        }
        const campaign = await client.query<
          QueryResultRow & { state: string; synthetic: boolean; budget: unknown }
        >(
          `SELECT state, synthetic, budget
             FROM appsea.research_campaigns
            WHERE workspace_id = $1 AND campaign_id = $2
            FOR UPDATE`,
          [parsed.input.workspaceId, parsed.input.campaignId]
        )
        if (!campaign.rows[0]) {
          await client.query(
            `INSERT INTO appsea.research_campaigns
             (workspace_id, campaign_id, name, purpose, state, configuration, budget,
              synthetic, created_at, updated_at)
           VALUES ($1, $2, 'Production source collection', $3, 'running', $4::jsonb,
                   $5::jsonb, false, $6, $6)`,
            [
              parsed.input.workspaceId,
              parsed.input.campaignId,
              parsed.input.purpose,
              JSON.stringify({
                mode: 'production-collection',
                sourceId: parsed.input.sourceId,
                policyVersion: parsed.input.policyVersion,
                query: parsed.input.query,
                requestedDisplayMode: parsed.input.requestedDisplayMode,
                ...(parsed.input.recollectionTombstoneId
                  ? { recollectionTombstoneId: parsed.input.recollectionTombstoneId }
                  : {})
              }),
              JSON.stringify(parsed.input.budget),
              parsed.occurredAt
            ]
          )
        } else {
          const campaignRow = campaign.rows[0]
          if (
            campaignRow.synthetic ||
            !['draft', 'validated', 'queued', 'running'].includes(campaignRow.state)
          ) {
            throw new WorkflowJobStateError(
              'Research campaign is not eligible for production collection'
            )
          }
          if (contentHash(campaignRow.budget) !== contentHash(parsed.input.budget)) {
            throw new WorkflowJobConflictError()
          }
          await client.query(
            `UPDATE appsea.research_campaigns
                SET state = 'running', updated_at = GREATEST(updated_at, $3)
              WHERE workspace_id = $1 AND campaign_id = $2
                AND state <> 'archived'`,
            [parsed.input.workspaceId, parsed.input.campaignId, parsed.occurredAt]
          )
        }
        const existing = await client.query<ProductionWorkflowRow>(
          `SELECT *
             FROM appsea.production_collection_workflow_jobs
            WHERE workspace_id = $1
              AND (workflow_id = $2 OR idempotency_digest = $3)
            ORDER BY workflow_id
            FOR UPDATE`,
          [parsed.input.workspaceId, parsed.execution.workflowId, parsed.input.idempotencyDigest]
        )
        if (existing.rows.length > 0) {
          const row = existing.rows[0]!
          if (
            existing.rows.length !== 1 ||
            row.workflow_id !== parsed.execution.workflowId ||
            row.temporal_first_execution_run_id !== parsed.execution.temporalFirstExecutionRunId ||
            row.input_hash !== parsed.input.inputHash ||
            row.campaign_id !== parsed.input.campaignId ||
            row.requested_research_run_id !== parsed.input.runId ||
            row.source_id !== parsed.input.sourceId ||
            row.policy_version !== parsed.input.policyVersion ||
            row.analysis_seed_review_id !== (parsed.input.analysisSeedReviewId ?? null) ||
            row.recollection_tombstone_id !== (parsed.input.recollectionTombstoneId ?? null) ||
            row.requested_by_actor_type !== requestedBy.actorType ||
            row.requested_by_actor_id !== requestedBy.actorId ||
            row.workflow_type !== parsed.execution.workflowType ||
            row.workflow_version !== parsed.execution.workflowVersion ||
            row.task_queue !== parsed.execution.taskQueue
          ) {
            // Actor identity is immutable and is part of the persisted request boundary.
            throw new WorkflowJobConflictError()
          }
          assertProductionWorkflowAdmissionConsumed(
            await consumeProductionWorkflowAdmissionInTransaction(
              client,
              parsed.input.workspaceId,
              parsed.input.idempotencyDigest,
              parsed.input.inputHash
            )
          )
          return mapRow(row)
        }
        await client.query(
          `INSERT INTO appsea.production_collection_workflow_jobs
           (workspace_id, workflow_id, temporal_first_execution_run_id, workflow_type,
           workflow_version, task_queue, campaign_id, requested_research_run_id,
            source_id, policy_version, analysis_seed_review_id, recollection_tombstone_id,
            idempotency_digest, input_hash,
            requested_by_actor_type, requested_by_actor_id, state, checkpoint,
            budget_currency, max_source_items, max_cost_micros, max_activity_attempts,
            requested_at, started_at, updated_at)
         VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, 'running', 'initialized', $17, $18, $19, $20, $21, $21, $21)`,
          [
            parsed.input.workspaceId,
            parsed.execution.workflowId,
            parsed.execution.temporalFirstExecutionRunId,
            parsed.execution.workflowType,
            parsed.execution.workflowVersion,
            parsed.execution.taskQueue,
            parsed.input.campaignId,
            parsed.input.runId,
            parsed.input.sourceId,
            parsed.input.policyVersion,
            parsed.input.analysisSeedReviewId ?? null,
            parsed.input.recollectionTombstoneId ?? null,
            parsed.input.idempotencyDigest,
            parsed.input.inputHash,
            requestedBy.actorType,
            requestedBy.actorId,
            parsed.input.budget.currency,
            parsed.input.budget.maxSourceItems,
            parsed.input.budget.maxCostMicros,
            parsed.input.budget.maxActivityAttempts,
            parsed.input.requestedAt
          ]
        )
        assertProductionWorkflowAdmissionConsumed(
          await consumeProductionWorkflowAdmissionInTransaction(
            client,
            parsed.input.workspaceId,
            parsed.input.idempotencyDigest,
            parsed.input.inputHash
          )
        )
        await insertCheckpoint(
          client,
          productionCollectionWorkflowCheckpointWriteSchema.parse({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            checkpointKey: 'checkpoint:initialized',
            sequenceNo: 100,
            checkpoint: 'initialized',
            state: 'running',
            activityAttempt: 1,
            consumedSourceItems: 0,
            consumedCostMicros: 0,
            occurredAt: parsed.occurredAt
          })
        )
        const inserted = await readForUpdate(
          client,
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!inserted)
          throw new Error('Production workflow job could not be read after initialization')
        return mapRow(inserted)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async recordCheckpoint(
    input: ProductionCollectionWorkflowCheckpointWrite
  ): Promise<ReturnType<typeof mapRow>> {
    const parsed = productionCollectionWorkflowCheckpointWriteSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.workspaceId,
      async (client) => {
        const row = await readForUpdate(client, parsed.workspaceId, parsed.execution.workflowId)
        if (!row) throw new WorkflowJobStateError('Production workflow job is not initialized')
        assertIdentity(row, parsed.execution)
        if (['completed', 'failed', 'canceled', 'budget_rejected'].includes(row.state))
          return mapRow(row)
        await insertCheckpoint(client, parsed)
        const movingBackward =
          checkpointRanks[parsed.checkpoint] <
          checkpointRanks[
            row.checkpoint as ProductionCollectionWorkflowCheckpointWrite['checkpoint']
          ]
        if (
          movingBackward &&
          !(row.checkpoint === 'persisted' && parsed.checkpoint === 'persisting')
        ) {
          throw new WorkflowJobStateError('Production workflow checkpoint cannot move backward')
        }
        const projectedCheckpoint = movingBackward ? row.checkpoint : parsed.checkpoint
        await client.query(
          `UPDATE appsea.production_collection_workflow_jobs
              SET state = $3,
                  checkpoint = $4,
                  consumed_source_items = GREATEST(consumed_source_items, $5),
                  consumed_cost_micros = GREATEST(consumed_cost_micros, $6),
                  activity_attempts = GREATEST(activity_attempts, $7),
                  updated_at = GREATEST(updated_at, $8)
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            parsed.workspaceId,
            parsed.execution.workflowId,
            parsed.state,
            projectedCheckpoint,
            parsed.consumedSourceItems,
            parsed.consumedCostMicros,
            ['persisting', 'persisted'].includes(parsed.checkpoint)
              ? parsed.activityAttempt
              : row.activity_attempts,
            parsed.occurredAt
          ]
        )
        const updated = await readForUpdate(client, parsed.workspaceId, parsed.execution.workflowId)
        if (!updated) throw new Error('Production workflow job disappeared during checkpoint')
        return mapRow(updated)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async complete(
    input: ProductionCollectionWorkflowCompletionInput
  ): Promise<ReturnType<typeof mapRow>> {
    const parsed = productionCollectionWorkflowCompletionInputSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.workspaceId,
      async (client) => {
        const row = await readForUpdate(client, parsed.workspaceId, parsed.execution.workflowId)
        if (!row) throw new WorkflowJobStateError('Production workflow job is not initialized')
        assertIdentity(row, parsed.execution)
        const result = parsed.result
        if (
          result.persistence.workspaceId !== row.workspace_id ||
          result.persistence.campaignId !== row.campaign_id ||
          result.persistence.runId !== row.requested_research_run_id ||
          result.persistence.sourceId !== row.source_id ||
          result.persistence.policyVersion !== row.policy_version ||
          result.sourceItemsProcessed !== result.persistence.sourceItemCount
        )
          throw new WorkflowJobConflictError()
        if (row.state === 'completed') {
          if (row.persisted_run_id !== result.persistence.runId)
            throw new WorkflowJobConflictError()
          return mapRow(row)
        }
        if (row.state !== 'running' || row.checkpoint !== 'persisted') {
          throw new WorkflowJobStateError('Production workflow is not ready to complete')
        }
        await insertCheckpoint(
          client,
          productionCollectionWorkflowCheckpointWriteSchema.parse({
            execution: parsed.execution,
            workspaceId: parsed.workspaceId,
            checkpointKey: 'checkpoint:completed',
            sequenceNo: 900,
            checkpoint: 'completed',
            state: 'completed',
            activityAttempt: result.activityAttempt,
            consumedSourceItems: result.sourceItemsProcessed,
            consumedCostMicros: result.costMicros,
            occurredAt: parsed.occurredAt
          })
        )
        await client.query(
          `UPDATE appsea.production_collection_workflow_jobs
              SET state = 'completed', checkpoint = 'completed',
                  consumed_source_items = $3, consumed_cost_micros = $4,
                  activity_attempts = GREATEST(activity_attempts, $5),
                  persisted_run_id = $6, failure_code = NULL, failure_summary = NULL,
                  updated_at = GREATEST(updated_at, $7), finished_at = GREATEST(started_at, $7)
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            parsed.workspaceId,
            parsed.execution.workflowId,
            result.sourceItemsProcessed,
            result.costMicros,
            result.activityAttempt,
            result.persistence.runId,
            parsed.occurredAt
          ]
        )
        await client.query(
          `UPDATE appsea.research_campaigns
              SET state = 'completed', updated_at = GREATEST(updated_at, $3)
            WHERE workspace_id = $1 AND campaign_id = $2
              AND state <> 'archived'
              AND NOT EXISTS (
                SELECT 1
                  FROM appsea.research_campaign_orchestration_sources child
                 WHERE child.workspace_id = $1
                   AND child.child_run_id = $4
              )`,
          [parsed.workspaceId, row.campaign_id, parsed.occurredAt, result.persistence.runId]
        )
        if (row.analysis_seed_review_id) {
          const identity = productionAnalysisHandoffIdentity(
            parsed.workspaceId,
            result.persistence.runId,
            row.analysis_seed_review_id
          )
          await enqueueProductionAnalysisHandoffInTransaction(client, {
            workspaceId: parsed.workspaceId,
            handoffId: identity.handoffId,
            collectionWorkflowId: row.workflow_id,
            collectionRunId: result.persistence.runId,
            seedReviewId: row.analysis_seed_review_id,
            analysisRunId: identity.analysisRunId,
            idempotencyKey: identity.idempotencyKey,
            requestedAt: parsed.occurredAt
          })
        }
        await insertTerminalLedger(
          client,
          row,
          'completed',
          result.sourceItemsProcessed,
          result.costMicros,
          parsed.occurredAt,
          result.persistence.runId
        )
        const completed = await readForUpdate(
          client,
          parsed.workspaceId,
          parsed.execution.workflowId
        )
        if (!completed) throw new Error('Completed production workflow could not be read')
        return mapRow(completed)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async terminate(
    input: Parameters<typeof productionCollectionWorkflowTerminationInputSchema.parse>[0]
  ): Promise<ReturnType<typeof mapRow>> {
    const parsed = productionCollectionWorkflowTerminationInputSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.input.workspaceId,
      async (client) => {
        const row = await readForUpdate(
          client,
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!row) throw new WorkflowJobStateError('Production workflow job is not initialized')
        assertIdentity(row, parsed.execution)
        if (
          row.campaign_id !== parsed.input.campaignId ||
          row.requested_research_run_id !== parsed.input.runId ||
          row.source_id !== parsed.input.sourceId ||
          row.policy_version !== parsed.input.policyVersion ||
          row.idempotency_digest !== parsed.input.idempotencyDigest ||
          row.input_hash !== parsed.input.inputHash
        ) {
          throw new WorkflowJobConflictError()
        }
        if (row.state === 'completed') return mapRow(row)
        if (['failed', 'canceled', 'budget_rejected'].includes(row.state)) return mapRow(row)
        await insertCheckpoint(
          client,
          productionCollectionWorkflowCheckpointWriteSchema.parse({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            checkpointKey: `checkpoint:${parsed.state}`,
            sequenceNo: parsed.state === 'failed' ? 910 : parsed.state === 'canceled' ? 920 : 930,
            checkpoint: parsed.checkpoint,
            state: parsed.state,
            activityAttempt: Math.max(1, row.activity_attempts),
            consumedSourceItems: parsed.consumedSourceItems,
            consumedCostMicros: parsed.consumedCostMicros,
            occurredAt: parsed.occurredAt
          })
        )
        await client.query(
          `UPDATE appsea.production_collection_workflow_jobs
              SET state = $3, checkpoint = $4,
                  consumed_source_items = GREATEST(consumed_source_items, $5),
                  consumed_cost_micros = GREATEST(consumed_cost_micros, $6),
                  failure_code = $7, failure_summary = $8,
                  updated_at = GREATEST(updated_at, $9), finished_at = GREATEST(started_at, $9)
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            parsed.input.workspaceId,
            parsed.execution.workflowId,
            parsed.state,
            parsed.checkpoint,
            parsed.consumedSourceItems,
            parsed.consumedCostMicros,
            parsed.failureCode,
            parsed.failureSummary,
            parsed.occurredAt
          ]
        )
        await client.query(
          `UPDATE appsea.research_campaigns
              SET state = CASE WHEN state = 'completed' THEN state ELSE $3 END,
                  updated_at = GREATEST(updated_at, $4)
            WHERE workspace_id = $1 AND campaign_id = $2
              AND state <> 'archived'
              AND NOT EXISTS (
                SELECT 1
                  FROM appsea.research_campaign_orchestration_sources child
                 WHERE child.workspace_id = $1
                   AND child.child_run_id = $5
              )`,
          [
            parsed.input.workspaceId,
            row.campaign_id,
            parsed.state === 'canceled' ? 'canceled' : 'failed',
            parsed.occurredAt,
            parsed.input.runId
          ]
        )
        await insertTerminalLedger(
          client,
          row,
          parsed.state,
          parsed.consumedSourceItems,
          parsed.consumedCostMicros,
          parsed.occurredAt,
          null
        )
        const terminated = await readForUpdate(
          client,
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!terminated) throw new Error('Terminated production workflow could not be read')
        return mapRow(terminated)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    workflowId: string
  ): Promise<ReturnType<typeof mapRow> | null> {
    const result = await client.query<ProductionWorkflowRow>(
      `SELECT job.*
         FROM appsea.production_collection_workflow_jobs job
         JOIN appsea.workspaces workspace
           ON workspace.workspace_id = job.workspace_id
        WHERE job.workspace_id = $1 AND job.workflow_id = $2
          AND workspace.status = 'active'
          AND workspace.visibility = 'private'
          AND workspace.fixture_only = false`,
      [workspaceId, workflowId]
    )
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }

  async read(workspaceId: string, workflowId: string): Promise<ReturnType<typeof mapRow> | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      (client) => this.readInTransaction(client, workspaceId, workflowId),
      { readOnly: true }
    )
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    workflowId: string
  ): Promise<ReturnType<typeof mapRow> | null> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      (client) => this.readInTransaction(client, workspaceId, workflowId),
      { readOnly: true }
    )
  }

  async listForCampaignForUser(
    userId: string,
    workspaceId: string,
    campaignId: string
  ): Promise<ResearchCampaignRunReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<ProductionWorkflowRow>(
          `SELECT job.*
             FROM appsea.production_collection_workflow_jobs job
             JOIN appsea.workspaces workspace
               ON workspace.workspace_id = job.workspace_id
            WHERE job.workspace_id = $1
              AND job.campaign_id = $2
              AND workspace.status = 'active'
              AND workspace.visibility = 'private'
              AND workspace.fixture_only = false
            ORDER BY job.requested_at DESC, job.workflow_id
            LIMIT 100`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        return result.rows.map(mapCampaignRun)
      },
      { readOnly: true }
    )
  }
}

function productionCollectionWorkflowWorkflowHashMaterial(
  value: Omit<ProductionCollectionWorkflowInput, 'inputHash'>
): Omit<ProductionCollectionWorkflowInput, 'inputHash'> {
  return productionCollectionWorkflowHashMaterialSchema.parse(value)
}

export type ProductionCollectionWorkflowPersistenceResult =
  ProductionCollectionWorkflowPersistenceActivityResult
