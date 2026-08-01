import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  researchCampaignCreateInputSchema,
  researchCampaignReadModelSchema,
  researchCampaignSourceReadModelSchema,
  type ResearchCampaignCreateInput,
  type ResearchCampaignReadModel,
  type ResearchCampaignSourceReadModel
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

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
}

interface SourceRow extends QueryResultRow {
  source_id: string
  display_name: string
  source_type: 'fixture' | 'api' | 'export' | 'licensed-feed' | 'manual'
  lifecycle_state: string
  policy_version: string | null
  policy_state: 'approved' | 'pending_review' | 'expired' | 'revoked' | null
  permitted_purposes: string[] | null
  coverage_notes: string[] | null
  reviewed_at: Date | string | null
  expires_at: Date | string | null
}

export class ResearchCampaignPermissionError extends Error {
  constructor() {
    super('The workspace role cannot create a research campaign')
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

function asIso(value: Date | string | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
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
                 configuration, budget, synthetic, created_at, updated_at
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
            policy.permitted_purposes, policy.coverage_notes,
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

async function readModel(client: PoolClient, row: CampaignRow): Promise<ResearchCampaignReadModel> {
  const sourceIds = sourceIdsFromConfiguration(row.configuration)
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
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  })
}

function eventId(prefix: string, workspaceId: string, campaignId: string): string {
  return `${prefix}:campaign:${contentHash({ workspaceId, campaignId }).slice(0, 32)}`
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

        const sourceRows = await client.query<SourceRow>(
          `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, policy.policy_version, policy.policy_state,
                  policy.permitted_purposes, policy.coverage_notes,
                  policy.reviewed_at, policy.expires_at
             FROM appsea.sources source
             LEFT JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = source.current_policy_version
            WHERE source.source_id = ANY($1::text[])
            ORDER BY source.source_id
            FOR SHARE OF source`,
          [parsedInput.configuration.sourceIds]
        )
        const sourceIds = new Set(sourceRows.rows.map((row) => row.source_id))
        const missing = parsedInput.configuration.sourceIds.filter((id) => !sourceIds.has(id))
        if (missing.length > 0) {
          throw new ResearchCampaignSourceError(`Unknown campaign source: ${missing[0]}`)
        }
        for (const source of sourceRows.rows) {
          if (workspace.fixture_only !== (source.source_type === 'fixture')) {
            throw new ResearchCampaignSourceError(
              'Fixture and non-fixture sources cannot be mixed with this workspace'
            )
          }
          if (
            source.policy_state === 'approved' &&
            !(source.permitted_purposes ?? []).includes(parsedInput.purpose)
          ) {
            throw new ResearchCampaignSourceError(
              `Source ${source.source_id} is not approved for campaign purpose ${parsedInput.purpose}`
            )
          }
        }

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
              synthetic, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'draft', $5::jsonb, $6::jsonb, $7, $8, $8)
           RETURNING workspace_id, campaign_id, name, purpose, state, configuration,
                     budget, synthetic, created_at, updated_at`,
          [
            parsedWorkspaceId,
            parsedInput.campaignId,
            parsedInput.name,
            parsedInput.purpose,
            JSON.stringify(parsedInput.configuration),
            JSON.stringify(parsedInput.budget),
            workspace.fixture_only,
            now
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
}
