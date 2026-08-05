import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  deepResearchGateChecksSchema,
  deepResearchGateSchema,
  deepResearchGateTransitionInputSchema,
  objectReferenceSchema,
  productionResearchArtifactSchema,
  type ProductionResearchArtifact,
  type CompetitiveResearchObservation,
  type DeepResearchGate,
  type DeepResearchGateTransitionInput
} from '@appsea/contracts'
import type { ObjectStore } from '@appsea/object-store'
import { evaluateDeepResearchGate, type DeepResearchGateClusterReviewState } from '@appsea/research'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

interface GateRow extends QueryResultRow {
  workspace_id: string
  gate_id: string
  opportunity_id: string
  analysis_run_id: string
  artifact_id: string
  snapshot_hash: string
  status: DeepResearchGate['status']
  checks: unknown
  confirmed_observation_ids: string[]
  source_ids: string[]
  evidence_ids: string[]
  contrary_observation_ids: string[]
  competitor_relation_types: string[]
  blocking_reasons: string[]
  coverage_gaps: string[]
  created_by: string
  created_at: Date | string
  passed_by: string | null
  passed_at: Date | string | null
  withdrawn_by: string | null
  withdrawn_at: Date | string | null
  updated_at: Date | string
}

interface AnalysisRow extends QueryResultRow {
  analysis_run_id: string
  artifact_id: string
  opportunity_id: string
  state: string
  availability_state: string
  artifact_snapshot: unknown
  artifact_object_ref: unknown
  synthetic: boolean
}

interface ObservationRow extends QueryResultRow {
  observation_id: string
  opportunity_id: string
  competitor_id: string
  source_id: string
  source_record_id: string
  source_item_id: string
  evidence_id: string | null
  claim_type: CompetitiveResearchObservation['claimType']
  claim: string
  observed_at: Date | string
  captured_at: Date | string
  published_at: Date | string | null
  confidence: string | number
  review_state: CompetitiveResearchObservation['reviewState']
  synthetic: boolean
  allowed_representation: CompetitiveResearchObservation['allowedRepresentation']
  canonical_locator: string | null
  created_by: string
  reviewed_by: string | null
  reviewed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface ClusterReviewStateRow extends QueryResultRow {
  cluster_version_id: string
  review_state: DeepResearchGateClusterReviewState['reviewState']
}

export class DeepResearchGateNotFoundError extends Error {
  constructor() {
    super('Deep research gate or production analysis was not found')
    this.name = 'DeepResearchGateNotFoundError'
  }
}

export class DeepResearchGatePermissionError extends Error {
  constructor() {
    super('Deep research gate requires an editor or owner')
    this.name = 'DeepResearchGatePermissionError'
  }
}

export class DeepResearchGateConflictError extends Error {
  constructor() {
    super('Deep research gate transition conflicts with the current snapshot')
    this.name = 'DeepResearchGateConflictError'
  }
}

export class DeepResearchGateBlockedError extends Error {
  constructor(readonly gate: DeepResearchGate) {
    super('Deep research gate is not eligible to pass')
    this.name = 'DeepResearchGateBlockedError'
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Stored deep research gate time is invalid')
  return date.toISOString()
}

function requiredIso(value: Date | string): string {
  const result = iso(value)
  if (result === null) throw new Error('Stored deep research gate time is missing')
  return result
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function isPolicyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42501'
}

const selectColumns = `
  SELECT workspace_id, gate_id, opportunity_id, analysis_run_id, artifact_id,
         snapshot_hash, status, checks, confirmed_observation_ids, source_ids,
         evidence_ids, contrary_observation_ids, competitor_relation_types,
         blocking_reasons, coverage_gaps, created_by, created_at, passed_by,
         passed_at, withdrawn_by, withdrawn_at, updated_at
    FROM appsea.deep_research_gate_reviews`

const returnColumns = `workspace_id, gate_id, opportunity_id, analysis_run_id, artifact_id,
  snapshot_hash, status, checks, confirmed_observation_ids, source_ids, evidence_ids,
  contrary_observation_ids, competitor_relation_types, blocking_reasons, coverage_gaps,
  created_by, created_at, passed_by, passed_at, withdrawn_by, withdrawn_at, updated_at`

const observationSelect = `
  SELECT observation.observation_id, observation.opportunity_id,
         observation.competitor_id, source_item.source_id,
         source_item.source_record_id, observation.source_item_id,
         observation.evidence_id, observation.claim_type, observation.claim,
         observation.observed_at, source_item.captured_at,
         source_item.published_at, observation.confidence,
         observation.review_state, observation.synthetic,
         observation.allowed_representation, source_item.canonical_locator,
         observation.created_by, observation.reviewed_by, observation.reviewed_at,
         observation.created_at, observation.updated_at
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
     AND source_item.deletion_state = 'active'
    LEFT JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
     AND evidence.deletion_state = 'active'`

function observationModel(row: ObservationRow): CompetitiveResearchObservation {
  return {
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
    confidence: Number(row.confidence),
    reviewState: row.review_state,
    synthetic: row.synthetic,
    allowedRepresentation: row.allowed_representation,
    canonicalLocator: row.canonical_locator,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at)
  }
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

function snapshotMaterial(input: {
  opportunityId: string
  analysisRunId: string
  artifactId: string
  observations: CompetitiveResearchObservation[]
  competitorRelationTypes: string[]
  clusterReviewStates: readonly DeepResearchGateClusterReviewState[]
}): Record<string, unknown> {
  const confirmed = input.observations
    .filter(
      (observation) =>
        !observation.synthetic &&
        observation.reviewState === 'confirmed' &&
        observation.evidenceId !== null
    )
    .sort((left, right) => left.observationId.localeCompare(right.observationId))
  return {
    version: 'deep-research-gate-v1.0.0',
    opportunityId: input.opportunityId,
    analysisRunId: input.analysisRunId,
    artifactId: input.artifactId,
    confirmedObservationIds: confirmed.map((observation) => observation.observationId),
    sourceIds: [...new Set(confirmed.map((observation) => observation.sourceId))].sort(),
    evidenceIds: [
      ...new Set(
        confirmed.flatMap((observation) =>
          observation.evidenceId === null ? [] : [observation.evidenceId]
        )
      )
    ].sort(),
    contraryObservationIds: confirmed
      .filter((observation) => observation.claimType === 'contrary_signal')
      .map((observation) => observation.observationId),
    competitorRelationTypes: [...new Set(input.competitorRelationTypes)].sort(),
    clusterReviewStates: input.clusterReviewStates
      .map((cluster) => ({ ...cluster }))
      .sort((left, right) => left.clusterVersionId.localeCompare(right.clusterVersionId))
  }
}

function parseGate(
  row: GateRow,
  status: DeepResearchGate['status'] = row.status
): DeepResearchGate {
  return deepResearchGateSchema.parse({
    version: 'deep-research-gate-v1.0.0',
    gateId: row.gate_id,
    opportunityId: row.opportunity_id,
    analysisRunId: row.analysis_run_id,
    artifactId: row.artifact_id,
    snapshotHash: row.snapshot_hash,
    status,
    checks: deepResearchGateChecksSchema.parse(row.checks),
    confirmedObservationIds: row.confirmed_observation_ids,
    sourceIds: row.source_ids,
    evidenceIds: row.evidence_ids,
    contraryObservationIds: row.contrary_observation_ids,
    competitorRelationTypes: row.competitor_relation_types,
    blockingReasons: row.blocking_reasons,
    coverageGaps: row.coverage_gaps,
    createdBy: row.created_by,
    createdAt: requiredIso(row.created_at),
    passedBy: status === 'passed' || status === 'stale' ? row.passed_by : null,
    passedAt: status === 'passed' || status === 'stale' ? iso(row.passed_at) : null,
    withdrawnBy: status === 'withdrawn' ? row.withdrawn_by : null,
    withdrawnAt: status === 'withdrawn' ? iso(row.withdrawn_at) : null,
    updatedAt: requiredIso(row.updated_at)
  })
}

async function currentAnalysis(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<AnalysisRow | null> {
  const result = await client.query<AnalysisRow>(
    `SELECT analysis.analysis_run_id, analysis.artifact_id, analysis.opportunity_id,
            analysis.state, analysis.availability_state, analysis.artifact_snapshot,
            analysis.artifact_object_ref,
            opportunity.synthetic
       FROM appsea.production_analysis_runs analysis
       JOIN appsea.opportunities opportunity
         ON opportunity.workspace_id = analysis.workspace_id
        AND opportunity.opportunity_id = analysis.opportunity_id
      WHERE analysis.workspace_id = $1
        AND analysis.opportunity_id = $2
        AND analysis.state = 'completed'
        AND analysis.availability_state = 'active'
      ORDER BY analysis.completed_at DESC, analysis.analysis_run_id DESC
      LIMIT 1`,
    [workspaceId, opportunityId]
  )
  return result.rows[0] ?? null
}

async function artifactForAnalysis(
  objectStore: ObjectStore,
  workspaceId: string,
  analysis: AnalysisRow
): Promise<ProductionResearchArtifact | null> {
  const reference = objectReferenceSchema.safeParse(analysis.artifact_object_ref)
  if (
    !reference.success ||
    reference.data.workspaceId !== workspaceId ||
    reference.data.kind !== 'workflow-artifact' ||
    reference.data.deletionState !== 'active'
  ) {
    return null
  }
  const stored = await objectStore.get(workspaceId, reference.data)
  if (!stored || stored.reference.deletionState !== 'active') return null
  try {
    const artifact = productionResearchArtifactSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.body))
    )
    if (!artifact.success || artifact.data.id !== analysis.artifact_id) return null
    return artifact.data
  } catch {
    return null
  }
}

async function currentObservations(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<CompetitiveResearchObservation[]> {
  const result = await client.query<ObservationRow>(
    `${observationSelect}
     WHERE observation.workspace_id = $1
       AND observation.opportunity_id = $2
       AND (observation.synthetic OR evidence.evidence_id IS NOT NULL)
     ORDER BY observation.observed_at DESC, observation.observation_id`,
    [workspaceId, opportunityId]
  )
  return result.rows.map(observationModel)
}

async function currentClusterReviewStates(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string,
  runId: string
): Promise<DeepResearchGateClusterReviewState[]> {
  const result = await client.query<ClusterReviewStateRow>(
    `SELECT relation.cluster_version_id, cluster.review_state
       FROM appsea.research_run_cluster_versions relation
       JOIN appsea.complaint_cluster_versions cluster
         ON cluster.workspace_id = relation.workspace_id
        AND cluster.cluster_version_id = relation.cluster_version_id
        AND cluster.run_id = relation.run_id
      WHERE relation.workspace_id = $1
        AND relation.opportunity_id = $2
        AND relation.run_id = $3
        AND cluster.synthetic = false
      ORDER BY relation.cluster_version_id`,
    [workspaceId, opportunityId, runId]
  )
  return result.rows.map((row) => ({
    clusterVersionId: row.cluster_version_id,
    reviewState: row.review_state
  }))
}

async function latestGateRow(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<GateRow | null> {
  const result = await client.query<GateRow>(
    `${selectColumns}
     WHERE workspace_id = $1 AND opportunity_id = $2
     ORDER BY updated_at DESC, gate_id DESC
     LIMIT 1`,
    [workspaceId, opportunityId]
  )
  return result.rows[0] ?? null
}

async function readCurrentGate(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string,
  objectStore: ObjectStore
): Promise<DeepResearchGate | null> {
  const row = await latestGateRow(client, workspaceId, opportunityId)
  if (!row) return null
  const gate = parseGate(row)
  if (gate.status !== 'passed') return gate
  const analysis = await currentAnalysis(client, workspaceId, opportunityId)
  if (!analysis || analysis.synthetic) return staleGate(row)
  const artifact = await artifactForAnalysis(objectStore, workspaceId, analysis)
  if (!artifact) return staleGate(row)
  const observations = await currentObservations(client, workspaceId, opportunityId)
  const clusterReviewStates = await currentClusterReviewStates(
    client,
    workspaceId,
    opportunityId,
    analysis.analysis_run_id
  )
  const relationTypes = artifact.opportunity.competitors.map((competitor) => competitor.type)
  const expectedHash = contentHash(
    snapshotMaterial({
      opportunityId,
      analysisRunId: analysis.analysis_run_id,
      artifactId: analysis.artifact_id,
      observations,
      competitorRelationTypes: relationTypes,
      clusterReviewStates
    })
  )
  if (
    gate.analysisRunId !== analysis.analysis_run_id ||
    gate.artifactId !== analysis.artifact_id ||
    gate.snapshotHash !== expectedHash
  ) {
    return staleGate(row)
  }
  return gate
}

function staleGate(row: GateRow): DeepResearchGate {
  return deepResearchGateSchema.parse({
    ...parseGate(row, 'stale'),
    blockingReasons: [
      ...new Set([
        ...row.blocking_reasons,
        'The analysis, source evidence, or confirmed competitor observations changed after this gate was passed.'
      ])
    ]
  })
}

function gateId(input: {
  workspaceId: string
  opportunityId: string
  analysisRunId: string
  snapshotHash: string
  action: DeepResearchGateTransitionInput['action']
  checks: unknown
}): string {
  return `deep-research-gate:${contentHash(input).slice(0, 32)}`
}

export class PostgresDeepResearchGateRepository {
  constructor(
    private readonly pool: Pool,
    private readonly objectStore: ObjectStore
  ) {}

  async readForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<DeepResearchGate | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      (client) => readCurrentGate(client, parsedWorkspaceId, parsedOpportunityId, this.objectStore),
      { readOnly: true }
    )
  }

  async transition(
    userId: string,
    workspaceId: string,
    opportunityId: string,
    input: DeepResearchGateTransitionInput
  ): Promise<DeepResearchGate> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    const parsedInput = deepResearchGateTransitionInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
          if (role !== 'owner' && role !== 'editor') throw new DeepResearchGatePermissionError()
          if (parsedInput.action !== 'submit' && role !== 'owner') {
            throw new DeepResearchGatePermissionError()
          }
          const analysis = await currentAnalysis(client, parsedWorkspaceId, parsedOpportunityId)
          if (!analysis || analysis.synthetic) throw new DeepResearchGateNotFoundError()
          const artifact = await artifactForAnalysis(this.objectStore, parsedWorkspaceId, analysis)
          if (!artifact) throw new DeepResearchGateNotFoundError()
          const observations = await currentObservations(
            client,
            parsedWorkspaceId,
            parsedOpportunityId
          )
          const relationTypes = artifact.opportunity.competitors.map(
            (competitor) => competitor.type
          )
          const clusterReviewStates = await currentClusterReviewStates(
            client,
            parsedWorkspaceId,
            parsedOpportunityId,
            analysis.analysis_run_id
          )
          const existingCurrentGate =
            parsedInput.action === 'withdraw'
              ? await readCurrentGate(
                  client,
                  parsedWorkspaceId,
                  parsedOpportunityId,
                  this.objectStore
                )
              : null
          if (
            parsedInput.action === 'withdraw' &&
            (!existingCurrentGate || existingCurrentGate.status !== 'passed')
          ) {
            throw new DeepResearchGateConflictError()
          }
          const checks = parsedInput.checks ?? existingCurrentGate?.checks
          if (!checks) throw new DeepResearchGateConflictError()
          const evaluation = evaluateDeepResearchGate({
            artifact,
            observations,
            checks,
            clusterReviewStates
          })
          const material = snapshotMaterial({
            opportunityId: parsedOpportunityId,
            analysisRunId: analysis.analysis_run_id,
            artifactId: analysis.artifact_id,
            observations,
            competitorRelationTypes: relationTypes,
            clusterReviewStates
          })
          const snapshotHash = contentHash(material)
          const status: DeepResearchGate['status'] =
            parsedInput.action === 'withdraw'
              ? 'withdrawn'
              : parsedInput.action === 'pass' && evaluation.eligible
                ? 'passed'
                : 'not-ready'
          const id = gateId({
            workspaceId: parsedWorkspaceId,
            opportunityId: parsedOpportunityId,
            analysisRunId: analysis.analysis_run_id,
            snapshotHash,
            action: parsedInput.action,
            checks
          })
          const existing = await client.query<GateRow>(
            `${selectColumns} WHERE workspace_id = $1 AND gate_id = $2`,
            [parsedWorkspaceId, id]
          )
          if (existing.rows[0]) {
            const existingGate = parseGate(existing.rows[0])
            if (parsedInput.action === 'pass' && !evaluation.eligible) {
              throw new DeepResearchGateBlockedError(existingGate)
            }
            return existingGate
          }
          const inserted = await client.query<GateRow>(
            `INSERT INTO appsea.deep_research_gate_reviews
               (workspace_id, gate_id, opportunity_id, analysis_run_id, artifact_id,
                snapshot_hash, status, checks, confirmed_observation_ids, source_ids,
                evidence_ids, contrary_observation_ids, competitor_relation_types,
                blocking_reasons, coverage_gaps, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
                     $13, $14, $15, $16, clock_timestamp(), clock_timestamp())
             RETURNING ${returnColumns}`,
            [
              parsedWorkspaceId,
              id,
              parsedOpportunityId,
              analysis.analysis_run_id,
              analysis.artifact_id,
              snapshotHash,
              status,
              JSON.stringify(checks),
              evaluation.confirmedObservationIds,
              evaluation.sourceIds,
              evaluation.evidenceIds,
              evaluation.contraryObservationIds,
              evaluation.competitorRelationTypes,
              [...evaluation.blockingReasons, ...parsedInput.notes],
              evaluation.coverageGaps,
              parsedUserId
            ]
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('Deep research gate was not created')
          const gate = parseGate(row)
          if (parsedInput.action === 'pass' && !evaluation.eligible) {
            throw new DeepResearchGateBlockedError(gate)
          }
          return gate
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new DeepResearchGateConflictError()
      if (isPolicyViolation(error)) throw new DeepResearchGatePermissionError()
      throw error
    }
  }

  async withdraw(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<DeepResearchGate> {
    return this.transition(userId, workspaceId, opportunityId, { action: 'withdraw', notes: [] })
  }
}
