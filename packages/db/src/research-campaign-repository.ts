import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  researchCampaignCreateInputSchema,
  researchCampaignConfigurationSchema,
  researchCampaignRefreshFailureCodeSchema,
  researchCampaignReadModelSchema,
  researchCampaignRefreshScheduleReadModelSchema,
  researchCampaignSourceReadModelSchema,
  researchCampaignUpdateInputSchema,
  researchJobBudgetSchema,
  workflowIdSchema,
  productionCollectionWorkflowStartRequestSchema,
  maintenanceSchedulerLeaseTokenSchema,
  maintenanceSchedulerOwnerIdSchema,
  type ResearchCampaignCreateInput,
  type ResearchCampaignConfiguration,
  type ResearchCampaignReadModel,
  type ResearchCampaignRefreshPolicy,
  type ResearchCampaignSourceReadModel,
  type ResearchCampaignUpdateInput,
  type ProductionCollectionWorkflowStartRequest,
  type ResearchJobBudget,
  type MaintenanceSchedulerFence
} from '@appsea/contracts'
import { contentHash } from './hash'
import {
  withAuthenticatedWorkspaceTransaction,
  withDatabaseTransaction,
  withServiceWorkspaceTransaction
} from './transaction'

interface CampaignRow extends QueryResultRow {
  workspace_id: string
  campaign_id: string
  name: string
  purpose: string
  state: string
  configuration: unknown
  budget: unknown
  synthetic: boolean
  created_at: Date | string
  updated_at: Date | string
  refresh_next_due_at: Date | string | null
  refresh_claim_owner: string | null
  refresh_claim_token: string | null
  refresh_claim_until: Date | string | null
  refresh_pending_due_at: Date | string | null
  refresh_pending_run_id: string | null
  refresh_pending_workflow_id: string | null
  refresh_pending_idempotency_digest: string | null
  refresh_pending_input_hash: string | null
  refresh_pending_request: unknown
  refresh_attempt_count: number | string
  refresh_last_run_id: string | null
  refresh_last_workflow_id: string | null
  refresh_last_started_at: Date | string | null
  refresh_failure_code: string | null
  refresh_failure_summary: string | null
  refresh_updated_at: Date | string
}

interface SourceRow extends QueryResultRow {
  source_id: string
  display_name: string
  source_type: 'fixture' | 'api' | 'export' | 'licensed-feed' | 'manual'
  lifecycle_state: string
  policy_version: string | null
  policy_state: 'approved' | 'pending_review' | 'expired' | 'revoked' | null
  permitted_purposes: string[] | null
  display_mode: 'excerpt' | 'metadata-only' | 'aggregate-only' | 'fixture' | null
  coverage_notes: string[] | null
  reviewed_at: Date | string | null
  expires_at: Date | string | null
}

export interface ResearchCampaignRefreshClaim {
  workspaceId: string
  campaignId: string
  purpose: string
  configuration: ResearchCampaignConfiguration
  budget: ResearchJobBudget
  dueAt: string
  runId: string
  idempotencyKey: string
  workflowId: string
  attemptCount: number
  pendingRequest: ProductionCollectionWorkflowStartRequest | null
  pendingIdempotencyDigest: string | null
  pendingInputHash: string | null
}

export interface ResearchCampaignRefreshRequestBinding {
  workspaceId: string
  campaignId: string
  claimOwner: string
  claimToken: string
  fence?: MaintenanceSchedulerFence
  request: ProductionCollectionWorkflowStartRequest
  workflowId: string
  idempotencyDigest: string
  inputHash: string
}

export interface ResearchCampaignRefreshDispatch {
  workspaceId: string
  campaignId: string
  claimOwner: string
  claimToken: string
  runId: string
  workflowId: string
  startedAt: string
  fence?: MaintenanceSchedulerFence
}

export interface ResearchCampaignRefreshFailure {
  workspaceId: string
  campaignId: string
  claimOwner: string
  claimToken: string
  failureCode: string
  failureSummary: string
  retryAfterSeconds: number
  clearPending: boolean
  fence?: MaintenanceSchedulerFence
}

export class ResearchCampaignPermissionError extends Error {
  constructor() {
    super('The workspace role cannot manage a research campaign')
    this.name = 'ResearchCampaignPermissionError'
  }
}

export class ResearchCampaignConflictError extends Error {
  constructor() {
    super('Research campaign identifier or content conflicts with existing state')
    this.name = 'ResearchCampaignConflictError'
  }
}

export class ResearchCampaignSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResearchCampaignSourceError'
  }
}

export class ResearchCampaignStateError extends Error {
  constructor(message = 'The research campaign state does not allow this operation') {
    super(message)
    this.name = 'ResearchCampaignStateError'
  }
}

export class ResearchCampaignRefreshClaimLostError extends Error {
  constructor() {
    super('The campaign refresh claim is no longer owned by this worker')
    this.name = 'ResearchCampaignRefreshClaimLostError'
  }
}

function asIso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
}

const refreshIntervalsMs: Record<Exclude<ResearchCampaignRefreshPolicy, 'manual'>, number> = {
  daily: 24 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
  monthly: 30 * 24 * 60 * 60 * 1_000
}

function nextRefreshAt(policy: ResearchCampaignRefreshPolicy, from: string): string | null {
  if (policy === 'manual') return null
  const fromMs = Date.parse(from)
  if (!Number.isFinite(fromMs)) throw new Error('Campaign refresh timestamp is invalid')
  return new Date(fromMs + refreshIntervalsMs[policy]).toISOString()
}

function refreshPolicyFromConfiguration(
  configuration: unknown
): ResearchCampaignRefreshPolicy | null {
  if (!configuration || typeof configuration !== 'object') return null
  const parsed = researchCampaignConfigurationSchema.safeParse(configuration)
  return parsed.success ? parsed.data.refreshPolicy : null
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

function sourceIdsFromConfiguration(configuration: unknown): string[] {
  if (!configuration || typeof configuration !== 'object') return []
  const record = configuration as Record<string, unknown>
  const sourceIds = record.sourceIds
  if (Array.isArray(sourceIds)) {
    return sourceIds.filter((value): value is string => typeof value === 'string')
  }
  return typeof record.sourceId === 'string' ? [record.sourceId] : []
}

function campaignContentHash(input: {
  name: string
  purpose: string
  configuration: unknown
  budget: unknown
  synthetic: boolean
}): string {
  return contentHash(input)
}

function selectCampaignColumns(): string {
  return `SELECT workspace_id, campaign_id, name, purpose, state,
                 configuration, budget, synthetic, created_at, updated_at,
                 refresh_next_due_at, refresh_claim_owner, refresh_claim_token,
                 refresh_claim_until, refresh_pending_due_at, refresh_pending_run_id,
                 refresh_pending_workflow_id, refresh_pending_idempotency_digest,
                 refresh_pending_input_hash, refresh_pending_request, refresh_attempt_count,
                 refresh_last_run_id, refresh_last_workflow_id, refresh_last_started_at,
                 refresh_failure_code, refresh_failure_summary, refresh_updated_at
            FROM appsea.research_campaigns`
}

async function readSources(
  client: PoolClient,
  sourceIds: string[]
): Promise<ResearchCampaignSourceReadModel[]> {
  if (sourceIds.length === 0) return []
  const result = await client.query<SourceRow>(
    `SELECT source.source_id, source.display_name, source.source_type,
            source.lifecycle_state, policy.policy_version, policy.policy_state,
            policy.permitted_purposes, policy.display_mode, policy.coverage_notes,
            policy.reviewed_at, policy.expires_at
       FROM appsea.sources source
       LEFT JOIN appsea.source_policy_versions policy
         ON policy.source_id = source.source_id
        AND policy.policy_version = source.current_policy_version
      WHERE source.source_id = ANY($1::text[])
      ORDER BY source.source_id`,
    [sourceIds]
  )
  return result.rows.map((row) => {
    const expiresAt = asIso(row.expires_at)
    return researchCampaignSourceReadModelSchema.parse({
      sourceId: row.source_id,
      displayName: row.display_name,
      sourceType: row.source_type,
      lifecycleState: row.lifecycle_state,
      policyVersion: row.policy_version,
      policyState: row.policy_state,
      permittedPurposes: row.permitted_purposes ?? [],
      displayMode: row.display_mode,
      // The immutable draft payload's `enabled` field is intentionally false
      // before review and is not the runtime activation signal. Activation is
      // represented by the source lifecycle plus the reviewed policy state.
      enabled:
        row.lifecycle_state === 'active' &&
        row.policy_state === 'approved' &&
        (expiresAt === null || Date.parse(expiresAt) > Date.now()),
      synthetic: row.source_type === 'fixture',
      coverageNotes: row.coverage_notes ?? [],
      reviewedAt: asIso(row.reviewed_at),
      expiresAt
    })
  })
}

async function validateCampaignSources(
  client: PoolClient,
  workspaceFixtureOnly: boolean,
  purpose: string,
  sourceIds: string[]
): Promise<void> {
  const sourceRows = await client.query<SourceRow>(
    `SELECT source.source_id, source.display_name, source.source_type,
            source.lifecycle_state, policy.policy_version, policy.policy_state,
            policy.permitted_purposes, policy.display_mode, policy.coverage_notes,
            policy.reviewed_at, policy.expires_at
       FROM appsea.sources source
       LEFT JOIN appsea.source_policy_versions policy
         ON policy.source_id = source.source_id
        AND policy.policy_version = source.current_policy_version
      WHERE source.source_id = ANY($1::text[])
      ORDER BY source.source_id
      FOR SHARE OF source`,
    [sourceIds]
  )
  const sourceIdsFound = new Set(sourceRows.rows.map((row) => row.source_id))
  const missing = sourceIds.filter((id) => !sourceIdsFound.has(id))
  if (missing.length > 0) {
    throw new ResearchCampaignSourceError(`Unknown campaign source: ${missing[0]}`)
  }
  for (const source of sourceRows.rows) {
    if (workspaceFixtureOnly !== (source.source_type === 'fixture')) {
      throw new ResearchCampaignSourceError(
        'Fixture and non-fixture sources cannot be mixed with this workspace'
      )
    }
    if (
      source.policy_state === 'approved' &&
      !(source.permitted_purposes ?? []).includes(purpose)
    ) {
      throw new ResearchCampaignSourceError(
        `Source ${source.source_id} is not approved for campaign purpose ${purpose}`
      )
    }
  }
}

function validateManualImportRefresh(configuration: ResearchCampaignConfiguration): void {
  if (
    configuration.sourceIds.includes('manual-owner-import') &&
    configuration.refreshPolicy !== 'manual'
  ) {
    throw new ResearchCampaignSourceError(
      'Owner-authorized manual imports require manual refresh; a scheduled refresh cannot invent a staged batch'
    )
  }
}

async function readModel(client: PoolClient, row: CampaignRow): Promise<ResearchCampaignReadModel> {
  const sourceIds = sourceIdsFromConfiguration(row.configuration)
  const refreshPolicy = refreshPolicyFromConfiguration(row.configuration)
  const refreshSchedule =
    refreshPolicy && row.state !== 'archived' && row.refresh_updated_at !== undefined
      ? researchCampaignRefreshScheduleReadModelSchema.parse({
          state:
            row.refresh_claim_token != null
              ? 'dispatching'
              : row.refresh_failure_code != null
                ? 'failed'
                : refreshPolicy === 'manual'
                  ? 'manual'
                  : 'scheduled',
          refreshPolicy,
          nextDueAt: asIso(row.refresh_next_due_at),
          lastRunId: row.refresh_last_run_id,
          lastWorkflowId: row.refresh_last_workflow_id,
          lastStartedAt: asIso(row.refresh_last_started_at),
          failureCode: row.refresh_failure_code
            ? researchCampaignRefreshFailureCodeSchema.parse(row.refresh_failure_code)
            : null,
          failureSummary: row.refresh_failure_summary
        })
      : null
  return researchCampaignReadModelSchema.parse({
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    name: row.name,
    purpose: row.purpose,
    state: row.state,
    configuration: row.configuration,
    budget: row.budget,
    synthetic: row.synthetic,
    sources: await readSources(client, sourceIds),
    refreshSchedule,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  })
}

function eventId(prefix: string, workspaceId: string, campaignId: string): string {
  return `${prefix}:campaign:${contentHash({ workspaceId, campaignId }).slice(0, 32)}`
}

function mutationEventId(
  prefix: string,
  workspaceId: string,
  campaignId: string,
  operation: string,
  content: unknown = null
): string {
  return `${prefix}:campaign:${contentHash({ workspaceId, campaignId, operation, content }).slice(0, 32)}`
}

export class PostgresResearchCampaignRepository {
  constructor(private readonly pool: Pool) {}

  async createForUser(
    userId: string,
    workspaceId: string,
    input: ResearchCampaignCreateInput
  ): Promise<ResearchCampaignReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInput = researchCampaignCreateInputSchema.parse(input)
    const now = new Date().toISOString()
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') throw new ResearchCampaignPermissionError()
        const workspaceResult = await client.query<{
          fixture_only: boolean
          visibility: string
          status: string
        }>(
          `SELECT fixture_only, visibility, status
             FROM appsea.workspaces
            WHERE workspace_id = $1`,
          [parsedWorkspaceId]
        )
        const workspace = workspaceResult.rows[0]
        if (!workspace || workspace.visibility !== 'private' || workspace.status !== 'active') {
          throw new ResearchCampaignPermissionError()
        }

        await validateCampaignSources(
          client,
          workspace.fixture_only,
          parsedInput.purpose,
          parsedInput.configuration.sourceIds
        )
        validateManualImportRefresh(parsedInput.configuration)

        const existingResult = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1 AND campaign_id = $2
             FOR UPDATE`,
          [parsedWorkspaceId, parsedInput.campaignId]
        )
        const existing = existingResult.rows[0]
        if (existing) {
          const existingHash = campaignContentHash({
            name: existing.name,
            purpose: existing.purpose,
            configuration: existing.configuration,
            budget: existing.budget,
            synthetic: existing.synthetic
          })
          const requestedHash = campaignContentHash({
            name: parsedInput.name,
            purpose: parsedInput.purpose,
            configuration: parsedInput.configuration,
            budget: parsedInput.budget,
            synthetic: workspace.fixture_only
          })
          if (existingHash !== requestedHash) throw new ResearchCampaignConflictError()
          return readModel(client, existing)
        }

        const inserted = await client.query<CampaignRow>(
          `INSERT INTO appsea.research_campaigns
           (workspace_id, campaign_id, name, purpose, state, configuration, budget,
              synthetic, created_at, updated_at, refresh_next_due_at, refresh_updated_at)
           VALUES ($1, $2, $3, $4, 'draft', $5::jsonb, $6::jsonb, $7, $8, $8, $9, $8)
           RETURNING workspace_id, campaign_id, name, purpose, state, configuration,
                     budget, synthetic, created_at, updated_at,
                     refresh_next_due_at, refresh_claim_owner, refresh_claim_token,
                     refresh_claim_until, refresh_pending_due_at, refresh_pending_run_id,
                     refresh_pending_workflow_id, refresh_pending_idempotency_digest,
                     refresh_pending_input_hash, refresh_pending_request, refresh_attempt_count,
                     refresh_last_run_id, refresh_last_workflow_id, refresh_last_started_at,
                     refresh_failure_code, refresh_failure_summary, refresh_updated_at`,
          [
            parsedWorkspaceId,
            parsedInput.campaignId,
            parsedInput.name,
            parsedInput.purpose,
            JSON.stringify(parsedInput.configuration),
            JSON.stringify(parsedInput.budget),
            workspace.fixture_only,
            now,
            nextRefreshAt(parsedInput.configuration.refreshPolicy, now)
          ]
        )
        const row = inserted.rows[0]
        if (!row) throw new Error('Research campaign was not created')
        const model = await readModel(client, row)
        const metadata = JSON.stringify({
          sourceIds: parsedInput.configuration.sourceIds,
          purpose: parsedInput.purpose,
          synthetic: workspace.fixture_only
        })
        await client.query(
          `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action,
              target_type, target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.campaign.created',
                   'research_campaign', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            eventId('audit', parsedWorkspaceId, parsedInput.campaignId),
            parsedUserId,
            parsedInput.campaignId,
            metadata,
            now
          ]
        )
        await client.query(
          `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type,
              aggregate_id, schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.campaign.created', 'research_campaign',
                   $3, '1.0.0', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            eventId('outbox', parsedWorkspaceId, parsedInput.campaignId),
            parsedInput.campaignId,
            JSON.stringify({
              workspaceId: parsedWorkspaceId,
              campaignId: parsedInput.campaignId,
              sourceIds: parsedInput.configuration.sourceIds,
              synthetic: workspace.fixture_only
            }),
            now
          ]
        )
        return model
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  /**
   * Replace a campaign's editable draft intent. A changed validated campaign
   * returns to draft so a future admission must re-check the new inputs.
   * Completed/running history is never rewritten through this boundary.
   */
  async updateForUser(
    userId: string,
    workspaceId: string,
    campaignId: string,
    input: ResearchCampaignUpdateInput
  ): Promise<ResearchCampaignReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    const parsedInput = researchCampaignUpdateInputSchema.parse(input)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') throw new ResearchCampaignPermissionError()

        const workspaceResult = await client.query<{
          fixture_only: boolean
          visibility: string
          status: string
        }>(
          `SELECT fixture_only, visibility, status
             FROM appsea.workspaces
            WHERE workspace_id = $1`,
          [parsedWorkspaceId]
        )
        const workspace = workspaceResult.rows[0]
        if (!workspace || workspace.visibility !== 'private' || workspace.status !== 'active') {
          throw new ResearchCampaignPermissionError()
        }

        const existingResult = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1 AND campaign_id = $2
             FOR UPDATE`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        const existing = existingResult.rows[0]
        if (!existing) return null

        await validateCampaignSources(
          client,
          workspace.fixture_only,
          parsedInput.purpose,
          parsedInput.configuration.sourceIds
        )
        validateManualImportRefresh(parsedInput.configuration)
        const requestedHash = campaignContentHash({
          name: parsedInput.name,
          purpose: parsedInput.purpose,
          configuration: parsedInput.configuration,
          budget: parsedInput.budget,
          synthetic: workspace.fixture_only
        })
        const existingHash = campaignContentHash({
          name: existing.name,
          purpose: existing.purpose,
          configuration: existing.configuration,
          budget: existing.budget,
          synthetic: existing.synthetic
        })
        if (existingHash === requestedHash) return readModel(client, existing)
        if (existing.state === 'archived') {
          throw new ResearchCampaignStateError('Archived campaigns cannot be edited')
        }
        if (!['draft', 'validated'].includes(existing.state)) {
          throw new ResearchCampaignStateError(`Campaign state ${existing.state} cannot be edited`)
        }

        const occurredAt = new Date().toISOString()
        const updated = await client.query<CampaignRow>(
          `UPDATE appsea.research_campaigns
              SET name = $3,
                  purpose = $4,
                  state = 'draft',
                  configuration = $5::jsonb,
                  budget = $6::jsonb,
                  updated_at = $7,
                  refresh_next_due_at = $8,
                  refresh_claim_owner = NULL,
                  refresh_claim_token = NULL,
                  refresh_claim_until = NULL,
                  refresh_pending_due_at = NULL,
                  refresh_pending_run_id = NULL,
                  refresh_pending_workflow_id = NULL,
                  refresh_pending_idempotency_digest = NULL,
                  refresh_pending_input_hash = NULL,
                  refresh_pending_request = NULL,
                  refresh_attempt_count = 0,
                  refresh_failure_code = NULL,
                  refresh_failure_summary = NULL,
                  refresh_updated_at = $7
            WHERE workspace_id = $1 AND campaign_id = $2
            RETURNING workspace_id, campaign_id, name, purpose, state, configuration,
                      budget, synthetic, created_at, updated_at,
                      refresh_next_due_at, refresh_claim_owner, refresh_claim_token,
                      refresh_claim_until, refresh_pending_due_at, refresh_pending_run_id,
                      refresh_pending_workflow_id, refresh_pending_idempotency_digest,
                      refresh_pending_input_hash, refresh_pending_request, refresh_attempt_count,
                      refresh_last_run_id, refresh_last_workflow_id, refresh_last_started_at,
                      refresh_failure_code, refresh_failure_summary, refresh_updated_at`,
          [
            parsedWorkspaceId,
            parsedCampaignId,
            parsedInput.name,
            parsedInput.purpose,
            JSON.stringify(parsedInput.configuration),
            JSON.stringify(parsedInput.budget),
            occurredAt,
            nextRefreshAt(parsedInput.configuration.refreshPolicy, occurredAt)
          ]
        )
        const row = updated.rows[0]
        if (!row) return null
        const model = await readModel(client, row)
        const metadata = JSON.stringify({
          sourceIds: parsedInput.configuration.sourceIds,
          purpose: parsedInput.purpose,
          synthetic: workspace.fixture_only,
          contentHash: requestedHash
        })
        const operation = `updated:${requestedHash}`
        await client.query(
          `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action,
              target_type, target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.campaign.updated',
                   'research_campaign', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            mutationEventId('audit', parsedWorkspaceId, parsedCampaignId, operation),
            parsedUserId,
            parsedCampaignId,
            metadata,
            row.updated_at
          ]
        )
        await client.query(
          `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type,
              aggregate_id, schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.campaign.updated', 'research_campaign',
                   $3, '1.0.0', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            mutationEventId('outbox', parsedWorkspaceId, parsedCampaignId, operation),
            parsedCampaignId,
            JSON.stringify({
              workspaceId: parsedWorkspaceId,
              campaignId: parsedCampaignId,
              sourceIds: parsedInput.configuration.sourceIds,
              synthetic: workspace.fixture_only
            }),
            row.updated_at
          ]
        )
        return model
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  /** Archive a campaign without deleting its runs, evidence, or lineage. */
  async archiveForUser(
    userId: string,
    workspaceId: string,
    campaignId: string
  ): Promise<ResearchCampaignReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
        if (role !== 'owner' && role !== 'editor') throw new ResearchCampaignPermissionError()
        const existingResult = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1 AND campaign_id = $2
             FOR UPDATE`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        const existing = existingResult.rows[0]
        if (!existing) return null
        if (existing.state === 'archived') return readModel(client, existing)
        if (['queued', 'running', 'paused'].includes(existing.state)) {
          throw new ResearchCampaignStateError(
            `Campaign state ${existing.state} must stop before it can be archived`
          )
        }
        const occurredAt = new Date().toISOString()
        const updated = await client.query<CampaignRow>(
          `UPDATE appsea.research_campaigns
              SET state = 'archived',
                  updated_at = $3,
                  refresh_next_due_at = NULL,
                  refresh_claim_owner = NULL,
                  refresh_claim_token = NULL,
                  refresh_claim_until = NULL,
                  refresh_pending_due_at = NULL,
                  refresh_pending_run_id = NULL,
                  refresh_pending_workflow_id = NULL,
                  refresh_pending_idempotency_digest = NULL,
                  refresh_pending_input_hash = NULL,
                  refresh_pending_request = NULL,
                  refresh_attempt_count = 0,
                  refresh_failure_code = NULL,
                  refresh_failure_summary = NULL,
                  refresh_updated_at = $3
            WHERE workspace_id = $1 AND campaign_id = $2
            RETURNING workspace_id, campaign_id, name, purpose, state, configuration,
                      budget, synthetic, created_at, updated_at,
                      refresh_next_due_at, refresh_claim_owner, refresh_claim_token,
                      refresh_claim_until, refresh_pending_due_at, refresh_pending_run_id,
                      refresh_pending_workflow_id, refresh_pending_idempotency_digest,
                      refresh_pending_input_hash, refresh_pending_request, refresh_attempt_count,
                      refresh_last_run_id, refresh_last_workflow_id, refresh_last_started_at,
                      refresh_failure_code, refresh_failure_summary, refresh_updated_at`,
          [parsedWorkspaceId, parsedCampaignId, occurredAt]
        )
        const row = updated.rows[0]
        if (!row) return null
        const operation = `archived:${row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at}`
        const metadata = JSON.stringify({
          previousState: existing.state,
          preservedLineage: true,
          synthetic: existing.synthetic
        })
        await client.query(
          `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action,
              target_type, target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.campaign.archived',
                   'research_campaign', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            mutationEventId('audit', parsedWorkspaceId, parsedCampaignId, operation),
            parsedUserId,
            parsedCampaignId,
            metadata,
            row.updated_at
          ]
        )
        await client.query(
          `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type,
              aggregate_id, schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.campaign.archived', 'research_campaign',
                   $3, '1.0.0', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
          [
            parsedWorkspaceId,
            mutationEventId('outbox', parsedWorkspaceId, parsedCampaignId, operation),
            parsedCampaignId,
            JSON.stringify({
              workspaceId: parsedWorkspaceId,
              campaignId: parsedCampaignId,
              synthetic: existing.synthetic
            }),
            row.updated_at
          ]
        )
        return readModel(client, row)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async listForUser(userId: string, workspaceId: string): Promise<ResearchCampaignReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1
             ORDER BY updated_at DESC, campaign_id`,
          [parsedWorkspaceId]
        )
        return Promise.all(result.rows.map((row) => readModel(client, row)))
      },
      { readOnly: true }
    )
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    campaignId: string
  ): Promise<ResearchCampaignReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCampaignId = appseaIdentifierSchema.parse(campaignId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1 AND campaign_id = $2`,
          [parsedWorkspaceId, parsedCampaignId]
        )
        const row = result.rows[0]
        return row ? readModel(client, row) : null
      },
      { readOnly: true }
    )
  }

  /** List active private workspaces without exposing a general table read. */
  async listRefreshWorkspaceIds(): Promise<string[]> {
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

  /** Claim one due refresh. The claim and its deterministic identity are durable. */
  async claimNextRefreshForService(
    workspaceId: string,
    claimOwner: string,
    claimToken: string,
    leaseSeconds: number,
    fence?: MaintenanceSchedulerFence
  ): Promise<ResearchCampaignRefreshClaim | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOwner = maintenanceSchedulerOwnerIdSchema.parse(claimOwner)
    const parsedToken = maintenanceSchedulerLeaseTokenSchema.parse(claimToken)
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw new Error('Campaign refresh claim lease must be an integer between 30 and 3600 seconds')
    }
    return withServiceWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const candidate = await client.query<CampaignRow>(
          `${selectCampaignColumns()}
             WHERE workspace_id = $1
               AND synthetic = false
               AND state <> 'archived'
               AND configuration->>'refreshPolicy' IN ('daily', 'weekly', 'monthly')
               AND refresh_next_due_at IS NOT NULL
               AND refresh_next_due_at <= clock_timestamp()
               AND (refresh_claim_until IS NULL OR refresh_claim_until <= clock_timestamp())
               AND refresh_attempt_count < 10
             ORDER BY refresh_next_due_at ASC, campaign_id ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1`,
          [parsedWorkspaceId]
        )
        const row = candidate.rows[0]
        if (!row) return null

        const dueAt = asIso(row.refresh_pending_due_at ?? row.refresh_next_due_at)
        if (!dueAt) throw new Error('Due campaign refresh is missing its due timestamp')
        const identity = contentHash({
          workspaceId: parsedWorkspaceId,
          campaignId: row.campaign_id,
          dueAt
        })
        const runId = row.refresh_pending_run_id ?? `run:campaign-refresh:${identity.slice(0, 48)}`
        const idempotencyKey = `campaign-refresh:${identity}`
        const idempotencyDigest =
          row.refresh_pending_idempotency_digest ??
          contentHash({
            endpoint: 'production-collection',
            workflowType: 'productionCollectionWorkflow',
            workflowVersion: 'production-collection-v1',
            workspaceId: parsedWorkspaceId,
            idempotencyKey
          })
        const workflowId =
          row.refresh_pending_workflow_id ??
          `workflow:production:${parsedWorkspaceId}:${idempotencyDigest.slice(0, 32)}`
        const claimed = await client.query<CampaignRow>(
          `WITH clock AS (SELECT clock_timestamp() AS now)
           UPDATE appsea.research_campaigns campaign
              SET refresh_claim_owner = $2,
                  refresh_claim_token = $3,
                  refresh_claim_until = clock.now + make_interval(secs => $4::double precision),
                  refresh_pending_due_at = COALESCE(campaign.refresh_pending_due_at, campaign.refresh_next_due_at),
                  refresh_pending_run_id = COALESCE(campaign.refresh_pending_run_id, $5),
                  refresh_pending_workflow_id = COALESCE(campaign.refresh_pending_workflow_id, $6),
                  refresh_pending_idempotency_digest = COALESCE(campaign.refresh_pending_idempotency_digest, $7),
                  refresh_attempt_count = LEAST(campaign.refresh_attempt_count + 1, 10),
                  refresh_failure_code = NULL,
                  refresh_failure_summary = NULL,
                  refresh_updated_at = clock.now
             FROM clock
            WHERE campaign.workspace_id = $1 AND campaign.campaign_id = $8
            RETURNING campaign.workspace_id, campaign.campaign_id, campaign.name,
                      campaign.purpose, campaign.state, campaign.configuration,
                      campaign.budget, campaign.synthetic, campaign.created_at,
                      campaign.updated_at, campaign.refresh_next_due_at,
                      campaign.refresh_claim_owner, campaign.refresh_claim_token,
                      campaign.refresh_claim_until, campaign.refresh_pending_due_at,
                      campaign.refresh_pending_run_id, campaign.refresh_pending_workflow_id,
                      campaign.refresh_pending_idempotency_digest,
                      campaign.refresh_pending_input_hash, campaign.refresh_pending_request,
                      campaign.refresh_attempt_count, campaign.refresh_last_run_id,
                      campaign.refresh_last_workflow_id, campaign.refresh_last_started_at,
                      campaign.refresh_failure_code, campaign.refresh_failure_summary,
                      campaign.refresh_updated_at`,
          [
            parsedWorkspaceId,
            parsedOwner,
            parsedToken,
            leaseSeconds,
            runId,
            workflowId,
            idempotencyDigest,
            row.campaign_id
          ]
        )
        const claimedRow = claimed.rows[0]
        if (!claimedRow) throw new ResearchCampaignRefreshClaimLostError()
        const configuration = researchCampaignConfigurationSchema.parse(claimedRow.configuration)
        const budget = researchJobBudgetSchema.parse(claimedRow.budget)
        const pendingRequest = claimedRow.refresh_pending_request
          ? productionCollectionWorkflowStartRequestSchema.parse(claimedRow.refresh_pending_request)
          : null
        return {
          workspaceId: claimedRow.workspace_id,
          campaignId: claimedRow.campaign_id,
          purpose: claimedRow.purpose,
          configuration,
          budget,
          dueAt: asIso(claimedRow.refresh_pending_due_at ?? claimedRow.refresh_next_due_at)!,
          runId: claimedRow.refresh_pending_run_id ?? runId,
          idempotencyKey,
          workflowId: claimedRow.refresh_pending_workflow_id ?? workflowId,
          attemptCount: Number(claimedRow.refresh_attempt_count),
          pendingRequest,
          pendingIdempotencyDigest: claimedRow.refresh_pending_idempotency_digest,
          pendingInputHash: claimedRow.refresh_pending_input_hash
        }
      },
      { isolationLevel: 'READ COMMITTED', maintenanceFence: fence }
    )
  }

  async bindRefreshRequestForService(input: ResearchCampaignRefreshRequestBinding): Promise<void> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const campaignId = appseaIdentifierSchema.parse(input.campaignId)
    const claimOwner = maintenanceSchedulerOwnerIdSchema.parse(input.claimOwner)
    const claimToken = maintenanceSchedulerLeaseTokenSchema.parse(input.claimToken)
    const request = productionCollectionWorkflowStartRequestSchema.parse(input.request)
    const workflowId = workflowIdSchema.parse(input.workflowId)
    const idempotencyDigest = validateRefreshDigest(input.idempotencyDigest, 'idempotencyDigest')
    const inputHash = validateRefreshDigest(input.inputHash, 'inputHash')
    await withServiceWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
         UPDATE appsea.research_campaigns campaign
            SET refresh_pending_request = $5::jsonb,
                refresh_pending_workflow_id = $6,
                refresh_pending_idempotency_digest = $7,
                refresh_pending_input_hash = $8,
                refresh_updated_at = clock.now
           FROM clock
          WHERE campaign.workspace_id = $1
            AND campaign.campaign_id = $2
            AND campaign.refresh_claim_owner = $3
            AND campaign.refresh_claim_token = $4
            AND campaign.refresh_claim_until > clock.now`,
          [
            workspaceId,
            campaignId,
            claimOwner,
            claimToken,
            JSON.stringify(request),
            workflowId,
            idempotencyDigest,
            inputHash
          ]
        )
        if (result.rowCount !== 1) throw new ResearchCampaignRefreshClaimLostError()
      },
      { maintenanceFence: input.fence }
    )
  }

  async markRefreshDispatchedForService(input: ResearchCampaignRefreshDispatch): Promise<void> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const campaignId = appseaIdentifierSchema.parse(input.campaignId)
    const claimOwner = maintenanceSchedulerOwnerIdSchema.parse(input.claimOwner)
    const claimToken = maintenanceSchedulerLeaseTokenSchema.parse(input.claimToken)
    const runId = appseaIdentifierSchema.parse(input.runId)
    const workflowId = workflowIdSchema.parse(input.workflowId)
    const startedAt = new Date(input.startedAt).toISOString()
    await withServiceWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
         UPDATE appsea.research_campaigns campaign
            SET refresh_next_due_at = CASE campaign.configuration->>'refreshPolicy'
              WHEN 'daily' THEN clock.now + interval '1 day'
              WHEN 'weekly' THEN clock.now + interval '7 days'
              WHEN 'monthly' THEN clock.now + interval '30 days'
              ELSE NULL END,
                refresh_claim_owner = NULL,
                refresh_claim_token = NULL,
                refresh_claim_until = NULL,
                refresh_pending_due_at = NULL,
                refresh_pending_run_id = NULL,
                refresh_pending_workflow_id = NULL,
                refresh_pending_idempotency_digest = NULL,
                refresh_pending_input_hash = NULL,
                refresh_pending_request = NULL,
                refresh_attempt_count = 0,
                refresh_last_run_id = $3,
                refresh_last_workflow_id = $4,
                refresh_last_started_at = $5::timestamptz,
                refresh_failure_code = NULL,
                refresh_failure_summary = NULL,
                refresh_updated_at = clock.now
           FROM clock
          WHERE campaign.workspace_id = $1
            AND campaign.campaign_id = $2
            AND campaign.refresh_claim_owner = $6
            AND campaign.refresh_claim_token = $7
            AND (campaign.refresh_pending_workflow_id IS NULL OR campaign.refresh_pending_workflow_id = $4)
            AND campaign.refresh_claim_until > clock.now`,
          [workspaceId, campaignId, runId, workflowId, startedAt, claimOwner, claimToken]
        )
        if (result.rowCount !== 1) throw new ResearchCampaignRefreshClaimLostError()
      },
      { maintenanceFence: input.fence }
    )
  }

  async markRefreshFailedForService(input: ResearchCampaignRefreshFailure): Promise<void> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const campaignId = appseaIdentifierSchema.parse(input.campaignId)
    const claimOwner = maintenanceSchedulerOwnerIdSchema.parse(input.claimOwner)
    const claimToken = maintenanceSchedulerLeaseTokenSchema.parse(input.claimToken)
    const failureCode = researchCampaignRefreshFailureCodeSchema.parse(input.failureCode)
    const failureSummary = input.failureSummary.trim().slice(0, 240)
    if (!failureSummary) throw new Error('Campaign refresh failure summary cannot be empty')
    if (
      !Number.isSafeInteger(input.retryAfterSeconds) ||
      input.retryAfterSeconds < 1 ||
      input.retryAfterSeconds > 86_400
    ) {
      throw new Error('Campaign refresh retryAfterSeconds must be between 1 and 86400')
    }
    await withServiceWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query(
          `WITH clock AS (SELECT clock_timestamp() AS now)
         UPDATE appsea.research_campaigns campaign
            SET refresh_next_due_at = clock.now + make_interval(secs => $6::double precision),
                refresh_claim_owner = NULL,
                refresh_claim_token = NULL,
                refresh_claim_until = NULL,
                refresh_pending_due_at = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_due_at END,
                refresh_pending_run_id = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_run_id END,
                refresh_pending_workflow_id = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_workflow_id END,
                refresh_pending_idempotency_digest = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_idempotency_digest END,
                refresh_pending_input_hash = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_input_hash END,
                refresh_pending_request = CASE WHEN $7::boolean THEN NULL ELSE campaign.refresh_pending_request END,
                refresh_attempt_count = CASE WHEN $7::boolean THEN 0 ELSE campaign.refresh_attempt_count END,
                refresh_failure_code = $3,
                refresh_failure_summary = $4,
                refresh_updated_at = clock.now
           FROM clock
          WHERE campaign.workspace_id = $1
            AND campaign.campaign_id = $2
            AND campaign.refresh_claim_owner = $5
            AND campaign.refresh_claim_token = $8
            AND campaign.refresh_claim_until > clock.now`,
          [
            workspaceId,
            campaignId,
            failureCode,
            failureSummary,
            claimOwner,
            input.retryAfterSeconds,
            input.clearPending,
            claimToken
          ]
        )
        if (result.rowCount !== 1) throw new ResearchCampaignRefreshClaimLostError()
      },
      { maintenanceFence: input.fence }
    )
  }
}

function validateRefreshDigest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return value
}
