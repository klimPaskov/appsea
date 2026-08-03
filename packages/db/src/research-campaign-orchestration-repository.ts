import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  campaignHistoryPageQuerySchema,
  maintenanceSchedulerLeaseTokenSchema,
  maintenanceSchedulerOwnerIdSchema,
  researchCampaignConfigurationSchema,
  researchCampaignOrchestrationFailureCodeSchema,
  researchCampaignOrchestrationReadModelSchema,
  researchCampaignOrchestrationHistoryPageSchema,
  researchCampaignOrchestrationSourceReadModelSchema,
  researchCampaignRunInputSchema,
  researchJobBudgetSchema,
  type MaintenanceSchedulerFence,
  type ResearchCampaignConfiguration,
  type ResearchCampaignOrchestrationFailureCode,
  type ResearchCampaignOrchestrationReadModel,
  type CampaignHistoryPageQuery,
  type ResearchCampaignOrchestrationSourceReadModel,
  type ResearchCampaignRunInput,
  type ResearchJobBudget
} from '@appsea/contracts'
import { contentHash } from './hash'
import {
  withAuthenticatedWorkspaceTransaction,
  withDatabaseTransaction,
  withServiceWorkspaceTransaction
} from './transaction'
import {
  decodeCampaignHistoryCursor,
  encodeCampaignHistoryCursor
} from './campaign-history-pagination'

interface OrchestrationRow extends QueryResultRow {
  workspace_id: string
  orchestration_id: string
  campaign_id: string
  idempotency_digest: string
  input_hash: string
  requested_by_actor_type: 'user' | 'service'
  requested_by_actor_id: string
  analysis_seed_review_id: string | null
  state: string
  source_count: number | string
  completed_source_count: number | string
  failed_source_count: number | string
  failure_code: string | null
  failure_summary: string | null
  requested_at: Date | string
  started_at: Date | string | null
  updated_at: Date | string
  finished_at: Date | string | null
  cancellation_requested_at: Date | string | null
  cancellation_requested_by: string | null
  cancellation_request_id: string | null
}

interface OrchestrationSourceRow extends QueryResultRow {
  workspace_id: string
  orchestration_id: string
  source_id: string
  child_run_id: string
  state: string
  policy_version: string | null
  workflow_id: string | null
  attempt_count: number | string
  claim_owner: string | null
  claim_token: string | null
  claim_until: Date | string | null
  next_attempt_at: Date | string | null
  failure_code: string | null
  failure_summary: string | null
  requested_at: Date | string
  started_at: Date | string | null
  updated_at: Date | string
  finished_at: Date | string | null
}

interface CampaignDispatchRow extends QueryResultRow {
  workspace_id: string
  orchestration_id: string
  campaign_id: string
  purpose: string
  configuration: unknown
  budget: unknown
  analysis_seed_review_id: string | null
  requested_at: Date | string
  source_id: string
  child_run_id: string
  attempt_count: number | string
  policy_version: string | null
  workflow_id: string | null
  claim_owner: string | null
  claim_token: string | null
}

interface WorkflowObservationRow extends QueryResultRow {
  source_state: string | null
  child_workflow_id: string | null
  job_workflow_id: string | null
  workflow_policy_version: string | null
  workflow_started_at: Date | string | null
  workflow_finished_at: Date | string | null
  workflow_failure_code: string | null
}

export interface ResearchCampaignOrchestrationClaim {
  workspaceId: string
  orchestrationId: string
  campaignId: string
  sourceId: string
  childRunId: string
  purpose: string
  configuration: ResearchCampaignConfiguration
  budget: ResearchJobBudget
  analysisSeedReviewId: string | null
  requestedAt: string
  attemptCount: number
  policyVersion: string | null
  workflowId: string | null
}

export interface ResearchCampaignOrchestrationDispatch {
  workspaceId: string
  orchestrationId: string
  sourceId: string
  claimOwner: string
  claimToken: string
  childRunId: string
  workflowId: string
  policyVersion: string
  startedAt: string
  fence?: MaintenanceSchedulerFence
}

export interface ResearchCampaignOrchestrationFailure {
  workspaceId: string
  orchestrationId: string
  sourceId: string
  claimOwner: string
  claimToken: string
  failureCode: ResearchCampaignOrchestrationFailureCode
  failureSummary: string
  retryAfterSeconds: number
  terminal: boolean
  fence?: MaintenanceSchedulerFence
}

export interface ResearchCampaignOrchestrationCancellationResult {
  orchestrationId: string
  campaignId: string
  state: 'requested' | 'already_terminal'
  cancellationRequestedAt: string | null
  activeWorkflowIds: string[]
}

export interface ResearchCampaignOrchestrationCancellationTarget {
  workspaceId: string
  orchestrationId: string
  activeWorkflowIds: string[]
  pendingSourcesCanceled: number
}

export class ResearchCampaignOrchestrationPermissionError extends Error {
  constructor() {
    super('The workspace role cannot manage a research campaign orchestration')
    this.name = 'ResearchCampaignOrchestrationPermissionError'
  }
}

export class ResearchCampaignOrchestrationConflictError extends Error {
  constructor() {
    super('Campaign orchestration identifier or idempotency key conflicts with existing state')
    this.name = 'ResearchCampaignOrchestrationConflictError'
  }
}

export class ResearchCampaignOrchestrationSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResearchCampaignOrchestrationSourceError'
  }
}

export class ResearchCampaignOrchestrationStateError extends Error {
  constructor(message = 'The campaign orchestration state does not allow this operation') {
    super(message)
    this.name = 'ResearchCampaignOrchestrationStateError'
  }
}

export class ResearchCampaignOrchestrationClaimLostError extends Error {
  constructor() {
    super('The campaign orchestration source claim is no longer owned by this worker')
    this.name = 'ResearchCampaignOrchestrationClaimLostError'
  }
}

function asIso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
}

function safeServerTimestamp(requestedAt: string): string {
  const requestedMillis = Date.parse(requestedAt)
  if (!Number.isFinite(requestedMillis)) throw new Error('requestedAt is not a valid timestamp')
  return new Date(Math.max(Date.now(), requestedMillis)).toISOString()
}

function actorRole(client: PoolClient, workspaceId: string, userId: string): Promise<string> {
  return client
    .query<{ role: string }>(
      `SELECT role
         FROM appsea.workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2
        FOR SHARE`,
      [workspaceId, userId]
    )
    .then((result) => result.rows[0]?.role ?? '')
}

function orchestrationIdempotencyDigest(workspaceId: string, idempotencyKey: string): string {
  return contentHash({
    endpoint: 'research-campaign-orchestration',
    workflowType: 'researchCampaignOrchestration',
    workflowVersion: 'campaign-orchestration-v1',
    workspaceId,
    idempotencyKey
  })
}

function orchestrationInputHash(input: {
  workspaceId: string
  campaignId: string
  orchestrationId: string
  idempotencyDigest: string
  purpose: string
  configuration: ResearchCampaignConfiguration
  budget: ResearchJobBudget
  analysisSeedReviewId: string | undefined
}): string {
  return contentHash({
    endpoint: 'research-campaign-orchestration',
    workflowVersion: 'campaign-orchestration-v1',
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    orchestrationId: input.orchestrationId,
    idempotencyDigest: input.idempotencyDigest,
    purpose: input.purpose,
    configuration: input.configuration,
    budget: input.budget,
    ...(input.analysisSeedReviewId ? { analysisSeedReviewId: input.analysisSeedReviewId } : {})
  })
}

function childRunId(orchestrationId: string, sourceId: string): string {
  return `run:campaign-source:${contentHash({ orchestrationId, sourceId }).slice(0, 48)}`
}

function childIdempotencyKey(orchestrationId: string, sourceId: string): string {
  return `campaign-source-${contentHash({ orchestrationId, sourceId }).slice(0, 64)}`
}

function mapSource(row: OrchestrationSourceRow): ResearchCampaignOrchestrationSourceReadModel {
  return researchCampaignOrchestrationSourceReadModelSchema.parse({
    sourceId: row.source_id,
    childRunId: row.child_run_id,
    state: row.state,
    policyVersion: row.policy_version,
    workflowId: row.workflow_id,
    attemptCount: Number(row.attempt_count),
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    requestedAt: asIso(row.requested_at)!,
    startedAt: asIso(row.started_at),
    updatedAt: asIso(row.updated_at)!,
    finishedAt: asIso(row.finished_at)
  })
}

async function readSourceRows(
  client: PoolClient,
  workspaceId: string,
  orchestrationId: string
): Promise<ResearchCampaignOrchestrationSourceReadModel[]> {
  const result = await client.query<OrchestrationSourceRow>(
    `SELECT workspace_id, orchestration_id, source_id, child_run_id, state,
            policy_version, workflow_id, attempt_count, claim_owner, claim_token,
            claim_until, next_attempt_at, failure_code, failure_summary,
            requested_at, started_at, updated_at, finished_at
       FROM appsea.research_campaign_orchestration_sources
      WHERE workspace_id = $1 AND orchestration_id = $2
      ORDER BY source_id`,
    [workspaceId, orchestrationId]
  )
  return result.rows.map(mapSource)
}

async function mapParent(
  client: PoolClient,
  row: OrchestrationRow
): Promise<ResearchCampaignOrchestrationReadModel> {
  const sources = await readSourceRows(client, row.workspace_id, row.orchestration_id)
  return researchCampaignOrchestrationReadModelSchema.parse({
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    orchestrationId: row.orchestration_id,
    state: row.state,
    sourceCount: Number(row.source_count),
    completedSourceCount: Number(row.completed_source_count),
    failedSourceCount: Number(row.failed_source_count),
    analysisSeedReviewId: row.analysis_seed_review_id,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    requestedAt: asIso(row.requested_at)!,
    startedAt: asIso(row.started_at),
    updatedAt: asIso(row.updated_at)!,
    finishedAt: asIso(row.finished_at),
    cancellationRequestedAt: asIso(row.cancellation_requested_at),
    sources
  })
}

async function readParentForUpdate(
  client: PoolClient,
  workspaceId: string,
  orchestrationId: string
): Promise<OrchestrationRow | undefined> {
  const result = await client.query<OrchestrationRow>(
    `SELECT workspace_id, orchestration_id, campaign_id, idempotency_digest,
            input_hash, requested_by_actor_type, requested_by_actor_id,
            analysis_seed_review_id, state, source_count, completed_source_count,
            failed_source_count, failure_code, failure_summary, requested_at,
            started_at, updated_at, finished_at, cancellation_requested_at,
            cancellation_requested_by, cancellation_request_id
       FROM appsea.research_campaign_orchestrations
      WHERE workspace_id = $1 AND orchestration_id = $2
      FOR UPDATE`,
    [workspaceId, orchestrationId]
  )
  return result.rows[0]
}

export class PostgresResearchCampaignOrchestrationRepository {
  constructor(private readonly pool: Pool) {}

  async createForUser(
    userId: string,
    workspaceId: string,
    campaignId: string,
    input: ResearchCampaignRunInput
  ): Promise<ResearchCampaignOrchestrationReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    const parsedInput = researchCampaignRunInputSchema.parse(input)
    const occurredAt = safeServerTimestamp(parsedInput.requestedAt)
    const idempotencyDigest = orchestrationIdempotencyDigest(
      parsedWorkspaceId,
      parsedInput.idempotencyKey
    )

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') {
          throw new ResearchCampaignOrchestrationPermissionError()
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
          throw new ResearchCampaignOrchestrationPermissionError()
        }

        const campaign = await client.query<
          QueryResultRow & {
            purpose: string
            configuration: unknown
            budget: unknown
            state: string
            synthetic: boolean
          }
        >(
          `SELECT purpose, configuration, budget, state, synthetic
             FROM appsea.research_campaigns
            WHERE workspace_id = $1 AND campaign_id = $2
            FOR UPDATE`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        const campaignRow = campaign.rows[0]
        if (!campaignRow)
          throw new ResearchCampaignOrchestrationStateError('Research campaign was not found')
        if (
          campaignRow.synthetic ||
          !['draft', 'validated', 'queued', 'running'].includes(campaignRow.state)
        ) {
          throw new ResearchCampaignOrchestrationStateError(
            `Campaign state ${campaignRow.state} cannot start a multi-source collection`
          )
        }
        let configuration: ResearchCampaignConfiguration
        let budget: ResearchJobBudget
        try {
          configuration = researchCampaignConfigurationSchema.parse(campaignRow.configuration)
          budget = researchJobBudgetSchema.parse(campaignRow.budget)
        } catch {
          throw new ResearchCampaignOrchestrationStateError(
            'Only validated campaign-v1 drafts can start production collection'
          )
        }
        if (configuration.sourceIds.length < 2) {
          throw new ResearchCampaignOrchestrationStateError(
            'Multi-source orchestration requires at least two configured sources'
          )
        }

        const inputHash = orchestrationInputHash({
          workspaceId: parsedWorkspaceId,
          campaignId: parsedCampaignId,
          orchestrationId: parsedInput.runId,
          idempotencyDigest,
          purpose: campaignRow.purpose,
          configuration,
          budget,
          analysisSeedReviewId: parsedInput.analysisSeedReviewId
        })

        const existingResult = await client.query<OrchestrationRow>(
          `SELECT workspace_id, orchestration_id, campaign_id, idempotency_digest,
                  input_hash, requested_by_actor_type, requested_by_actor_id,
                  analysis_seed_review_id, state, source_count, completed_source_count,
                  failed_source_count, failure_code, failure_summary, requested_at,
                  started_at, updated_at, finished_at, cancellation_requested_at,
                  cancellation_requested_by, cancellation_request_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1
              AND (orchestration_id = $2 OR idempotency_digest = $3)
            ORDER BY orchestration_id
            FOR UPDATE`,
          [parsedWorkspaceId, parsedInput.runId, idempotencyDigest]
        )
        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0]!
          if (
            existingResult.rows.length !== 1 ||
            existing.orchestration_id !== parsedInput.runId ||
            existing.campaign_id !== parsedCampaignId ||
            existing.idempotency_digest !== idempotencyDigest ||
            existing.input_hash !== inputHash ||
            existing.requested_by_actor_type !== 'user' ||
            existing.requested_by_actor_id !== parsedUserId ||
            existing.analysis_seed_review_id !== (parsedInput.analysisSeedReviewId ?? null)
          ) {
            throw new ResearchCampaignOrchestrationConflictError()
          }
          return mapParent(client, existing)
        }

        const sources = await client.query<
          QueryResultRow & {
            source_id: string
            source_type: string
            lifecycle_state: string
            current_policy_version: string | null
            policy_version: string | null
            policy_state: string | null
            permitted_purposes: string[] | null
            display_mode: string | null
            reviewed_at: Date | string | null
            expires_at: Date | string | null
            approved_review: boolean
          }
        >(
          `SELECT source.source_id, source.source_type, source.lifecycle_state,
                  source.current_policy_version, policy.policy_version,
                  policy.policy_state, policy.permitted_purposes,
                  policy.display_mode, policy.reviewed_at, policy.expires_at,
                  EXISTS (
                    SELECT 1
                      FROM appsea.source_policy_reviews review
                     WHERE review.source_id = policy.source_id
                       AND review.policy_version = policy.policy_version
                       AND review.decision = 'approved'
                       AND review.content_hash = policy.content_hash
                       AND review.independence_attested
                  ) AS approved_review
             FROM appsea.sources source
             LEFT JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = source.current_policy_version
            WHERE source.source_id = ANY($1::text[])
            ORDER BY source.source_id
            FOR SHARE OF source`,
          [configuration.sourceIds]
        )
        const found = new Set(sources.rows.map((row) => row.source_id))
        const missing = configuration.sourceIds.find((sourceId) => !found.has(sourceId))
        if (missing)
          throw new ResearchCampaignOrchestrationSourceError(`Unknown campaign source: ${missing}`)
        for (const source of sources.rows) {
          const expiresAt =
            source.expires_at === null ? null : Date.parse(String(source.expires_at))
          const collectible =
            source.source_type !== 'fixture' &&
            source.lifecycle_state === 'active' &&
            source.policy_state === 'approved' &&
            source.reviewed_at !== null &&
            source.approved_review === true &&
            (expiresAt === null || expiresAt > Date.now()) &&
            (source.permitted_purposes ?? []).includes(campaignRow.purpose) &&
            source.display_mode === configuration.requestedDisplayMode
          if (!collectible) {
            throw new ResearchCampaignOrchestrationSourceError(
              `Source ${source.source_id} is not currently approved for this campaign`
            )
          }
        }
        if (parsedInput.analysisSeedReviewId) {
          const seed = await client.query(
            `SELECT 1
               FROM appsea.opportunity_seed_reviews
              WHERE workspace_id = $1
                AND seed_review_id = $2
                AND review_state = 'approved'
              FOR SHARE`,
            [parsedWorkspaceId, parsedInput.analysisSeedReviewId]
          )
          if (seed.rowCount !== 1) {
            throw new ResearchCampaignOrchestrationStateError(
              'An approved opportunity seed review is required for automatic analysis'
            )
          }
        }

        await client.query(
          `INSERT INTO appsea.research_campaign_orchestrations
             (workspace_id, orchestration_id, campaign_id, idempotency_digest,
              input_hash, requested_by_actor_type, requested_by_actor_id,
              analysis_seed_review_id, state, source_count, requested_at,
              updated_at)
           VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, 'queued', $8, $9, $10)`,
          [
            parsedWorkspaceId,
            parsedInput.runId,
            parsedCampaignId,
            idempotencyDigest,
            inputHash,
            parsedUserId,
            parsedInput.analysisSeedReviewId ?? null,
            configuration.sourceIds.length,
            parsedInput.requestedAt,
            occurredAt
          ]
        )
        for (const sourceId of configuration.sourceIds) {
          await client.query(
            `INSERT INTO appsea.research_campaign_orchestration_sources
               (workspace_id, orchestration_id, source_id, child_run_id, state,
                requested_at, updated_at)
             VALUES ($1, $2, $3, $4, 'queued', $5, $6)`,
            [
              parsedWorkspaceId,
              parsedInput.runId,
              sourceId,
              childRunId(parsedInput.runId, sourceId),
              parsedInput.requestedAt,
              occurredAt
            ]
          )
        }
        await client.query(
          `UPDATE appsea.research_campaigns
              SET state = 'queued', updated_at = GREATEST(updated_at, $3)
            WHERE workspace_id = $1 AND campaign_id = $2`,
          [parsedWorkspaceId, parsedCampaignId, occurredAt]
        )
        const metadata = JSON.stringify({
          orchestrationId: parsedInput.runId,
          sourceIds: configuration.sourceIds,
          sourceCount: configuration.sourceIds.length,
          synthetic: false
        })
        const eventIdentity = contentHash({
          workspaceId: parsedWorkspaceId,
          orchestrationId: parsedInput.runId
        }).slice(0, 32)
        await client.query(
          `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action,
              target_type, target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.campaign_orchestration.queued',
                   'research_campaign_orchestration', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            `audit:campaign-orchestration:${eventIdentity}`,
            parsedUserId,
            parsedInput.runId,
            metadata,
            occurredAt
          ]
        )
        await client.query(
          `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type,
              aggregate_id, schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.campaign_orchestration.queued',
                   'research_campaign_orchestration', $3,
                   'campaign-orchestration-v1', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            `outbox:campaign-orchestration:${eventIdentity}`,
            parsedInput.runId,
            JSON.stringify({
              workspaceId: parsedWorkspaceId,
              campaignId: parsedCampaignId,
              orchestrationId: parsedInput.runId,
              sourceCount: configuration.sourceIds.length
            }),
            occurredAt
          ]
        )
        const inserted = await readParentForUpdate(client, parsedWorkspaceId, parsedInput.runId)
        if (!inserted) throw new Error('Campaign orchestration was not created')
        return mapParent(client, inserted)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    orchestrationId: string
  ): Promise<ResearchCampaignOrchestrationReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOrchestrationId = appseaIdentifierSchema.parse(orchestrationId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const row = await client.query<OrchestrationRow>(
          `SELECT workspace_id, orchestration_id, campaign_id, idempotency_digest,
                  input_hash, requested_by_actor_type, requested_by_actor_id,
                  analysis_seed_review_id, state, source_count, completed_source_count,
                  failed_source_count, failure_code, failure_summary, requested_at,
                  started_at, updated_at, finished_at, cancellation_requested_at,
                  cancellation_requested_by, cancellation_request_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1 AND orchestration_id = $2`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        return row.rows[0] ? mapParent(client, row.rows[0]) : null
      },
      { readOnly: true }
    )
  }

  async listPageForCampaignForUser(
    userId: string,
    workspaceId: string,
    campaignId: string,
    query: Partial<CampaignHistoryPageQuery> = {}
  ): Promise<ReturnType<typeof researchCampaignOrchestrationHistoryPageSchema.parse>> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    const parsedQuery = campaignHistoryPageQuerySchema.parse(query)
    const cursor = parsedQuery.cursor
      ? decodeCampaignHistoryCursor(parsedQuery.cursor, 'orchestrations')
      : null
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const rows = await client.query<OrchestrationRow>(
          `SELECT workspace_id, orchestration_id, campaign_id, idempotency_digest,
                  input_hash, requested_by_actor_type, requested_by_actor_id,
                  analysis_seed_review_id, state, source_count, completed_source_count,
                  failed_source_count, failure_code, failure_summary, requested_at,
                  started_at, updated_at, finished_at, cancellation_requested_at,
                  cancellation_requested_by, cancellation_request_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1
              AND campaign_id = $2
              AND (
                $3::timestamptz IS NULL
                OR requested_at < $3::timestamptz
                OR (requested_at = $3::timestamptz AND orchestration_id > $4)
              )
            ORDER BY requested_at DESC, orchestration_id
            LIMIT $5`,
          [
            parsedWorkspaceId,
            parsedCampaignId,
            cursor?.requestedAt ?? null,
            cursor?.itemId ?? null,
            parsedQuery.limit + 1
          ]
        )
        const hasNext = rows.rows.length > parsedQuery.limit
        const pageRows = hasNext ? rows.rows.slice(0, parsedQuery.limit) : rows.rows
        const data = await Promise.all(pageRows.map((row) => mapParent(client, row)))
        const last = pageRows.at(-1)
        return researchCampaignOrchestrationHistoryPageSchema.parse({
          data,
          nextCursor:
            hasNext && last
              ? encodeCampaignHistoryCursor(
                  'orchestrations',
                  last.requested_at instanceof Date
                    ? last.requested_at.toISOString()
                    : new Date(last.requested_at).toISOString(),
                  last.orchestration_id
                )
              : null
        })
      },
      { readOnly: true }
    )
  }

  async listForCampaignForUser(
    userId: string,
    workspaceId: string,
    campaignId: string
  ): Promise<ResearchCampaignOrchestrationReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const rows = await client.query<OrchestrationRow>(
          `SELECT workspace_id, orchestration_id, campaign_id, idempotency_digest,
                  input_hash, requested_by_actor_type, requested_by_actor_id,
                  analysis_seed_review_id, state, source_count, completed_source_count,
                  failed_source_count, failure_code, failure_summary, requested_at,
                  started_at, updated_at, finished_at, cancellation_requested_at,
                  cancellation_requested_by, cancellation_request_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1 AND campaign_id = $2
            ORDER BY requested_at DESC, orchestration_id
            LIMIT 100`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        return Promise.all(rows.rows.map((row) => mapParent(client, row)))
      },
      { readOnly: true }
    )
  }

  /**
   * Persist an owner/editor cancellation intent before touching Temporal.
   * Already-started child workflow identities are returned for best-effort
   * immediate cancellation; the maintenance worker retries them from the
   * durable intent when the external service is unavailable.
   */
  async requestCancellationForUser(
    userId: string,
    workspaceId: string,
    orchestrationId: string
  ): Promise<ResearchCampaignOrchestrationCancellationResult | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOrchestrationId = appseaIdentifierSchema.parse(orchestrationId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') {
          throw new ResearchCampaignOrchestrationPermissionError()
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
          throw new ResearchCampaignOrchestrationPermissionError()
        }

        const parent = await readParentForUpdate(client, parsedWorkspaceId, parsedOrchestrationId)
        if (!parent) return null
        const terminal = ['completed', 'partial', 'failed', 'canceled'].includes(parent.state)
        const activeWorkflowRows = await client.query<{ workflow_id: string }>(
          `SELECT workflow_id
             FROM appsea.research_campaign_orchestration_sources
            WHERE workspace_id = $1
              AND orchestration_id = $2
              AND state = 'started'
              AND workflow_id IS NOT NULL
            ORDER BY source_id`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        const activeWorkflowIds = activeWorkflowRows.rows
          .map((row) => row.workflow_id)
          .filter((workflowId) => /^[a-z][a-z0-9_:-]{2,239}$/.test(workflowId))

        if (terminal) {
          return {
            orchestrationId: parsedOrchestrationId,
            campaignId: parent.campaign_id,
            state: 'already_terminal',
            cancellationRequestedAt: asIso(parent.cancellation_requested_at),
            activeWorkflowIds: []
          }
        }

        const requestId = `cancel:orchestration:${contentHash({
          workspaceId: parsedWorkspaceId,
          orchestrationId: parsedOrchestrationId
        }).slice(0, 48)}`
        const updated = await client.query<OrchestrationRow>(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestrations parent
              SET cancellation_requested_at = COALESCE(parent.cancellation_requested_at, clock.now),
                  cancellation_requested_by = COALESCE(parent.cancellation_requested_by, $3),
                  cancellation_request_id = COALESCE(parent.cancellation_request_id, $4),
                  updated_at = GREATEST(parent.updated_at, clock.now)
             FROM clock
            WHERE parent.workspace_id = $1
              AND parent.orchestration_id = $2
              AND parent.state IN ('queued', 'running')
            RETURNING parent.workspace_id, parent.orchestration_id, parent.campaign_id,
                      parent.idempotency_digest, parent.input_hash,
                      parent.requested_by_actor_type, parent.requested_by_actor_id,
                      parent.analysis_seed_review_id, parent.state,
                      parent.source_count, parent.completed_source_count,
                      parent.failed_source_count, parent.failure_code,
                      parent.failure_summary, parent.requested_at, parent.started_at,
                      parent.updated_at, parent.finished_at,
                      parent.cancellation_requested_at,
                      parent.cancellation_requested_by,
                      parent.cancellation_request_id`,
          [parsedWorkspaceId, parsedOrchestrationId, parsedUserId, requestId]
        )
        const updatedParent = updated.rows[0] ?? parent
        if (!parent.cancellation_requested_at && updated.rows[0]) {
          const metadata = JSON.stringify({
            orchestrationId: parsedOrchestrationId,
            campaignId: parent.campaign_id,
            activeWorkflowCount: activeWorkflowIds.length
          })
          await client.query(
            `INSERT INTO appsea.audit_events
               (workspace_id, audit_event_id, actor_type, actor_id, action,
                target_type, target_id, correlation_id, metadata, occurred_at)
             VALUES ($1, $2, 'user', $3,
                     'research.campaign_orchestration.cancellation_requested',
                     'research_campaign_orchestration', $4, $4, $5::jsonb,
                     $6)
             ON CONFLICT DO NOTHING`,
            [
              parsedWorkspaceId,
              `audit:campaign-orchestration-cancel:${requestId}`,
              parsedUserId,
              parsedOrchestrationId,
              metadata,
              updatedParent.cancellation_requested_at
            ]
          )
          await client.query(
            `INSERT INTO appsea.outbox_events
               (workspace_id, outbox_event_id, event_type, aggregate_type,
                aggregate_id, schema_version, correlation_id, payload, occurred_at)
             VALUES ($1, $2, 'research.campaign_orchestration.cancellation_requested',
                     'research_campaign_orchestration', $3,
                     'campaign-orchestration-v1', $3, $4::jsonb, $5)
             ON CONFLICT DO NOTHING`,
            [
              parsedWorkspaceId,
              `outbox:campaign-orchestration-cancel:${requestId}`,
              parsedOrchestrationId,
              JSON.stringify({
                workspaceId: parsedWorkspaceId,
                campaignId: parent.campaign_id,
                orchestrationId: parsedOrchestrationId
              }),
              updatedParent.cancellation_requested_at
            ]
          )
        }
        return {
          orchestrationId: parsedOrchestrationId,
          campaignId: updatedParent.campaign_id,
          state: 'requested',
          cancellationRequestedAt: asIso(updatedParent.cancellation_requested_at),
          activeWorkflowIds
        }
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

  /** Apply the durable cancellation intent to undispatched children. */
  async prepareCancellationForService(
    workspaceId: string,
    orchestrationId: string,
    fence?: MaintenanceSchedulerFence
  ): Promise<ResearchCampaignOrchestrationCancellationTarget | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOrchestrationId = appseaIdentifierSchema.parse(orchestrationId)
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const parent = await readParentForUpdate(client, parsedWorkspaceId, parsedOrchestrationId)
        if (
          !parent ||
          !parent.cancellation_requested_at ||
          ['completed', 'partial', 'failed', 'canceled'].includes(parent.state)
        ) {
          return null
        }
        const pending = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = 'canceled',
                  claim_owner = NULL,
                  claim_token = NULL,
                  claim_until = NULL,
                  next_attempt_at = NULL,
                  failure_code = 'canceled',
                  failure_summary = 'The source collection was canceled by a workspace member.',
                  updated_at = clock.now,
                  finished_at = clock.now
             FROM clock
            WHERE child.workspace_id = $1
              AND child.orchestration_id = $2
              AND child.state = 'queued'`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        const active = await client.query<{ workflow_id: string }>(
          `SELECT workflow_id
             FROM appsea.research_campaign_orchestration_sources
            WHERE workspace_id = $1
              AND orchestration_id = $2
              AND state = 'started'
              AND workflow_id IS NOT NULL
            ORDER BY source_id`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        return {
          workspaceId: parsedWorkspaceId,
          orchestrationId: parsedOrchestrationId,
          activeWorkflowIds: active.rows
            .map((row) => row.workflow_id)
            .filter((workflowId) => /^[a-z][a-z0-9_:-]{2,239}$/.test(workflowId)),
          pendingSourcesCanceled: pending.rowCount ?? 0
        }
      },
      { maintenanceFence: fence }
    )
  }

  async listCancellationTargetsForService(workspaceId: string, limit = 100): Promise<string[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Campaign cancellation reconciliation limit must be between 1 and 100')
    }
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ orchestration_id: string }>(
          `SELECT orchestration_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1
              AND cancellation_requested_at IS NOT NULL
              AND state IN ('queued', 'running')
            ORDER BY cancellation_requested_at, orchestration_id
            LIMIT $2`,
          [parsedWorkspaceId, limit]
        )
        return result.rows.map((row) => appseaIdentifierSchema.parse(row.orchestration_id))
      },
      { readOnly: true }
    )
  }

  async listActiveOrchestrationIdsForService(workspaceId: string, limit = 100): Promise<string[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Campaign orchestration reconciliation limit must be between 1 and 100')
    }
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ orchestration_id: string }>(
          `SELECT orchestration_id
             FROM appsea.research_campaign_orchestrations
            WHERE workspace_id = $1
              AND state IN ('queued', 'running')
            ORDER BY updated_at, orchestration_id
            LIMIT $2`,
          [parsedWorkspaceId, limit]
        )
        return result.rows.map((row) => appseaIdentifierSchema.parse(row.orchestration_id))
      },
      { readOnly: true }
    )
  }

  async claimNextSourceForService(
    workspaceId: string,
    claimOwner: string,
    claimToken: string,
    leaseSeconds: number,
    fence?: MaintenanceSchedulerFence
  ): Promise<ResearchCampaignOrchestrationClaim | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOwner = maintenanceSchedulerOwnerIdSchema.parse(claimOwner)
    const parsedToken = maintenanceSchedulerLeaseTokenSchema.parse(claimToken)
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw new Error(
        'Campaign orchestration claim lease must be an integer between 30 and 3600 seconds'
      )
    }
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = 'failed',
                  claim_owner = NULL,
                  claim_token = NULL,
                  claim_until = NULL,
                  failure_code = 'attempts_exhausted',
                  failure_summary = 'The source dispatch claim exhausted its bounded retry limit.',
                  updated_at = clock.now,
                  finished_at = clock.now
             FROM clock
            WHERE child.workspace_id = $1
              AND child.state = 'dispatching'
              AND child.claim_until <= clock.now
              AND child.attempt_count >= 10`,
          [parsedWorkspaceId]
        )
        await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = 'queued',
                  claim_owner = NULL,
                  claim_token = NULL,
                  claim_until = NULL,
                  next_attempt_at = clock.now,
                  failure_code = NULL,
                  failure_summary = NULL,
                  updated_at = clock.now
             FROM clock
            WHERE child.workspace_id = $1
              AND child.state = 'dispatching'
              AND child.claim_until <= clock.now
              AND child.attempt_count < 10`,
          [parsedWorkspaceId]
        )
        const candidate = await client.query<CampaignDispatchRow>(
          `SELECT child.workspace_id, child.orchestration_id, parent.campaign_id,
                  campaign.purpose, campaign.configuration, campaign.budget,
                  parent.analysis_seed_review_id, parent.requested_at,
                  child.source_id, child.child_run_id, child.attempt_count,
                  child.policy_version, child.workflow_id, child.claim_owner,
                  child.claim_token
             FROM appsea.research_campaign_orchestration_sources child
             JOIN appsea.research_campaign_orchestrations parent
               ON parent.workspace_id = child.workspace_id
              AND parent.orchestration_id = child.orchestration_id
             JOIN appsea.research_campaigns campaign
               ON campaign.workspace_id = parent.workspace_id
              AND campaign.campaign_id = parent.campaign_id
            WHERE child.workspace_id = $1
              AND child.state = 'queued'
              AND child.attempt_count < 10
              AND (child.next_attempt_at IS NULL OR child.next_attempt_at <= clock_timestamp())
              AND parent.state IN ('queued', 'running')
              AND parent.cancellation_requested_at IS NULL
              AND campaign.synthetic = false
              AND campaign.state IN ('queued', 'running')
            ORDER BY child.next_attempt_at NULLS FIRST, child.updated_at, child.source_id
            FOR UPDATE OF child, parent SKIP LOCKED
            LIMIT 1`,
          [parsedWorkspaceId]
        )
        const row = candidate.rows[0]
        if (!row) return null
        const claimed = await client.query<CampaignDispatchRow>(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = 'dispatching',
                  claim_owner = $2,
                  claim_token = $3,
                  claim_until = clock.now + make_interval(secs => $4::double precision),
                  attempt_count = LEAST(child.attempt_count + 1, 10),
                  next_attempt_at = NULL,
                  failure_code = NULL,
                  failure_summary = NULL,
                  updated_at = clock.now
             FROM clock
            WHERE child.workspace_id = $1
              AND child.orchestration_id = $5
              AND child.source_id = $6
              AND child.state = 'queued'
              AND child.attempt_count < 10
            RETURNING child.workspace_id, child.orchestration_id,
                      child.source_id, child.child_run_id, child.attempt_count,
                      child.policy_version, child.workflow_id, child.claim_owner,
                      child.claim_token`,
          [
            parsedWorkspaceId,
            parsedOwner,
            parsedToken,
            leaseSeconds,
            row.orchestration_id,
            row.source_id
          ]
        )
        const claimedRow = claimed.rows[0]
        if (!claimedRow) throw new ResearchCampaignOrchestrationClaimLostError()
        await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestrations parent
              SET state = CASE WHEN parent.state = 'queued' THEN 'running' ELSE parent.state END,
                  started_at = COALESCE(parent.started_at, GREATEST(parent.requested_at, clock.now)),
                  updated_at = clock.now
             FROM clock
            WHERE parent.workspace_id = $1
              AND parent.orchestration_id = $2
              AND parent.state IN ('queued', 'running')`,
          [parsedWorkspaceId, row.orchestration_id]
        )
        return {
          workspaceId: claimedRow.workspace_id,
          orchestrationId: claimedRow.orchestration_id,
          campaignId: row.campaign_id,
          sourceId: claimedRow.source_id,
          childRunId: claimedRow.child_run_id,
          purpose: row.purpose,
          configuration: researchCampaignConfigurationSchema.parse(row.configuration),
          budget: researchJobBudgetSchema.parse(row.budget),
          analysisSeedReviewId: row.analysis_seed_review_id,
          requestedAt: asIso(row.requested_at)!,
          attemptCount: Number(claimedRow.attempt_count),
          policyVersion: claimedRow.policy_version,
          workflowId: claimedRow.workflow_id
        }
      },
      { isolationLevel: 'READ COMMITTED', maintenanceFence: fence }
    )
  }

  async markSourceDispatchedForService(
    input: ResearchCampaignOrchestrationDispatch
  ): Promise<void> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const orchestrationId = appseaIdentifierSchema.parse(input.orchestrationId)
    const sourceId = appseaIdentifierSchema.parse(input.sourceId)
    const childRunId = appseaIdentifierSchema.parse(input.childRunId)
    const claimOwner = maintenanceSchedulerOwnerIdSchema.parse(input.claimOwner)
    const claimToken = maintenanceSchedulerLeaseTokenSchema.parse(input.claimToken)
    const workflowId = input.workflowId
    const policyVersion = input.policyVersion
    if (!/^[a-z][a-z0-9_:-]{2,159}$/.test(workflowId)) throw new Error('workflowId is invalid')
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(policyVersion)) throw new Error('policyVersion is invalid')
    const startedAt = new Date(input.startedAt).toISOString()
    await withServiceWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = 'started',
                  policy_version = $7,
                  workflow_id = COALESCE(child.workflow_id, $6),
                  claim_owner = NULL,
                  claim_token = NULL,
                  claim_until = NULL,
                  started_at = COALESCE(child.started_at, $5::timestamptz),
                  updated_at = GREATEST(child.updated_at, clock.now),
                  failure_code = NULL,
                  failure_summary = NULL
             FROM clock
            WHERE child.workspace_id = $1
              AND child.orchestration_id = $2
              AND child.source_id = $3
              AND child.child_run_id = $4
              AND child.state = 'dispatching'
              AND child.claim_owner = $8
              AND child.claim_token = $9
              AND child.claim_until > clock.now
              AND (child.workflow_id IS NULL OR child.workflow_id = $6)`,
          [
            workspaceId,
            orchestrationId,
            sourceId,
            childRunId,
            startedAt,
            workflowId,
            policyVersion,
            claimOwner,
            claimToken
          ]
        )
        if (result.rowCount !== 1) throw new ResearchCampaignOrchestrationClaimLostError()
      },
      { maintenanceFence: input.fence }
    )
  }

  async markSourceFailedForService(input: ResearchCampaignOrchestrationFailure): Promise<void> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const orchestrationId = appseaIdentifierSchema.parse(input.orchestrationId)
    const sourceId = appseaIdentifierSchema.parse(input.sourceId)
    const claimOwner = maintenanceSchedulerOwnerIdSchema.parse(input.claimOwner)
    const claimToken = maintenanceSchedulerLeaseTokenSchema.parse(input.claimToken)
    const failureCode = researchCampaignOrchestrationFailureCodeSchema.parse(input.failureCode)
    const summary = input.failureSummary.trim().slice(0, 240)
    if (!summary) throw new Error('Campaign orchestration failure summary cannot be empty')
    if (
      !Number.isSafeInteger(input.retryAfterSeconds) ||
      input.retryAfterSeconds < 1 ||
      input.retryAfterSeconds > 86_400
    ) {
      throw new Error('Campaign orchestration retryAfterSeconds must be between 1 and 86400')
    }
    await withServiceWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestration_sources child
              SET state = CASE WHEN $6::boolean THEN 'failed' ELSE 'queued' END,
                  claim_owner = NULL,
                  claim_token = NULL,
                  claim_until = NULL,
                  next_attempt_at = CASE WHEN $6::boolean THEN NULL
                    ELSE clock.now + make_interval(secs => $5::double precision) END,
                  failure_code = $7,
                  failure_summary = $8,
                  updated_at = clock.now,
                  finished_at = CASE WHEN $6::boolean THEN clock.now ELSE NULL END
             FROM clock
            WHERE child.workspace_id = $1
              AND child.orchestration_id = $2
              AND child.source_id = $3
              AND child.claim_owner = $9
              AND child.claim_token = $10
              AND child.claim_until > clock.now
              AND child.state = 'dispatching'`,
          [
            workspaceId,
            orchestrationId,
            sourceId,
            input.failureSummary,
            input.retryAfterSeconds,
            input.terminal,
            failureCode,
            summary,
            claimOwner,
            claimToken
          ]
        )
        if (result.rowCount !== 1) throw new ResearchCampaignOrchestrationClaimLostError()
      },
      { maintenanceFence: input.fence }
    )
  }

  /** Reconcile child states from the durable one-source workflow projections. */
  async reconcileForService(
    workspaceId: string,
    orchestrationId: string,
    fence?: MaintenanceSchedulerFence
  ): Promise<void> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOrchestrationId = appseaIdentifierSchema.parse(orchestrationId)
    await withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const parent = await readParentForUpdate(client, parsedWorkspaceId, parsedOrchestrationId)
        if (!parent || ['completed', 'partial', 'failed', 'canceled'].includes(parent.state)) return
        const children = await client.query<OrchestrationSourceRow & WorkflowObservationRow>(
          `SELECT child.workspace_id, child.orchestration_id, child.source_id,
                  child.child_run_id, child.state, child.policy_version,
                  child.workflow_id AS child_workflow_id, child.attempt_count, child.claim_owner,
                  child.claim_token, child.claim_until, child.next_attempt_at,
                  child.failure_code, child.failure_summary, child.requested_at,
                  child.started_at, child.updated_at, child.finished_at,
                  job.state AS source_state, job.workflow_id AS job_workflow_id,
                  job.policy_version AS workflow_policy_version,
                  job.started_at AS workflow_started_at,
                  job.finished_at AS workflow_finished_at,
                  job.failure_code AS workflow_failure_code
             FROM appsea.research_campaign_orchestration_sources child
             LEFT JOIN appsea.production_collection_workflow_jobs job
               ON job.workspace_id = child.workspace_id
              AND job.requested_research_run_id = child.child_run_id
            WHERE child.workspace_id = $1 AND child.orchestration_id = $2
            ORDER BY child.source_id
            FOR UPDATE OF child`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        for (const child of children.rows) {
          const workflowState = child.source_state
          if (parent.cancellation_requested_at && child.state === 'queued') {
            await client.query(
              `WITH clock AS (SELECT clock_timestamp() AS now)
               UPDATE appsea.research_campaign_orchestration_sources child
                  SET state = 'canceled',
                      claim_owner = NULL, claim_token = NULL, claim_until = NULL,
                      next_attempt_at = NULL,
                      failure_code = 'canceled',
                      failure_summary = 'The source collection was canceled by a workspace member.',
                      updated_at = clock.now,
                      finished_at = clock.now
                 FROM clock
                WHERE child.workspace_id = $1
                  AND child.orchestration_id = $2
                  AND child.source_id = $3
                  AND child.state = 'queued'`,
              [parsedWorkspaceId, parsedOrchestrationId, child.source_id]
            )
            continue
          }
          if (
            !workflowState ||
            ['completed', 'failed', 'canceled', 'budget_rejected'].includes(child.state)
          )
            continue
          const observedWorkflowId = child.job_workflow_id ?? child.child_workflow_id
          if (workflowState === 'completed' && observedWorkflowId) {
            await client.query(
              `WITH clock AS (SELECT clock_timestamp() AS now)
               UPDATE appsea.research_campaign_orchestration_sources child
                  SET state = 'completed',
                      workflow_id = COALESCE(child.workflow_id, $3),
                      policy_version = COALESCE(child.policy_version, $4),
                      claim_owner = NULL, claim_token = NULL, claim_until = NULL,
                      failure_code = NULL, failure_summary = NULL,
                      started_at = COALESCE(child.started_at, $5::timestamptz),
                      updated_at = clock.now,
                      finished_at = COALESCE($6::timestamptz, clock.now)
                 FROM clock
                WHERE child.workspace_id = $1 AND child.orchestration_id = $2
                  AND child.source_id = $7`,
              [
                parsedWorkspaceId,
                parsedOrchestrationId,
                observedWorkflowId,
                child.workflow_policy_version,
                child.workflow_started_at,
                child.workflow_finished_at,
                child.source_id
              ]
            )
          } else if (['failed', 'canceled', 'budget_rejected'].includes(workflowState)) {
            await client.query(
              `WITH clock AS (SELECT clock_timestamp() AS now)
               UPDATE appsea.research_campaign_orchestration_sources child
                  SET state = CASE WHEN $3 = 'canceled' THEN 'canceled' ELSE 'failed' END,
                      claim_owner = NULL, claim_token = NULL, claim_until = NULL,
                      failure_code = CASE WHEN $3 = 'canceled' THEN 'canceled' ELSE 'child_failed' END,
                      failure_summary = CASE WHEN $3 = 'canceled'
                        THEN 'The source collection workflow was canceled.'
                        ELSE 'The source collection workflow reached a terminal failure.' END,
                      updated_at = clock.now,
                      finished_at = COALESCE($4::timestamptz, clock.now)
                 FROM clock
                WHERE child.workspace_id = $1 AND child.orchestration_id = $2
                  AND child.source_id = $5`,
              [
                parsedWorkspaceId,
                parsedOrchestrationId,
                workflowState,
                child.workflow_finished_at,
                child.source_id
              ]
            )
          } else if (child.state === 'dispatching' && observedWorkflowId) {
            await client.query(
              `WITH clock AS (SELECT clock_timestamp() AS now)
               UPDATE appsea.research_campaign_orchestration_sources child
                  SET state = 'started',
                      claim_owner = NULL, claim_token = NULL, claim_until = NULL,
                      policy_version = COALESCE(child.policy_version, $3),
                      started_at = COALESCE(child.started_at, $4::timestamptz),
                      updated_at = clock.now
                 FROM clock
                WHERE child.workspace_id = $1 AND child.orchestration_id = $2
                  AND child.source_id = $5`,
              [
                parsedWorkspaceId,
                parsedOrchestrationId,
                child.workflow_policy_version,
                child.workflow_started_at,
                child.source_id
              ]
            )
          }
        }

        const counts = await client.query<{
          completed_count: string
          failed_count: string
          active_count: string
        }>(
          `SELECT
             count(*) FILTER (WHERE state = 'completed')::text AS completed_count,
             count(*) FILTER (WHERE state IN ('failed', 'canceled'))::text AS failed_count,
             count(*) FILTER (WHERE state IN ('queued', 'dispatching', 'started'))::text AS active_count
             FROM appsea.research_campaign_orchestration_sources
            WHERE workspace_id = $1 AND orchestration_id = $2`,
          [parsedWorkspaceId, parsedOrchestrationId]
        )
        const completed = Number(counts.rows[0]?.completed_count ?? 0)
        const failed = Number(counts.rows[0]?.failed_count ?? 0)
        const active = Number(counts.rows[0]?.active_count ?? 0)
        const terminal = active === 0
        const state = terminal
          ? parent.cancellation_requested_at
            ? 'canceled'
            : failed === 0
              ? 'completed'
              : completed > 0
                ? 'partial'
                : 'failed'
          : completed > 0 || failed > 0
            ? 'running'
            : parent.state === 'running'
              ? 'running'
              : 'queued'
        const failureCode =
          state === 'canceled'
            ? 'canceled'
            : state === 'partial' || state === 'failed'
              ? 'child_failed'
              : null
        const failureSummary =
          state === 'canceled'
            ? 'The campaign collection was canceled by a workspace member.'
            : state === 'partial'
              ? 'One or more source collections failed; completed source results remain inspectable.'
              : state === 'failed'
                ? 'Every source collection failed before producing a complete campaign result.'
                : null
        await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaign_orchestrations parent
              SET state = $3,
                  completed_source_count = $4,
                  failed_source_count = $5,
                  failure_code = $6,
                  failure_summary = $7,
                  started_at = COALESCE(parent.started_at, CASE WHEN $3 <> 'queued' THEN GREATEST(parent.requested_at, clock.now) ELSE NULL END),
                  updated_at = clock.now,
                  finished_at = CASE WHEN $8::boolean THEN COALESCE(parent.finished_at, clock.now) ELSE NULL END
             FROM clock
            WHERE parent.workspace_id = $1 AND parent.orchestration_id = $2
              AND parent.state NOT IN ('completed', 'partial', 'failed', 'canceled')`,
          [
            parsedWorkspaceId,
            parsedOrchestrationId,
            state,
            completed,
            failed,
            failureCode,
            failureSummary,
            terminal
          ]
        )
        // The parent orchestration is the aggregate owner for a multi-source
        // campaign.  A child workflow deliberately skips the ordinary
        // single-source campaign transition, so reconciliation must project
        // the aggregate state back onto the campaign row in the same
        // transaction.  Keep archived campaigns immutable and do not disturb
        // a user pause/archive transition while a worker is catching up.
        if (state !== 'queued') {
          await client.query(
            `WITH clock AS (SELECT clock_timestamp() AS now)
             UPDATE appsea.research_campaigns campaign
                SET state = $3,
                    updated_at = GREATEST(campaign.updated_at, clock.now)
               FROM clock
              WHERE campaign.workspace_id = $1
                AND campaign.campaign_id = $2
                AND campaign.state IN ('queued', 'running')`,
            [parsedWorkspaceId, parent.campaign_id, state]
          )
        }
      },
      { maintenanceFence: fence }
    )
  }
}

export function campaignSourceIdempotencyKey(orchestrationId: string, sourceId: string): string {
  return childIdempotencyKey(orchestrationId, sourceId)
}
