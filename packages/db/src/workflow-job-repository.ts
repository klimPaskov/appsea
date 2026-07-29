import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  fixtureResearchWorkflowHashMaterialSchema,
  workflowJobCheckpointWriteSchema,
  workflowJobCompletionInputSchema,
  workflowJobInitializeInputSchema,
  workflowJobReadModelSchema,
  workflowJobTerminationInputSchema,
  type WorkflowExecutionMetadata,
  type WorkflowActor,
  type WorkflowJobCheckpoint,
  type WorkflowJobCheckpointWrite,
  type WorkflowJobCompletionInput,
  type WorkflowJobInitializeInput,
  type WorkflowJobReadModel,
  type WorkflowJobTerminationInput
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withWorkspaceTransaction } from './transaction'

export class WorkflowJobConflictError extends Error {
  constructor() {
    super('Workflow job identity was already used for different input')
    this.name = 'WorkflowJobConflictError'
  }
}

export class WorkflowCheckpointConflictError extends Error {
  constructor() {
    super('Workflow checkpoint identity was already used for different content')
    this.name = 'WorkflowCheckpointConflictError'
  }
}

export class WorkflowJobStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowJobStateError'
  }
}

interface WorkflowJobRow extends QueryResultRow {
  workspace_id: string
  workflow_id: string
  temporal_first_execution_run_id: string
  workflow_type: string
  workflow_version: string
  task_queue: string
  campaign_id: string
  requested_research_run_id: string
  requested_by_actor_type: WorkflowActor['actorType']
  requested_by_actor_id: string
  idempotency_digest: string
  input_hash: string
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
  opportunity_id: string | null
  score_snapshot_id: string | null
  plan_package_id: string | null
  failure_code: string | null
  failure_summary: string | null
  requested_at: Date | string
  started_at: Date | string
  updated_at: Date | string
  finished_at: Date | string | null
}

interface StoredCheckpointHashRow extends QueryResultRow {
  content_hash: string
}

export interface WorkflowJobCheckpointRecord {
  checkpointKey: string
  sequenceNo: number
  checkpoint: WorkflowJobCheckpoint
  state: WorkflowJobReadModel['state']
  activityAttempt: number
  consumedSourceItems: number
  consumedCostMicros: number
  occurredAt: string
}

const checkpointRanks: Record<WorkflowJobCheckpoint, number> = {
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

function asIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function asNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : asIsoString(value)
}

function workspaceSlug(workspaceId: string): string {
  return `workflow-${contentHash(workspaceId).slice(0, 32)}`
}

function workflowActorParts(actor: WorkflowActor | undefined): WorkflowActor {
  return actor ?? { actorType: 'service', actorId: 'appsea-worker' }
}

function mapWorkflowJob(row: WorkflowJobRow): WorkflowJobReadModel {
  return workflowJobReadModelSchema.parse({
    workspaceId: row.workspace_id,
    workflowId: row.workflow_id,
    temporalFirstExecutionRunId: row.temporal_first_execution_run_id,
    workflowType: row.workflow_type,
    workflowVersion: row.workflow_version,
    taskQueue: row.task_queue,
    campaignId: row.campaign_id,
    requestedResearchRunId: row.requested_research_run_id,
    requestedBy: {
      actorType: row.requested_by_actor_type,
      actorId: row.requested_by_actor_id
    },
    idempotencyDigest: row.idempotency_digest,
    inputHash: row.input_hash,
    state: row.state,
    checkpoint: row.checkpoint,
    budget: {
      currency: row.budget_currency,
      maxSourceItems: row.max_source_items,
      maxCostMicros: Number(row.max_cost_micros),
      maxActivityAttempts: row.max_activity_attempts
    },
    consumedSourceItems: row.consumed_source_items,
    consumedCostMicros: Number(row.consumed_cost_micros),
    activityAttempts: row.activity_attempts,
    persistedRunId: row.persisted_run_id,
    opportunityId: row.opportunity_id,
    scoreSnapshotId: row.score_snapshot_id,
    planPackageId: row.plan_package_id,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    requestedAt: asIsoString(row.requested_at),
    startedAt: asIsoString(row.started_at),
    updatedAt: asIsoString(row.updated_at),
    finishedAt: asNullableIsoString(row.finished_at)
  })
}

async function readJobForUpdate(
  client: PoolClient,
  workspaceId: string,
  workflowId: string
): Promise<WorkflowJobRow | undefined> {
  const result = await client.query<WorkflowJobRow>(
    `SELECT *
       FROM appsea.workflow_job_executions
      WHERE workspace_id = $1 AND workflow_id = $2
      FOR UPDATE`,
    [workspaceId, workflowId]
  )
  return result.rows[0]
}

async function readJobByIdentityForUpdate(
  client: PoolClient,
  workspaceId: string,
  workflowId: string,
  idempotencyDigest: string
): Promise<WorkflowJobRow[]> {
  const result = await client.query<WorkflowJobRow>(
    `SELECT *
       FROM appsea.workflow_job_executions
      WHERE workspace_id = $1
        AND (workflow_id = $2 OR idempotency_digest = $3)
      ORDER BY workflow_id
      FOR UPDATE`,
    [workspaceId, workflowId, idempotencyDigest]
  )
  return result.rows
}

function assertExecutionIdentity(row: WorkflowJobRow, execution: WorkflowExecutionMetadata): void {
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
  checkpoint: WorkflowJobCheckpointWrite
): Promise<void> {
  const checkpointHash = contentHash(checkpoint)
  await client.query(
    `INSERT INTO appsea.workflow_job_checkpoints
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
      checkpointHash,
      checkpoint.occurredAt
    ]
  )
  const stored = await client.query<StoredCheckpointHashRow>(
    `SELECT content_hash
       FROM appsea.workflow_job_checkpoints
      WHERE workspace_id = $1 AND workflow_id = $2 AND checkpoint_key = $3`,
    [checkpoint.workspaceId, checkpoint.execution.workflowId, checkpoint.checkpointKey]
  )
  if (stored.rows[0]?.content_hash !== checkpointHash) {
    throw new WorkflowCheckpointConflictError()
  }
}

function eventIdentifier(prefix: string, workspaceId: string, workflowId: string): string {
  return `${prefix}:workflow:${contentHash({ workspaceId, workflowId }).slice(0, 32)}`
}

async function insertTerminalLedger(
  client: PoolClient,
  job: WorkflowJobRow,
  state: WorkflowJobReadModel['state'],
  sourceItems: number,
  costMicros: number,
  occurredAt: string,
  persistedRunId: string | null
): Promise<void> {
  const identity = { workspaceId: job.workspace_id, workflowId: job.workflow_id }
  const eventPayload = {
    workflowId: job.workflow_id,
    workflowType: job.workflow_type,
    workflowVersion: job.workflow_version,
    campaignId: job.campaign_id,
    requestedResearchRunId: job.requested_research_run_id,
    requestedBy: {
      actorType: job.requested_by_actor_type,
      actorId: job.requested_by_actor_id
    },
    state,
    sourceItems,
    costMicros
  }
  await client.query(
    `INSERT INTO appsea.cost_ledger_entries
       (workspace_id, cost_entry_id, campaign_id, run_id, cost_type, quantity, unit,
        amount, currency, estimate, recorded_at)
     VALUES ($1, $2, $3, $4, 'fixture_workflow', $5, 'source_item', $6, 'USD', false, $7)
     ON CONFLICT DO NOTHING`,
    [
      job.workspace_id,
      eventIdentifier('cost', identity.workspaceId, identity.workflowId),
      job.campaign_id,
      persistedRunId,
      sourceItems,
      (costMicros / 1_000_000).toFixed(6),
      occurredAt
    ]
  )
  await client.query(
    `INSERT INTO appsea.audit_events
       (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
        target_id, correlation_id, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, 'workflow_job', $6, $6, $7::jsonb, $8)
     ON CONFLICT DO NOTHING`,
    [
      job.workspace_id,
      eventIdentifier('audit', identity.workspaceId, identity.workflowId),
      job.requested_by_actor_type,
      job.requested_by_actor_id,
      `workflow.job.${state}`,
      job.workflow_id,
      JSON.stringify(eventPayload),
      occurredAt
    ]
  )
  await client.query(
    `INSERT INTO appsea.outbox_events
       (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
        schema_version, correlation_id, payload, occurred_at)
     VALUES ($1, $2, $3, 'workflow_job', $4, 'workflow-job-v1', $4, $5::jsonb, $6)
     ON CONFLICT DO NOTHING`,
    [
      job.workspace_id,
      eventIdentifier('outbox', identity.workspaceId, identity.workflowId),
      `workflow.job.${state}`,
      job.workflow_id,
      JSON.stringify(eventPayload),
      occurredAt
    ]
  )
}

export class PostgresWorkflowJobRepository {
  constructor(private readonly pool: Pool) {}

  async initialize(input: WorkflowJobInitializeInput): Promise<WorkflowJobReadModel> {
    const parsed = workflowJobInitializeInputSchema.parse(input)
    const { inputHash, ...hashMaterialCandidate } = parsed.input
    const hashMaterial = fixtureResearchWorkflowHashMaterialSchema.parse(hashMaterialCandidate)
    if (
      inputHash !== contentHash(hashMaterial) ||
      parsed.execution.workflowVersion !== parsed.input.workflowVersion
    ) {
      throw new WorkflowJobConflictError()
    }
    const requestedBy = workflowActorParts(parsed.input.requestedBy)

    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsed.input.workspaceId,
        async (client) => {
          if (process.env.NODE_ENV === 'production') {
            const provisioned = await client.query(
              `SELECT workspace_id
                 FROM appsea.workspaces
                WHERE workspace_id = $1
                FOR UPDATE`,
              [parsed.input.workspaceId]
            )
            if (!provisioned.rows[0]) {
              throw new WorkflowJobStateError(
                'Production fixture workflow workspaces must be provisioned before execution'
              )
            }
          } else {
            await client.query(
              `INSERT INTO appsea.workspaces
               (workspace_id, slug, display_name, visibility, fixture_only, status,
                created_at, updated_at)
             VALUES ($1, $2, 'Fixture workflow workspace', 'private', true, 'active', $3, $3)
             ON CONFLICT (workspace_id) DO UPDATE
               SET updated_at = GREATEST(appsea.workspaces.updated_at, EXCLUDED.updated_at)`,
              [parsed.input.workspaceId, workspaceSlug(parsed.input.workspaceId), parsed.occurredAt]
            )
          }
          const workspace = await client.query<
            QueryResultRow & { fixture_only: boolean; status: string }
          >(
            `SELECT fixture_only, status
               FROM appsea.workspaces
              WHERE workspace_id = $1
              FOR UPDATE`,
            [parsed.input.workspaceId]
          )
          const workspaceRow = workspace.rows[0]
          if (!workspaceRow?.fixture_only || workspaceRow.status !== 'active') {
            throw new WorkflowJobStateError('Workflow workspace is not active and fixture-enabled')
          }

          const existing = await readJobByIdentityForUpdate(
            client,
            parsed.input.workspaceId,
            parsed.execution.workflowId,
            parsed.input.idempotencyDigest
          )
          if (existing.length > 0) {
            const row = existing[0]!
            if (
              existing.length !== 1 ||
              row.workflow_id !== parsed.execution.workflowId ||
              row.idempotency_digest !== parsed.input.idempotencyDigest ||
              row.input_hash !== parsed.input.inputHash ||
              row.campaign_id !== parsed.input.campaignId ||
              row.requested_research_run_id !== parsed.input.runId ||
              row.requested_by_actor_type !== requestedBy.actorType ||
              row.requested_by_actor_id !== requestedBy.actorId
            ) {
              throw new WorkflowJobConflictError()
            }
            assertExecutionIdentity(row, parsed.execution)
            return mapWorkflowJob(row)
          }

          const campaign = await client.query<QueryResultRow & { state: string; budget: unknown }>(
            `SELECT state, budget
               FROM appsea.research_campaigns
              WHERE workspace_id = $1 AND campaign_id = $2
              FOR UPDATE`,
            [parsed.input.workspaceId, parsed.input.campaignId]
          )
          const campaignRow = campaign.rows[0]
          if (!campaignRow) {
            await client.query(
              `INSERT INTO appsea.research_campaigns
               (workspace_id, campaign_id, name, purpose, state, configuration, budget,
                synthetic, created_at, updated_at)
             VALUES ($1, $2, 'Durable fixture research', 'internal_quality', 'running',
                     $3::jsonb, $4::jsonb, true, $5, $5)`,
              [
                parsed.input.workspaceId,
                parsed.input.campaignId,
                JSON.stringify({
                  mode: 'fixture',
                  workflowType: parsed.execution.workflowType,
                  workflowVersion: parsed.execution.workflowVersion,
                  fixtureAt: parsed.input.fixtureAt
                }),
                JSON.stringify(parsed.input.budget),
                parsed.occurredAt
              ]
            )
          } else {
            if (!['draft', 'validated', 'queued', 'running'].includes(campaignRow.state)) {
              throw new WorkflowJobStateError(
                `Research campaign is ${campaignRow.state} and cannot be started`
              )
            }
            if (contentHash(campaignRow.budget) !== contentHash(parsed.input.budget)) {
              throw new WorkflowJobConflictError()
            }
            await client.query(
              `UPDATE appsea.research_campaigns
                  SET state = 'running', updated_at = GREATEST(updated_at, $3)
                WHERE workspace_id = $1 AND campaign_id = $2`,
              [parsed.input.workspaceId, parsed.input.campaignId, parsed.occurredAt]
            )
          }

          await client.query(
            `INSERT INTO appsea.workflow_job_executions
             (workspace_id, workflow_id, temporal_first_execution_run_id, workflow_type,
             workflow_version, task_queue, campaign_id, requested_research_run_id,
              requested_by_actor_type, requested_by_actor_id, idempotency_digest, input_hash,
              state, checkpoint, budget_currency,
              max_source_items, max_cost_micros, max_activity_attempts, requested_at,
              started_at, updated_at)
           VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   'running', 'initialized', $13, $14, $15, $16, $17, $17, $17)`,
            [
              parsed.input.workspaceId,
              parsed.execution.workflowId,
              parsed.execution.temporalFirstExecutionRunId,
              parsed.execution.workflowType,
              parsed.execution.workflowVersion,
              parsed.execution.taskQueue,
              parsed.input.campaignId,
              parsed.input.runId,
              requestedBy.actorType,
              requestedBy.actorId,
              parsed.input.idempotencyDigest,
              parsed.input.inputHash,
              parsed.input.budget.currency,
              parsed.input.budget.maxSourceItems,
              parsed.input.budget.maxCostMicros,
              parsed.input.budget.maxActivityAttempts,
              parsed.occurredAt
            ]
          )

          await insertCheckpoint(
            client,
            workflowJobCheckpointWriteSchema.parse({
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
          const inserted = await readJobForUpdate(
            client,
            parsed.input.workspaceId,
            parsed.execution.workflowId
          )
          if (!inserted) throw new Error('Initialized workflow job could not be read')
          return mapWorkflowJob(inserted)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== '23505'
      ) {
        throw error
      }
      const existing = await this.read(parsed.input.workspaceId, parsed.execution.workflowId)
      if (
        existing &&
        existing.temporalFirstExecutionRunId === parsed.execution.temporalFirstExecutionRunId &&
        existing.workflowType === parsed.execution.workflowType &&
        existing.workflowVersion === parsed.execution.workflowVersion &&
        existing.taskQueue === parsed.execution.taskQueue &&
        existing.campaignId === parsed.input.campaignId &&
        existing.requestedResearchRunId === parsed.input.runId &&
        existing.requestedBy.actorType === requestedBy.actorType &&
        existing.requestedBy.actorId === requestedBy.actorId &&
        existing.idempotencyDigest === parsed.input.idempotencyDigest &&
        existing.inputHash === parsed.input.inputHash
      ) {
        return existing
      }
      throw new WorkflowJobConflictError()
    }
  }

  async recordCheckpoint(input: WorkflowJobCheckpointWrite): Promise<WorkflowJobReadModel> {
    const parsed = workflowJobCheckpointWriteSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.workspaceId,
      async (client) => {
        const row = await readJobForUpdate(client, parsed.workspaceId, parsed.execution.workflowId)
        if (!row) throw new WorkflowJobStateError('Workflow job is not initialized')
        assertExecutionIdentity(row, parsed.execution)
        if (['completed', 'failed', 'canceled', 'budget_rejected'].includes(row.state)) {
          return mapWorkflowJob(row)
        }

        await insertCheckpoint(client, parsed)
        const currentCheckpoint = row.checkpoint as WorkflowJobCheckpoint
        const movingBackward =
          checkpointRanks[parsed.checkpoint] < checkpointRanks[currentCheckpoint]
        if (
          movingBackward &&
          !(currentCheckpoint === 'persisted' && parsed.checkpoint === 'persisting')
        ) {
          throw new WorkflowJobStateError('Workflow checkpoint cannot move backward')
        }
        const projectedCheckpoint = movingBackward ? currentCheckpoint : parsed.checkpoint
        const tracksPersistenceAttempt = ['persisting', 'persisted'].includes(parsed.checkpoint)
        await client.query(
          `UPDATE appsea.workflow_job_executions
              SET state = $3,
                  checkpoint = $4,
                  consumed_source_items = GREATEST(consumed_source_items, $5),
                  consumed_cost_micros = GREATEST(consumed_cost_micros, $6),
                  activity_attempts = CASE
                    WHEN $7 THEN GREATEST(activity_attempts, $8)
                    ELSE activity_attempts
                  END,
                  updated_at = GREATEST(updated_at, $9)
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            parsed.workspaceId,
            parsed.execution.workflowId,
            parsed.state,
            projectedCheckpoint,
            parsed.consumedSourceItems,
            parsed.consumedCostMicros,
            tracksPersistenceAttempt,
            parsed.activityAttempt,
            parsed.occurredAt
          ]
        )
        const updated = await readJobForUpdate(
          client,
          parsed.workspaceId,
          parsed.execution.workflowId
        )
        if (!updated) throw new Error('Updated workflow job could not be read')
        return mapWorkflowJob(updated)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async complete(input: WorkflowJobCompletionInput): Promise<WorkflowJobReadModel> {
    const parsed = workflowJobCompletionInputSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.workspaceId,
      async (client) => {
        const row = await readJobForUpdate(client, parsed.workspaceId, parsed.execution.workflowId)
        if (!row) throw new WorkflowJobStateError('Workflow job is not initialized')
        assertExecutionIdentity(row, parsed.execution)
        const result = parsed.result
        if (
          result.persistence.workspaceId !== row.workspace_id ||
          result.persistence.campaignId !== row.campaign_id ||
          result.persistence.runId !== row.requested_research_run_id ||
          result.sourceItemsProcessed !== result.persistence.sourceItemCount
        ) {
          throw new WorkflowJobConflictError()
        }
        if (row.state === 'completed') {
          if (
            row.persisted_run_id !== result.persistence.runId ||
            row.opportunity_id !== result.persistence.opportunityId ||
            row.score_snapshot_id !== result.persistence.scoreSnapshotId ||
            row.plan_package_id !== result.persistence.planPackageId
          ) {
            throw new WorkflowJobConflictError()
          }
          return mapWorkflowJob(row)
        }
        if (row.state !== 'running') {
          throw new WorkflowJobStateError('Only a running workflow job can complete')
        }
        if (row.checkpoint !== 'persisted') {
          throw new WorkflowJobStateError('Workflow persistence checkpoint is missing')
        }

        const completionCheckpoint = workflowJobCheckpointWriteSchema.parse({
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
        await insertCheckpoint(client, completionCheckpoint)
        await client.query(
          `UPDATE appsea.workflow_job_executions
              SET state = 'completed',
                  checkpoint = 'completed',
                  consumed_source_items = $3,
                  consumed_cost_micros = $4,
                  activity_attempts = GREATEST(activity_attempts, $5),
                  persisted_run_id = $6,
                  opportunity_id = $7,
                  score_snapshot_id = $8,
                  plan_package_id = $9,
                  failure_code = NULL,
                  failure_summary = NULL,
                  updated_at = GREATEST(updated_at, $10),
                  finished_at = GREATEST(started_at, $10)
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            parsed.workspaceId,
            parsed.execution.workflowId,
            result.sourceItemsProcessed,
            result.costMicros,
            result.activityAttempt,
            result.persistence.runId,
            result.persistence.opportunityId,
            result.persistence.scoreSnapshotId,
            result.persistence.planPackageId,
            parsed.occurredAt
          ]
        )
        await client.query(
          `UPDATE appsea.research_campaigns
              SET state = 'completed', updated_at = GREATEST(updated_at, $3)
            WHERE workspace_id = $1 AND campaign_id = $2`,
          [parsed.workspaceId, row.campaign_id, parsed.occurredAt]
        )
        await insertTerminalLedger(
          client,
          row,
          'completed',
          result.sourceItemsProcessed,
          result.costMicros,
          parsed.occurredAt,
          result.persistence.runId
        )
        const completed = await readJobForUpdate(
          client,
          parsed.workspaceId,
          parsed.execution.workflowId
        )
        if (!completed) throw new Error('Completed workflow job could not be read')
        return mapWorkflowJob(completed)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async terminate(input: WorkflowJobTerminationInput): Promise<WorkflowJobReadModel> {
    const parsed = workflowJobTerminationInputSchema.parse(input)
    return withWorkspaceTransaction(
      this.pool,
      parsed.input.workspaceId,
      async (client) => {
        const row = await readJobForUpdate(
          client,
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!row) throw new WorkflowJobStateError('Workflow job is not initialized')
        assertExecutionIdentity(row, parsed.execution)
        if (
          row.campaign_id !== parsed.input.campaignId ||
          row.requested_research_run_id !== parsed.input.runId ||
          row.idempotency_digest !== parsed.input.idempotencyDigest ||
          row.input_hash !== parsed.input.inputHash
        ) {
          throw new WorkflowJobConflictError()
        }
        if (row.state === 'completed') return mapWorkflowJob(row)
        if (row.state === parsed.state) {
          if (
            row.failure_code !== parsed.failureCode ||
            row.failure_summary !== parsed.failureSummary
          ) {
            throw new WorkflowJobConflictError()
          }
          return mapWorkflowJob(row)
        }
        if (['failed', 'canceled', 'budget_rejected'].includes(row.state)) {
          throw new WorkflowJobStateError('Workflow job already has a different terminal state')
        }

        const committedRun = await client.query<{ state: string }>(
          `SELECT state
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2`,
          [parsed.input.workspaceId, row.requested_research_run_id]
        )
        if (committedRun.rows[0]?.state === 'completed') {
          throw new WorkflowJobStateError(
            'Committed research must be reconciled before termination'
          )
        }

        const terminalSequence = {
          failed: 910,
          canceled: 920,
          budget_rejected: 930
        }[parsed.state]
        await insertCheckpoint(
          client,
          workflowJobCheckpointWriteSchema.parse({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            checkpointKey: `checkpoint:${parsed.state}`,
            sequenceNo: terminalSequence,
            checkpoint: parsed.checkpoint,
            state: parsed.state,
            activityAttempt: Math.max(1, row.activity_attempts),
            consumedSourceItems: parsed.consumedSourceItems,
            consumedCostMicros: parsed.consumedCostMicros,
            occurredAt: parsed.occurredAt
          })
        )
        await client.query(
          `UPDATE appsea.workflow_job_executions
              SET state = $3,
                  checkpoint = $4,
                  consumed_source_items = GREATEST(consumed_source_items, $5),
                  consumed_cost_micros = GREATEST(consumed_cost_micros, $6),
                  failure_code = $7,
                  failure_summary = $8,
                  updated_at = GREATEST(updated_at, $9),
                  finished_at = GREATEST(started_at, $9)
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
        const campaignState = parsed.state === 'canceled' ? 'canceled' : 'failed'
        await client.query(
          `UPDATE appsea.research_campaigns
              SET state = CASE WHEN state = 'completed' THEN state ELSE $3 END,
                  updated_at = GREATEST(updated_at, $4)
            WHERE workspace_id = $1 AND campaign_id = $2`,
          [parsed.input.workspaceId, row.campaign_id, campaignState, parsed.occurredAt]
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
        const terminated = await readJobForUpdate(
          client,
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!terminated) throw new Error('Terminated workflow job could not be read')
        return mapWorkflowJob(terminated)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async read(workspaceId: string, workflowId: string): Promise<WorkflowJobReadModel | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query<WorkflowJobRow>(
          `SELECT *
             FROM appsea.workflow_job_executions
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [workspaceId, workflowId]
        )
        return result.rows[0] ? mapWorkflowJob(result.rows[0]) : null
      },
      { readOnly: true }
    )
  }

  async listCheckpoints(
    workspaceId: string,
    workflowId: string
  ): Promise<WorkflowJobCheckpointRecord[]> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query<{
          checkpoint_key: string
          sequence_no: number
          checkpoint: WorkflowJobCheckpoint
          state: WorkflowJobReadModel['state']
          activity_attempt: number
          consumed_source_items: number
          consumed_cost_micros: string
          occurred_at: Date | string
        }>(
          `SELECT checkpoint_key, sequence_no, checkpoint, state, activity_attempt,
                  consumed_source_items, consumed_cost_micros, occurred_at
             FROM appsea.workflow_job_checkpoints
            WHERE workspace_id = $1 AND workflow_id = $2
            ORDER BY sequence_no`,
          [workspaceId, workflowId]
        )
        return result.rows.map((row) => ({
          checkpointKey: row.checkpoint_key,
          sequenceNo: row.sequence_no,
          checkpoint: row.checkpoint,
          state: row.state,
          activityAttempt: row.activity_attempt,
          consumedSourceItems: row.consumed_source_items,
          consumedCostMicros: Number(row.consumed_cost_micros),
          occurredAt: asIsoString(row.occurred_at)
        }))
      },
      { readOnly: true }
    )
  }
}
