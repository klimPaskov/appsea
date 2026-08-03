import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  competitiveResearchObservationCreateInputSchema,
  competitiveResearchObservationReviewInputSchema,
  competitiveResearchObservationSchema,
  type CompetitiveResearchObservation,
  type CompetitiveResearchObservationCreateInput,
  type CompetitiveResearchObservationReviewInput
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

interface ObservationRow extends QueryResultRow {
  workspace_id: string
  observation_id: string
  opportunity_id: string
  competitor_id: string
  source_id: string
  source_record_id: string
  source_item_id: string
  evidence_id: string | null
  claim_type: string
  claim: string
  observed_at: Date | string
  captured_at: Date | string
  published_at: Date | string | null
  confidence: string | number
  review_state: 'unreviewed' | 'confirmed' | 'rejected'
  synthetic: boolean
  allowed_representation: 'excerpt' | 'metadata-only' | 'aggregate-only' | 'fixture'
  canonical_locator: string | null
  created_by: string
  reviewed_by: string | null
  reviewed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface SourceItemRow extends QueryResultRow {
  source_id: string
  source_record_id: string
  synthetic: boolean
  requested_display_mode: ObservationRow['allowed_representation']
}

export class CompetitiveResearchObservationNotFoundError extends Error {
  constructor() {
    super('Competitive research observation was not found')
    this.name = 'CompetitiveResearchObservationNotFoundError'
  }
}

export class CompetitiveResearchObservationPermissionError extends Error {
  constructor() {
    super('Competitive research observations require an editor or owner')
    this.name = 'CompetitiveResearchObservationPermissionError'
  }
}

export class CompetitiveResearchObservationConflictError extends Error {
  constructor() {
    super('Competitive research observation conflicts with existing provenance or review state')
    this.name = 'CompetitiveResearchObservationConflictError'
  }
}

export class CompetitiveResearchObservationPolicyError extends Error {
  constructor(cause?: unknown) {
    super('Competitive research observation is not permitted by the source policy')
    this.name = 'CompetitiveResearchObservationPolicyError'
    if (cause !== undefined) this.cause = cause
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime()))
    throw new Error('Stored competitive observation time is invalid')
  return date.toISOString()
}

function requiredIso(value: Date | string): string {
  const result = iso(value)
  if (result === null) throw new Error('Stored competitive observation time is missing')
  return result
}

function confidence(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('Stored competitive observation confidence is invalid')
  }
  return parsed
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

function isPolicyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '42501'
  )
}

function readModel(row: ObservationRow): CompetitiveResearchObservation {
  return competitiveResearchObservationSchema.parse({
    observationId: row.observation_id,
    opportunityId: row.opportunity_id,
    competitorId: row.competitor_id,
    sourceId: row.source_id,
    sourceRecordId: row.source_record_id,
    sourceItemId: row.source_item_id,
    evidenceId: row.evidence_id,
    claimType: row.claim_type,
    claim: row.claim,
    observedAt: requiredIso(row.observed_at),
    capturedAt: requiredIso(row.captured_at),
    publishedAt: iso(row.published_at),
    confidence: confidence(row.confidence),
    reviewState: row.review_state,
    synthetic: row.synthetic,
    allowedRepresentation: row.allowed_representation,
    canonicalLocator: row.canonical_locator,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  })
}

const selectColumns = `
  SELECT observation.workspace_id,
         observation.observation_id,
         observation.opportunity_id,
         observation.competitor_id,
         source_item.source_id,
         source_item.source_record_id,
         observation.source_item_id,
         observation.evidence_id,
         observation.claim_type,
         observation.claim,
         observation.observed_at,
         source_item.captured_at,
         source_item.published_at,
         observation.confidence,
         observation.review_state,
         observation.synthetic,
         observation.allowed_representation,
         source_item.canonical_locator,
         observation.created_by,
         observation.reviewed_by,
         observation.reviewed_at,
         observation.created_at,
         observation.updated_at
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
     AND source_item.deletion_state = 'active'
    LEFT JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
     AND evidence.deletion_state = 'active'`

function assertWorkspaceOpportunityId(value: string): string {
  return appseaIdentifierSchema.parse(value)
}

async function actorRole(client: PoolClient, workspaceId: string, userId: string): Promise<string> {
  const result = await client.query<{ role: string }>(
    `SELECT role
       FROM appsea.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2
      FOR SHARE`,
    [workspaceId, userId]
  )
  return result.rows[0]?.role ?? ''
}

async function assertEditorOrOwner(
  client: PoolClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const role = await actorRole(client, workspaceId, userId)
  if (role !== 'owner' && role !== 'editor') {
    throw new CompetitiveResearchObservationPermissionError()
  }
}

function sourceItemMaterial(row: SourceItemRow) {
  return {
    sourceId: row.source_id,
    sourceRecordId: row.source_record_id,
    synthetic: row.synthetic,
    allowedRepresentation: row.requested_display_mode
  }
}

function observationHash(
  opportunityId: string,
  input: CompetitiveResearchObservationCreateInput,
  sourceItem: SourceItemRow
): string {
  return contentHash({
    opportunityId,
    competitorId: input.competitorId,
    sourceItemId: input.sourceItemId,
    evidenceId: input.evidenceId,
    claimType: input.claimType,
    claim: input.claim,
    observedAt: input.observedAt,
    confidence: input.confidence,
    source: sourceItemMaterial(sourceItem)
  })
}

async function readRows(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string,
  observationId?: string
): Promise<ObservationRow[]> {
  const conditions = [
    'observation.workspace_id = $1',
    'observation.opportunity_id = $2',
    `(observation.synthetic OR evidence.evidence_id IS NOT NULL)`
  ]
  const parameters: string[] = [workspaceId, opportunityId]
  if (observationId) {
    conditions.push('observation.observation_id = $3')
    parameters.push(observationId)
  }
  const result = await client.query<ObservationRow>(
    `${selectColumns}
     WHERE ${conditions.join(' AND ')}
     ORDER BY observation.observed_at DESC, observation.observation_id`,
    parameters
  )
  return result.rows
}

export class PostgresCompetitiveResearchRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<CompetitiveResearchObservation[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = assertWorkspaceOpportunityId(opportunityId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const opportunity = await client.query(
          `SELECT 1
             FROM appsea.opportunities
            WHERE workspace_id = $1
              AND opportunity_id = $2
              AND availability_state = 'active'
            FOR SHARE`,
          [parsedWorkspaceId, parsedOpportunityId]
        )
        if (opportunity.rowCount !== 1) throw new CompetitiveResearchObservationNotFoundError()
        return (await readRows(client, parsedWorkspaceId, parsedOpportunityId)).map(readModel)
      },
      { readOnly: true }
    )
  }

  async create(
    userId: string,
    workspaceId: string,
    opportunityId: string,
    input: CompetitiveResearchObservationCreateInput
  ): Promise<CompetitiveResearchObservation> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = assertWorkspaceOpportunityId(opportunityId)
    const parsedInput = competitiveResearchObservationCreateInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          await assertEditorOrOwner(client, parsedWorkspaceId, parsedUserId)
          const workspace = await client.query<{ fixture_only: boolean; visibility: string }>(
            `SELECT fixture_only, visibility
               FROM appsea.workspaces
              WHERE workspace_id = $1 AND status = 'active'
              FOR SHARE`,
            [parsedWorkspaceId]
          )
          const workspaceRow = workspace.rows[0]
          if (!workspaceRow || workspaceRow.visibility !== 'private') {
            throw new CompetitiveResearchObservationPermissionError()
          }

          const opportunity = await client.query(
            `SELECT 1
               FROM appsea.opportunities
              WHERE workspace_id = $1
                AND opportunity_id = $2
                AND availability_state = 'active'
              FOR SHARE`,
            [parsedWorkspaceId, parsedOpportunityId]
          )
          if (opportunity.rowCount !== 1) throw new CompetitiveResearchObservationNotFoundError()

          const competitor = await client.query(
            `SELECT 1
               FROM appsea.opportunity_competitors
              WHERE workspace_id = $1
                AND opportunity_id = $2
                AND competitor_id = $3
              FOR SHARE`,
            [parsedWorkspaceId, parsedOpportunityId, parsedInput.competitorId]
          )
          if (competitor.rowCount !== 1) throw new CompetitiveResearchObservationNotFoundError()

          const sourceItem = await client.query<SourceItemRow>(
            `SELECT source_id, source_record_id, synthetic, requested_display_mode
               FROM appsea.source_items
              WHERE workspace_id = $1
                AND source_item_id = $2
                AND deletion_state = 'active'
              FOR SHARE`,
            [parsedWorkspaceId, parsedInput.sourceItemId]
          )
          const sourceItemRow = sourceItem.rows[0]
          if (!sourceItemRow) throw new CompetitiveResearchObservationNotFoundError()
          if (sourceItemRow.synthetic !== workspaceRow.fixture_only) {
            throw new CompetitiveResearchObservationPermissionError()
          }

          const clock = await client.query<{ now: Date | string }>(
            'SELECT clock_timestamp() AS now'
          )
          const now = iso(clock.rows[0]?.now ?? null)
          if (!now) throw new Error('Database server clock was unavailable')
          const inserted = await client.query(
            `INSERT INTO appsea.competitor_research_observations
               (workspace_id, observation_id, opportunity_id, competitor_id,
                source_id, source_record_id, source_item_id, evidence_id,
                claim_type, claim, observed_at, confidence, review_state,
                synthetic, allowed_representation, canonical_locator, content_hash,
                created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz,
                     $12, 'unreviewed', $13, $14, NULL, $15, $16, $17::timestamptz,
                     $17::timestamptz)
             RETURNING observation_id`,
            [
              parsedWorkspaceId,
              parsedInput.observationId,
              parsedOpportunityId,
              parsedInput.competitorId,
              sourceItemRow.source_id,
              sourceItemRow.source_record_id,
              parsedInput.sourceItemId,
              parsedInput.evidenceId,
              parsedInput.claimType,
              parsedInput.claim,
              parsedInput.observedAt,
              parsedInput.confidence,
              sourceItemRow.synthetic,
              sourceItemRow.requested_display_mode,
              observationHash(parsedOpportunityId, parsedInput, sourceItemRow),
              parsedUserId,
              now
            ]
          )
          if (!inserted.rows[0]) throw new Error('Competitive research observation was not created')
          const rows = await readRows(
            client,
            parsedWorkspaceId,
            parsedOpportunityId,
            parsedInput.observationId
          )
          const row = rows[0]
          if (!row)
            throw new Error('Competitive research observation was not readable after insert')
          return readModel(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new CompetitiveResearchObservationConflictError()
      if (isPolicyViolation(error)) throw new CompetitiveResearchObservationPolicyError(error)
      throw error
    }
  }

  async updateReview(
    userId: string,
    workspaceId: string,
    opportunityId: string,
    observationId: string,
    input: CompetitiveResearchObservationReviewInput
  ): Promise<CompetitiveResearchObservation> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = assertWorkspaceOpportunityId(opportunityId)
    const parsedObservationId = appseaIdentifierSchema.parse(observationId)
    const parsedInput = competitiveResearchObservationReviewInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          await assertEditorOrOwner(client, parsedWorkspaceId, parsedUserId)
          const existing = await client.query<{ review_state: ObservationRow['review_state'] }>(
            `SELECT review_state
               FROM appsea.competitor_research_observations
              WHERE workspace_id = $1
                AND opportunity_id = $2
                AND observation_id = $3
              FOR UPDATE`,
            [parsedWorkspaceId, parsedOpportunityId, parsedObservationId]
          )
          const current = existing.rows[0]?.review_state
          if (!current) throw new CompetitiveResearchObservationNotFoundError()
          if (current === 'rejected' && parsedInput.action !== 'rejected') {
            throw new CompetitiveResearchObservationConflictError()
          }
          if (current === parsedInput.action) {
            const rows = await readRows(
              client,
              parsedWorkspaceId,
              parsedOpportunityId,
              parsedObservationId
            )
            const row = rows[0]
            if (!row) throw new CompetitiveResearchObservationNotFoundError()
            return readModel(row)
          }

          const updated = await client.query(
            `UPDATE appsea.competitor_research_observations
                SET review_state = $4,
                    reviewed_by = $5,
                    reviewed_at = clock_timestamp(),
                    updated_at = clock_timestamp()
              WHERE workspace_id = $1
                AND opportunity_id = $2
                AND observation_id = $3
             RETURNING observation_id`,
            [
              parsedWorkspaceId,
              parsedOpportunityId,
              parsedObservationId,
              parsedInput.action,
              parsedUserId
            ]
          )
          if (!updated.rows[0]) throw new CompetitiveResearchObservationNotFoundError()
          const rows = await readRows(
            client,
            parsedWorkspaceId,
            parsedOpportunityId,
            parsedObservationId
          )
          const row = rows[0]
          if (!row) throw new CompetitiveResearchObservationNotFoundError()
          return readModel(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isPolicyViolation(error)) throw new CompetitiveResearchObservationPolicyError()
      throw error
    }
  }
}
