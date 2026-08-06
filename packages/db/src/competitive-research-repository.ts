import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  competitiveResearchObservationCreateInputSchema,
  competitiveResearchObservationReviewInputSchema,
  competitiveResearchObservationSchema,
  workspaceCompetitorTargetSchema,
  type CompetitiveResearchObservation,
  type CompetitiveResearchObservationCreateInput,
  type CompetitiveResearchObservationReviewInput,
  type ProductionCompetitiveResearchSnapshot,
  type WorkspaceCompetitorTarget
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction, withWorkspaceTransaction } from './transaction'

export type ProductionCompetitiveObservationSnapshot = ProductionCompetitiveResearchSnapshot

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

interface CompetitorTargetRow extends QueryResultRow {
  competitor_id: string
  name: string
  competitor_type: string
}

interface SnapshotObservationRow extends ObservationRow {
  content_hash: string
  evidence_content_hash: string
  competitor_name: string
  competitor_type: 'direct' | 'adjacent' | 'platform' | 'workaround' | 'do-nothing'
}

interface SnapshotCoverageRow extends QueryResultRow {
  review_state: ObservationRow['review_state']
  synthetic: boolean
  source_item_deletion_state: string | null
  evidence_deletion_state: string | null
  evidence_id: string | null
  relation_competitor_id: string | null
  competitor_synthetic: boolean | null
  collection_source_item_id: string | null
  collection_source_id: string | null
  collection_policy_source_id: string | null
}

/**
 * The private production-analysis handoff intentionally carries only the
 * validated observation projection.  It is structural so the contracts
 * package can add a richer named version without making this persistence
 * package depend on a caller-owned payload.
 */
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

const sourcePolicyClaimRedactionMarker = '[Content withheld by source policy]'

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
    claim:
      row.allowed_representation === 'excerpt' || row.allowed_representation === 'fixture'
        ? row.claim
        : sourcePolicyClaimRedactionMarker,
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

const productionSnapshotSelect = `
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
         observation.updated_at,
         observation.content_hash,
         evidence.content_hash AS evidence_content_hash,
         competitor.name AS competitor_name,
         competitor.competitor_type
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
    JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
    JOIN appsea.research_run_source_items collection_item
      ON collection_item.workspace_id = observation.workspace_id
     AND collection_item.run_id = $2
     AND collection_item.source_item_id = observation.source_item_id
     AND collection_item.source_id = source_item.source_id
     AND collection_item.source_policy_version = source_item.source_policy_version
    JOIN appsea.research_run_source_policies collection_policy
      ON collection_policy.workspace_id = collection_item.workspace_id
     AND collection_policy.run_id = collection_item.run_id
     AND collection_policy.source_id = collection_item.source_id
     AND collection_policy.policy_version = collection_item.source_policy_version
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source_item.source_id
     AND policy.policy_version = source_item.source_policy_version
    JOIN appsea.sources source
      ON source.source_id = source_item.source_id
    JOIN appsea.source_policy_reviews policy_review
      ON policy_review.source_id = policy.source_id
     AND policy_review.policy_version = policy.policy_version
     AND policy_review.content_hash = policy.content_hash
     AND policy_review.decision = 'approved'
     AND policy_review.independence_attested
     AND policy_review.reviewer_role <> 'legacy'
     AND (
       COALESCE((policy.policy_payload->>'permissionEvidenceRequired')::boolean, false) = false
       OR NULLIF(trim(policy_review.permission_evidence_reference), '') IS NOT NULL
     )
    JOIN appsea.opportunity_competitors relation
      ON relation.workspace_id = observation.workspace_id
     AND relation.opportunity_id = observation.opportunity_id
     AND relation.competitor_id = observation.competitor_id
    JOIN appsea.competitors competitor
      ON competitor.workspace_id = relation.workspace_id
     AND competitor.competitor_id = relation.competitor_id
   WHERE observation.workspace_id = $1
     AND observation.opportunity_id = $3
     AND observation.review_state = 'confirmed'
     AND observation.synthetic = false
     AND observation.evidence_id IS NOT NULL
     AND source_item.deletion_state = 'active'
     AND evidence.deletion_state = 'active'
     AND evidence.synthetic = false
     AND evidence.redacted = true
     AND evidence.allowed_representation = source_item.requested_display_mode
     AND source.source_type <> 'fixture'
     AND source.lifecycle_state = 'active'
     AND source.current_policy_version = policy.policy_version
     AND policy.policy_state = 'approved'
     AND appsea.source_policy_has_complete_reviews(
       policy.source_id, policy.policy_version, policy.content_hash
     )
     AND policy.commercial_use IN ('allowed', 'restricted')
     AND policy.reviewed_at IS NOT NULL
     AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
     AND source_item.collection_purpose IN ('competitor-research', 'contrary-evidence')
     AND source_item.collection_purpose = ANY(policy.permitted_purposes)
     AND competitor.synthetic = false
   ORDER BY observation.observation_id`

async function readProductionSnapshotRows(
  client: PoolClient,
  workspaceId: string,
  collectionRunId: string,
  opportunityId: string
): Promise<SnapshotObservationRow[]> {
  const result = await client.query<SnapshotObservationRow>(productionSnapshotSelect, [
    workspaceId,
    collectionRunId,
    opportunityId
  ])
  return result.rows
}

async function readProductionSnapshotCoverage(
  client: PoolClient,
  workspaceId: string,
  collectionRunId: string,
  opportunityId: string
): Promise<SnapshotCoverageRow[]> {
  const result = await client.query<SnapshotCoverageRow>(
    `SELECT observation.review_state,
            observation.synthetic,
            source_item.deletion_state AS source_item_deletion_state,
            evidence.deletion_state AS evidence_deletion_state,
            observation.evidence_id,
            relation.competitor_id AS relation_competitor_id,
            competitor.synthetic AS competitor_synthetic,
            collection_item.source_item_id AS collection_source_item_id,
            collection_item.source_id AS collection_source_id,
            collection_policy.source_id AS collection_policy_source_id
       FROM appsea.competitor_research_observations observation
       LEFT JOIN appsea.source_items source_item
         ON source_item.workspace_id = observation.workspace_id
        AND source_item.source_item_id = observation.source_item_id
       LEFT JOIN appsea.evidence_records evidence
         ON evidence.workspace_id = observation.workspace_id
        AND evidence.evidence_id = observation.evidence_id
       LEFT JOIN appsea.opportunity_competitors relation
         ON relation.workspace_id = observation.workspace_id
        AND relation.opportunity_id = observation.opportunity_id
        AND relation.competitor_id = observation.competitor_id
       LEFT JOIN appsea.competitors competitor
         ON competitor.workspace_id = relation.workspace_id
        AND competitor.competitor_id = relation.competitor_id
       LEFT JOIN appsea.research_run_source_items collection_item
         ON collection_item.workspace_id = observation.workspace_id
        AND collection_item.run_id = $2
        AND collection_item.source_item_id = observation.source_item_id
       LEFT JOIN appsea.research_run_source_policies collection_policy
         ON collection_policy.workspace_id = collection_item.workspace_id
        AND collection_policy.run_id = collection_item.run_id
        AND collection_policy.source_id = collection_item.source_id
        AND collection_policy.policy_version = collection_item.source_policy_version
      WHERE observation.workspace_id = $1
        AND observation.opportunity_id = $3`,
    [workspaceId, collectionRunId, opportunityId]
  )
  return result.rows
}

function productionSnapshotCoverageGaps(rows: SnapshotCoverageRow[], validCount: number): string[] {
  const gaps = new Set<string>()
  for (const row of rows) {
    if (row.review_state === 'rejected') {
      gaps.add('A competitive observation was rejected after the snapshot was captured.')
    }
    if (
      row.review_state === 'confirmed' &&
      (row.source_item_deletion_state !== 'active' || row.evidence_deletion_state !== 'active')
    ) {
      gaps.add('A confirmed competitive observation has deleted or inactive provenance.')
    }
    if (
      row.review_state === 'confirmed' &&
      (row.relation_competitor_id === null || row.competitor_synthetic !== false)
    ) {
      gaps.add('A confirmed competitive observation is missing an active non-synthetic competitor.')
    }
    if (
      row.review_state === 'confirmed' &&
      (row.evidence_id === null || row.collection_source_item_id === null)
    ) {
      gaps.add('A confirmed competitive observation is missing collection evidence lineage.')
    }
    if (
      row.review_state === 'confirmed' &&
      row.collection_source_item_id !== null &&
      (row.collection_source_id === null ||
        row.collection_policy_source_id !== row.collection_source_id)
    ) {
      gaps.add('A confirmed competitive observation is missing its collection source policy.')
    }
  }
  if (validCount === 0) {
    gaps.add('No confirmed non-synthetic competitor observations are available.')
  }
  return [...gaps]
}

/** Read the deterministic, policy-bound competitor/contrary snapshot inside a workspace transaction. */
export async function readConfirmedSnapshotForAnalysisInTransaction(
  client: PoolClient,
  workspaceId: string,
  collectionRunId: string,
  opportunityId: string
): Promise<ProductionCompetitiveObservationSnapshot> {
  const rows = await readProductionSnapshotRows(client, workspaceId, collectionRunId, opportunityId)
  const coverage = await readProductionSnapshotCoverage(
    client,
    workspaceId,
    collectionRunId,
    opportunityId
  )
  return {
    observations: rows.map((row) => {
      const observation = readModel(row)
      return {
        observationId: observation.observationId,
        opportunityId: observation.opportunityId,
        competitorId: observation.competitorId,
        competitorName: row.competitor_name,
        competitorType: row.competitor_type,
        sourceId: observation.sourceId,
        sourceRecordId: observation.sourceRecordId,
        sourceItemId: observation.sourceItemId,
        evidenceId: observation.evidenceId as string,
        observationHash: row.content_hash,
        evidenceHash: row.evidence_content_hash,
        claimType: observation.claimType,
        claim: observation.claim,
        observedAt: observation.observedAt,
        capturedAt: observation.capturedAt,
        publishedAt: observation.publishedAt,
        confidence: observation.confidence,
        reviewState: 'confirmed' as const,
        synthetic: false as const,
        allowedRepresentation: observation.allowedRepresentation as
          'excerpt' | 'metadata-only' | 'aggregate-only',
        canonicalLocator: observation.canonicalLocator
      }
    }),
    coverageGaps: productionSnapshotCoverageGaps(coverage, rows.length)
  }
}

export class PostgresCompetitiveResearchRepository {
  constructor(private readonly pool: Pool) {}

  async readConfirmedSnapshotForAnalysis(
    workspaceId: string,
    collectionRunId: string,
    opportunityId: string
  ): Promise<ProductionCompetitiveObservationSnapshot> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedCollectionRunId = appseaIdentifierSchema.parse(collectionRunId)
    const parsedOpportunityId = assertWorkspaceOpportunityId(opportunityId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      (client) =>
        readConfirmedSnapshotForAnalysisInTransaction(
          client,
          parsedWorkspaceId,
          parsedCollectionRunId,
          parsedOpportunityId
        ),
      { readOnly: true }
    )
  }

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
              AND availability_state = 'active'`,
          [parsedWorkspaceId, parsedOpportunityId]
        )
        if (opportunity.rowCount !== 1) throw new CompetitiveResearchObservationNotFoundError()
        return (await readRows(client, parsedWorkspaceId, parsedOpportunityId)).map(readModel)
      },
      { readOnly: true }
    )
  }

  async listTargetsForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<WorkspaceCompetitorTarget[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = assertWorkspaceOpportunityId(opportunityId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<CompetitorTargetRow>(
          `SELECT competitor.competitor_id,
                  competitor.name,
                  competitor.competitor_type
             FROM appsea.opportunity_competitors relation
             JOIN appsea.competitors competitor
               ON competitor.workspace_id = relation.workspace_id
              AND competitor.competitor_id = relation.competitor_id
            JOIN appsea.opportunities opportunity
               ON opportunity.workspace_id = relation.workspace_id
              AND opportunity.opportunity_id = relation.opportunity_id
            WHERE relation.workspace_id = $1
              AND relation.opportunity_id = $2
              AND opportunity.availability_state = 'active'
              AND competitor.synthetic = false
            ORDER BY competitor.name, competitor.competitor_id`,
          [parsedWorkspaceId, parsedOpportunityId]
        )
        return result.rows.map((row) =>
          workspaceCompetitorTargetSchema.parse({
            competitorId: row.competitor_id,
            name: row.name,
            type: row.competitor_type
          })
        )
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
                AND competitor_id = $3`,
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
