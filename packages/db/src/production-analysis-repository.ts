import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  objectReferenceSchema,
  productionAnalysisGovernanceSchema,
  productionAnalysisPersistenceInputSchema,
  productionAnalysisReadModelSchema,
  productionAnalysisResultSchema,
  productionAnalysisSnapshotSchema,
  productionAnalysisStatusReadModelSchema,
  productionOpportunitySeedSchema,
  productionResearchArtifactSchema,
  type ObjectReference,
  type ProductionAnalysisPersistenceInput,
  type ProductionAnalysisReadModel,
  type ProductionAnalysisResult,
  type ProductionAnalysisSnapshot,
  type ProductionAnalysisStatusReadModel,
  type ProductionResearchArtifact,
  type WorkflowActor
} from '@appsea/contracts'
import {
  decodeOpportunityReport,
  decodePlanPackage,
  generateOpportunityReport,
  generateProductionPlanPackage,
  storeOpportunityReport,
  storePlanPackage
} from '@appsea/reports'
import { assertDeterministicScoreSnapshot } from '@appsea/scoring'
import type { ObjectStore } from '@appsea/object-store'
import { canonicalJson, contentHash } from './hash'
import { IdempotencyConflictError, ImmutableRecordConflictError } from './fixture-repository'
import { withAuthenticatedWorkspaceTransaction, withWorkspaceTransaction } from './transaction'
import {
  assertProductionAnalysisAdmissionConsumed,
  consumeProductionAnalysisAdmissionInTransaction,
  releaseProductionAnalysisAdmissionInTransaction,
  ProductionAnalysisAdmissionRequiredError
} from './production-analysis-admission-repository'

const analysisVersion = 'production-analysis-v1'
const clusterVersion = 'production-cluster-v1'
const planVersion = 'production-plan-v1'
const normalizerRedactionMarker = '[Content withheld by source policy]'
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000

interface AnalysisRunRow extends QueryResultRow {
  workspace_id: string
  analysis_run_id: string
  collection_run_id: string
  idempotency_key: string
  input_hash: string
  artifact_id: string
  artifact_snapshot: unknown
  artifact_object_ref: unknown
  report_object_ref: unknown
  plan_object_ref: unknown
  state: string
  availability_state: string
  opportunity_id: string | null
  score_snapshot_id: string | null
  report_id: string | null
  plan_package_id: string | null
  report_approval_state: 'draft' | 'reviewed' | 'approved' | 'withdrawn' | null
  plan_approval_state: 'unreviewed' | 'reviewed' | 'approved' | 'withdrawn' | null
  requested_by_actor_type: 'user' | 'service'
  requested_by_actor_id: string
  completed_at: Date | string | null
  invalidated_at: Date | string | null
  invalidation_reason: string | null
}

interface AnalysisStatusRow extends QueryResultRow {
  analysis_run_id: string
  collection_run_id: string
  state: string
  availability_state: string
  opportunity_id: string | null
  opportunity_slug: string | null
  failure_code: string | null
  failure_summary: string | null
  requested_at: Date | string
  started_at: Date | string
  completed_at: Date | string | null
}

interface CollectionLineageRow extends QueryResultRow {
  mode: string
  state: string
  finished_at: Date | string | null
}

interface PolicyLineageRow extends QueryResultRow {
  content_hash: string
  review_id: string
  decision: string
  policy_state: string
  commercial_use: string
  source_type: string
  source_lifecycle_state: string
  current_policy_version: string | null
  display_mode: string
  expires_at: Date | string | null
}

interface SeedReviewLineageRow extends QueryResultRow {
  seed_review_id: string
  seed_version: string
  seed_payload: unknown
  content_hash: string
  review_state: string
}

interface EvidenceLineageRow extends QueryResultRow {
  complaint_id: string
  evidence_id: string
  source_item_id: string
  evidence_content_hash: string
  source_record_id: string
  review_state: string
  allowed_representation: string
  redacted: boolean
  evidence_deletion_state: string
  source_item_deletion_state: string
}

interface ExistingOpportunityRow extends QueryResultRow {
  source_run_id: string
  synthetic: boolean
}

interface HashRow extends QueryResultRow {
  content_hash: string
}

export class ProductionAnalysisAvailabilityError extends Error {
  constructor(analysisRunId: string, reason: string) {
    super(`Production analysis ${analysisRunId} is unavailable: ${reason}`)
    this.name = 'ProductionAnalysisAvailabilityError'
  }
}

export class ProductionAnalysisStateError extends Error {
  constructor(analysisRunId: string, state: string) {
    super(`Production analysis ${analysisRunId} is not resumable (${state})`)
    this.name = 'ProductionAnalysisStateError'
  }
}

export class ProductionAnalysisLineageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionAnalysisLineageError'
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function analysisCheckpointForState(
  state: AnalysisStatusRow['state']
): 'accepted' | 'persisting' | 'completed' | 'failed' | 'canceled' {
  switch (state) {
    case 'queued':
      return 'accepted'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'running':
    case 'partial':
    default:
      return 'persisting'
  }
}

function mapAnalysisStatus(row: AnalysisStatusRow): ProductionAnalysisStatusReadModel {
  return productionAnalysisStatusReadModelSchema.parse({
    analysisRunId: row.analysis_run_id,
    collectionRunId: row.collection_run_id,
    state: row.state,
    checkpoint: analysisCheckpointForState(row.state),
    activityAttempts: row.state === 'completed' ? 1 : 0,
    availabilityState: row.availability_state,
    opportunityId: row.opportunity_id,
    opportunitySlug: row.opportunity_slug,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    requestedAt: iso(row.requested_at),
    startedAt: iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at)
  })
}

function completionTime(input: ProductionAnalysisPersistenceInput): string {
  const requested = Date.parse(input.requestedAt)
  const created = Date.parse(input.artifact.createdAt)
  return new Date(Math.max(requested, created)).toISOString()
}

function hashIdentifier(prefix: string, value: unknown): string {
  return `${prefix}:${contentHash(value).slice(0, 32)}`
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value))
}

function decodeJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
  } catch {
    throw new ProductionAnalysisAvailabilityError('unknown', 'stored artifact JSON is invalid')
  }
}

function retentionUntil(input: ProductionAnalysisPersistenceInput): string | null {
  const days = input.artifact.policySnapshot.policy.retentionDays
  const createdAt = Date.parse(input.artifact.createdAt)
  const requestedAt = Date.parse(input.requestedAt)
  const expiresAt = days === 0 ? requestedAt : requestedAt + days * 86_400_000
  return new Date(Math.max(createdAt, expiresAt)).toISOString()
}

export function assertProductionAnalysisTimestamps(
  input: Pick<ProductionAnalysisPersistenceInput, 'requestedAt' | 'artifact'>,
  now = Date.now()
): void {
  const latestAllowed = now + MAX_FUTURE_TIMESTAMP_SKEW_MS
  for (const [label, value] of [
    ['requestedAt', input.requestedAt],
    ['artifact.createdAt', input.artifact.createdAt]
  ] as const) {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp) || timestamp > latestAllowed) {
      throw new ProductionAnalysisLineageError(
        `Production analysis ${label} must not be materially in the future.`
      )
    }
  }
}

/** Remove text that a metadata-only or aggregate-only policy does not permit. */
export function sanitizeProductionArtifact(
  input: ProductionResearchArtifact
): ProductionResearchArtifact {
  const parsed = productionResearchArtifactSchema.parse(input)
  return productionResearchArtifactSchema.parse({
    ...parsed,
    complaints: parsed.complaints.map((complaint) => ({
      ...complaint,
      text:
        complaint.allowedRepresentation === 'excerpt' ? complaint.text : normalizerRedactionMarker
    }))
  })
}

export function buildProductionAnalysisSnapshot(
  input: ProductionAnalysisPersistenceInput,
  inputHash: string,
  opportunityId: string,
  scoreSnapshotId: string,
  reportId: string,
  planPackageId: string
): ProductionAnalysisSnapshot {
  const artifact = input.artifact
  return productionAnalysisSnapshotSchema.parse({
    mode: 'production-analysis',
    analysisRunId: input.analysisRunId,
    collectionRunId: input.collectionRunId,
    artifactId: artifact.id,
    inputHash,
    analysisVersion,
    policySnapshots: [
      {
        sourceId: artifact.policySnapshot.sourceId,
        policyVersion: artifact.policySnapshot.policyVersion,
        contentHash: artifact.policySnapshot.contentHash,
        reviewId: artifact.policySnapshot.reviewId
      }
    ],
    seedReviewId: artifact.opportunitySeedReview.reviewId,
    seedContentHash: artifact.opportunitySeedReview.contentHash,
    opportunityId,
    scoreSnapshotId,
    reportId,
    planPackageId,
    complaintCount: artifact.complaints.length,
    clusterCount: artifact.clusters.length,
    competitorCount: artifact.opportunity.competitors.length,
    coverageGaps: artifact.coverageGaps,
    warnings: artifact.warnings,
    capturedAt: artifact.createdAt
  })
}

function parseReference(value: unknown, label: string): ObjectReference {
  const parsed = objectReferenceSchema.safeParse(value)
  if (!parsed.success)
    throw new ProductionAnalysisAvailabilityError('unknown', `${label} is invalid`)
  return parsed.data
}

function rowResult(row: AnalysisRunRow, replayed: boolean): ProductionAnalysisResult {
  if (
    row.state !== 'completed' ||
    row.opportunity_id === null ||
    row.score_snapshot_id === null ||
    row.report_id === null ||
    row.plan_package_id === null ||
    row.completed_at === null
  ) {
    throw new ProductionAnalysisStateError(row.analysis_run_id, row.state)
  }
  return productionAnalysisResultSchema.parse({
    workspaceId: row.workspace_id,
    collectionRunId: row.collection_run_id,
    analysisRunId: row.analysis_run_id,
    artifactId: row.artifact_id,
    inputHash: row.input_hash,
    opportunityId: row.opportunity_id,
    scoreSnapshotId: row.score_snapshot_id,
    reportId: row.report_id,
    planPackageId: row.plan_package_id,
    artifactObjectRef: parseReference(row.artifact_object_ref, 'artifact object reference'),
    reportObjectRef: parseReference(row.report_object_ref, 'report object reference'),
    planObjectRef: parseReference(row.plan_object_ref, 'plan object reference'),
    state: 'completed',
    availabilityState: row.availability_state,
    completedAt: iso(row.completed_at),
    replayed
  })
}

function rowGovernance(row: AnalysisRunRow) {
  if (row.report_approval_state === null || row.plan_approval_state === null) {
    throw new ProductionAnalysisAvailabilityError(
      row.analysis_run_id,
      'linked report or plan governance state is missing'
    )
  }
  return productionAnalysisGovernanceSchema.parse({
    reportApprovalState: row.report_approval_state,
    planApprovalState: row.plan_approval_state
  })
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  if ((error as { code?: unknown }).code !== '23505') return false
  const constraint =
    'constraint' in error ? String((error as { constraint?: unknown }).constraint) : ''
  return [
    'production_analysis_runs_pkey',
    'production_analysis_runs_workspace_id_idempotency_key_key',
    'production_analysis_runs_workspace_id_artifact_id_key'
  ].includes(constraint)
}

async function workspaceIsProduction(client: PoolClient, workspaceId: string): Promise<boolean> {
  const result = await client.query<
    QueryResultRow & { fixture_only: boolean; status: string; visibility: string }
  >(
    `SELECT fixture_only, status, visibility
       FROM appsea.workspaces
      WHERE workspace_id = $1`,
    [workspaceId]
  )
  const workspace = result.rows[0]
  return Boolean(
    workspace &&
    !workspace.fixture_only &&
    workspace.status === 'active' &&
    workspace.visibility === 'private'
  )
}

function requestedByForInput(input: ProductionAnalysisPersistenceInput): WorkflowActor {
  return input.requestedBy ?? { actorType: 'service', actorId: 'appsea-worker' }
}

function workflowInputHashForUser(input: ProductionAnalysisPersistenceInput): string {
  if (!input.workflowInputHash) {
    throw new ProductionAnalysisAdmissionRequiredError()
  }
  return input.workflowInputHash
}

async function readRun(
  client: PoolClient,
  workspaceId: string,
  analysisRunId: string,
  forUpdate = false
): Promise<AnalysisRunRow | undefined> {
  const result = await client.query<AnalysisRunRow>(
    `SELECT analysis.workspace_id, analysis.analysis_run_id, analysis.collection_run_id,
            analysis.idempotency_key,
            input_hash, artifact_id, artifact_snapshot, artifact_object_ref,
            report_object_ref, plan_object_ref, state, availability_state,
            opportunity_id, score_snapshot_id, report_id, plan_package_id,
            (SELECT report.approval_state
               FROM appsea.report_versions report
              WHERE report.workspace_id = analysis.workspace_id
                AND report.report_id = analysis.report_id) AS report_approval_state,
            (SELECT plan.approval_state
               FROM appsea.plan_package_versions plan
              WHERE plan.workspace_id = analysis.workspace_id
                AND plan.plan_package_id = analysis.plan_package_id) AS plan_approval_state,
            requested_by_actor_type, requested_by_actor_id,
            completed_at, invalidated_at, invalidation_reason
       FROM appsea.production_analysis_runs analysis
      WHERE analysis.workspace_id = $1 AND analysis.analysis_run_id = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [workspaceId, analysisRunId]
  )
  return result.rows[0]
}

async function readRunByIdempotency(
  client: PoolClient,
  workspaceId: string,
  idempotencyKey: string,
  forUpdate = false
): Promise<AnalysisRunRow | undefined> {
  const result = await client.query<AnalysisRunRow>(
    `SELECT analysis.workspace_id, analysis.analysis_run_id, analysis.collection_run_id,
            analysis.idempotency_key, analysis.input_hash, analysis.artifact_id,
            analysis.artifact_snapshot, analysis.artifact_object_ref,
            analysis.report_object_ref, analysis.plan_object_ref, analysis.state,
            analysis.availability_state, analysis.opportunity_id,
            analysis.score_snapshot_id, analysis.report_id, analysis.plan_package_id,
            (SELECT report.approval_state
               FROM appsea.report_versions report
              WHERE report.workspace_id = analysis.workspace_id
                AND report.report_id = analysis.report_id) AS report_approval_state,
            (SELECT plan.approval_state
               FROM appsea.plan_package_versions plan
              WHERE plan.workspace_id = analysis.workspace_id
                AND plan.plan_package_id = analysis.plan_package_id) AS plan_approval_state,
            analysis.requested_by_actor_type, analysis.requested_by_actor_id,
            analysis.completed_at, analysis.invalidated_at, analysis.invalidation_reason
       FROM appsea.production_analysis_runs analysis
      WHERE analysis.workspace_id = $1 AND analysis.idempotency_key = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [workspaceId, idempotencyKey]
  )
  return result.rows[0]
}

async function assertCollectionAndPolicyLineage(
  client: PoolClient,
  input: ProductionAnalysisPersistenceInput
): Promise<void> {
  const collection = await client.query<CollectionLineageRow>(
    `SELECT mode, state, finished_at
       FROM appsea.research_runs
      WHERE workspace_id = $1 AND run_id = $2`,
    [input.workspaceId, input.collectionRunId]
  )
  const collectionRow = collection.rows[0]
  if (
    !collectionRow ||
    collectionRow.mode !== 'production' ||
    collectionRow.state !== 'completed' ||
    collectionRow.finished_at === null
  ) {
    throw new ProductionAnalysisLineageError(
      'Production analysis requires a completed production collection run'
    )
  }

  const policy = await client.query<PolicyLineageRow>(
    `SELECT policy.content_hash, review.review_id, review.decision,
            policy.policy_state, policy.commercial_use, source.source_type,
            source.lifecycle_state AS source_lifecycle_state,
            source.current_policy_version, policy.display_mode, policy.expires_at
       FROM appsea.research_run_source_policies run_policy
       JOIN appsea.source_policy_versions policy
         ON policy.source_id = run_policy.source_id
        AND policy.policy_version = run_policy.policy_version
       JOIN appsea.sources source ON source.source_id = policy.source_id
       JOIN appsea.source_policy_reviews review
         ON review.source_id = policy.source_id
        AND review.policy_version = policy.policy_version
        AND review.content_hash = policy.content_hash
        AND review.decision = 'approved'
        AND review.independence_attested
      WHERE run_policy.workspace_id = $1
        AND run_policy.run_id = $2
        AND run_policy.source_id = $3
        AND run_policy.policy_version = $4
        AND review.review_id = $5
        AND source.lifecycle_state = 'active'
        AND source.current_policy_version = policy.policy_version
        AND policy.policy_state = 'approved'
        AND policy.commercial_use IN ('allowed', 'restricted')
        AND policy.reviewed_at IS NOT NULL
        AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
      FOR SHARE`,
    [
      input.workspaceId,
      input.collectionRunId,
      input.artifact.policySnapshot.sourceId,
      input.artifact.policySnapshot.policyVersion,
      input.artifact.policySnapshot.reviewId
    ]
  )
  const policyRow = policy.rows[0]
  if (
    !policyRow ||
    policyRow.content_hash !== input.artifact.policySnapshot.contentHash ||
    policyRow.review_id !== input.artifact.policySnapshot.reviewId ||
    policyRow.decision !== 'approved' ||
    policyRow.policy_state !== 'approved' ||
    !['allowed', 'restricted'].includes(policyRow.commercial_use) ||
    policyRow.source_type === 'fixture' ||
    policyRow.display_mode === 'fixture' ||
    policyRow.display_mode !== 'excerpt' ||
    policyRow.display_mode !== input.artifact.policySnapshot.policy.displayMode ||
    policyRow.commercial_use !== input.artifact.policySnapshot.policy.commercialUse ||
    policyRow.source_lifecycle_state !== 'active' ||
    policyRow.current_policy_version !== input.artifact.policySnapshot.policyVersion ||
    (policyRow.expires_at !== null && Date.parse(iso(policyRow.expires_at)) <= Date.now())
  ) {
    throw new ProductionAnalysisLineageError(
      'Analysis policy snapshot is not the approved policy in the collection lineage'
    )
  }

  const seed = await client.query<SeedReviewLineageRow>(
    `SELECT seed_review_id, seed_version, seed_payload, content_hash, review_state
       FROM appsea.opportunity_seed_reviews
      WHERE workspace_id = $1
        AND seed_review_id = $2
        AND review_state = 'approved'`,
    [input.workspaceId, input.artifact.opportunitySeedReview.reviewId]
  )
  const seedRow = seed.rows[0]
  const parsedSeed = seedRow
    ? productionOpportunitySeedSchema.safeParse(seedRow.seed_payload)
    : null
  if (
    !seedRow ||
    seedRow.review_state !== 'approved' ||
    seedRow.seed_version !== input.artifact.opportunitySeedReview.seedVersion ||
    seedRow.content_hash !== input.artifact.opportunitySeedReview.contentHash ||
    !parsedSeed?.success ||
    contentHash(parsedSeed.data) !== seedRow.content_hash ||
    contentHash(parsedSeed.data) !== input.artifact.opportunitySeedReview.contentHash
  ) {
    throw new ProductionAnalysisLineageError(
      'Analysis seed is not the approved immutable seed in the workspace registry'
    )
  }
}

async function assertEvidenceLineage(
  client: PoolClient,
  input: ProductionAnalysisPersistenceInput
): Promise<void> {
  const complaintIds = input.artifact.complaints.map((complaint) => complaint.id)
  const rows = await client.query<EvidenceLineageRow>(
    `SELECT run_complaint.complaint_id,
            complaint.evidence_id,
            complaint.review_state,
            evidence.source_item_id,
            evidence.content_hash AS evidence_content_hash,
            evidence.allowed_representation,
            evidence.redacted,
            source_item.source_record_id,
            evidence.deletion_state AS evidence_deletion_state,
            source_item.deletion_state AS source_item_deletion_state
       FROM appsea.research_run_complaints run_complaint
       JOIN appsea.complaint_observations complaint
         ON complaint.workspace_id = run_complaint.workspace_id
        AND complaint.complaint_id = run_complaint.complaint_id
       JOIN appsea.evidence_records evidence
         ON evidence.workspace_id = complaint.workspace_id
        AND evidence.evidence_id = complaint.evidence_id
       JOIN appsea.source_items source_item
         ON source_item.workspace_id = evidence.workspace_id
        AND source_item.source_item_id = evidence.source_item_id
      WHERE run_complaint.workspace_id = $1
        AND run_complaint.run_id = $2
        AND run_complaint.complaint_id = ANY($3::text[])`,
    [input.workspaceId, input.collectionRunId, complaintIds]
  )
  const byComplaint = new Map(rows.rows.map((row) => [row.complaint_id, row]))
  if (byComplaint.size !== complaintIds.length) {
    throw new ProductionAnalysisLineageError(
      'Analysis complaints are not fully present in the collection run'
    )
  }
  for (const complaint of input.artifact.complaints) {
    const row = byComplaint.get(complaint.id)
    if (
      !row ||
      row.evidence_id !== complaint.evidenceId ||
      row.source_item_id !== complaint.sourceItemId ||
      row.evidence_content_hash !== complaint.evidenceHash ||
      row.source_record_id !== complaint.sourceRecordId ||
      row.review_state !== 'confirmed' ||
      row.allowed_representation !== 'excerpt' ||
      row.allowed_representation !== complaint.allowedRepresentation ||
      !row.redacted ||
      row.evidence_deletion_state !== 'active' ||
      row.source_item_deletion_state !== 'active'
    ) {
      throw new ProductionAnalysisLineageError(
        `Analysis complaint ${complaint.id} does not match active collection evidence`
      )
    }
  }
}

async function assertOpportunityLineage(
  client: PoolClient,
  input: ProductionAnalysisPersistenceInput
): Promise<void> {
  const existing = await client.query<ExistingOpportunityRow>(
    `SELECT source_run_id, synthetic
       FROM appsea.opportunities
      WHERE workspace_id = $1 AND opportunity_id = $2`,
    [input.workspaceId, input.artifact.opportunity.id]
  )
  const row = existing.rows[0]
  if (row && (row.source_run_id !== input.collectionRunId || row.synthetic)) {
    throw new ImmutableRecordConflictError('production opportunity', input.artifact.opportunity.id)
  }
}

async function assertObjectReferenceAvailable(
  store: ObjectStore,
  workspaceId: string,
  reference: ObjectReference,
  analysisRunId: string
): Promise<void> {
  const head = await store.head(workspaceId, reference)
  if (!head || head.deletionState !== 'active') {
    throw new ProductionAnalysisAvailabilityError(
      analysisRunId,
      'an output object is missing or deleted'
    )
  }
}

async function assertStoredHash(
  client: PoolClient,
  sql: string,
  parameters: unknown[],
  expectedHash: string,
  label: string
): Promise<void> {
  const result = await client.query<HashRow>(sql, parameters)
  if (result.rows[0]?.content_hash !== expectedHash) {
    throw new ImmutableRecordConflictError(label, expectedHash)
  }
}

export class PostgresProductionAnalysisRepository {
  constructor(
    private readonly pool: Pool,
    private readonly objectStore: ObjectStore
  ) {}

  private async prepareRun(
    input: ProductionAnalysisPersistenceInput,
    inputHash: string
  ): Promise<AnalysisRunRow> {
    const requestedBy = requestedByForInput(input)
    const workflowInputHash =
      requestedBy.actorType === 'user'
        ? workflowInputHashForUser(input)
        : (input.workflowInputHash ?? inputHash)
    const create = async (): Promise<AnalysisRunRow> =>
      withWorkspaceTransaction(
        this.pool,
        input.workspaceId,
        async (client) => {
          if (!(await workspaceIsProduction(client, input.workspaceId))) {
            throw new ProductionAnalysisLineageError(
              'Production analysis requires an active private non-fixture workspace'
            )
          }
          const existingById = await readRun(client, input.workspaceId, input.analysisRunId, true)
          if (existingById && existingById.idempotency_key !== input.idempotencyKey) {
            throw new ImmutableRecordConflictError('production analysis run', input.analysisRunId)
          }
          if (
            existingById &&
            (existingById.requested_by_actor_type !== requestedBy.actorType ||
              existingById.requested_by_actor_id !== requestedBy.actorId)
          ) {
            throw new ImmutableRecordConflictError('production analysis actor', input.analysisRunId)
          }
          const existing = await readRunByIdempotency(
            client,
            input.workspaceId,
            input.idempotencyKey,
            true
          )
          if (existing) {
            if (existing.input_hash !== inputHash) {
              throw new IdempotencyConflictError(input.idempotencyKey)
            }
            if (existing.availability_state !== 'active') {
              throw new ProductionAnalysisAvailabilityError(
                existing.analysis_run_id,
                existing.availability_state
              )
            }
            if (existing.state === 'completed') return existing
            if (['failed', 'canceled'].includes(existing.state)) {
              throw new ProductionAnalysisStateError(existing.analysis_run_id, existing.state)
            }
            if (requestedBy.actorType === 'user') {
              assertProductionAnalysisAdmissionConsumed(
                await consumeProductionAnalysisAdmissionInTransaction(
                  client,
                  input.workspaceId,
                  input.idempotencyKey,
                  workflowInputHash,
                  requestedBy.actorId
                )
              )
            }
            await assertCollectionAndPolicyLineage(client, input)
            await assertEvidenceLineage(client, input)
            await client.query(
              `UPDATE appsea.production_analysis_runs
                  SET state = 'running', failure_code = NULL, failure_summary = NULL
                WHERE workspace_id = $1 AND analysis_run_id = $2`,
              [input.workspaceId, existing.analysis_run_id]
            )
            const resumed = await readRun(client, input.workspaceId, existing.analysis_run_id, true)
            if (!resumed) throw new Error('Production analysis run disappeared while resuming')
            return resumed
          }

          const existingArtifact = await client.query<
            QueryResultRow & { analysis_run_id: string; input_hash: string }
          >(
            `SELECT analysis_run_id, input_hash
               FROM appsea.production_analysis_runs
              WHERE workspace_id = $1 AND artifact_id = $2
              FOR UPDATE`,
            [input.workspaceId, input.artifact.id]
          )
          if (existingArtifact.rows[0]) {
            throw new ImmutableRecordConflictError(
              'production analysis artifact',
              input.artifact.id
            )
          }

          await assertCollectionAndPolicyLineage(client, input)
          await assertEvidenceLineage(client, input)
          if (requestedBy.actorType === 'user') {
            assertProductionAnalysisAdmissionConsumed(
              await consumeProductionAnalysisAdmissionInTransaction(
                client,
                input.workspaceId,
                input.idempotencyKey,
                workflowInputHash,
                requestedBy.actorId
              )
            )
          }
          const initialSnapshot = {
            mode: 'production-analysis',
            analysisRunId: input.analysisRunId,
            collectionRunId: input.collectionRunId,
            artifactId: input.artifact.id,
            inputHash,
            analysisVersion,
            policySnapshots: [
              {
                sourceId: input.artifact.policySnapshot.sourceId,
                policyVersion: input.artifact.policySnapshot.policyVersion,
                contentHash: input.artifact.policySnapshot.contentHash,
                reviewId: input.artifact.policySnapshot.reviewId
              }
            ],
            seedReviewId: input.artifact.opportunitySeedReview.reviewId,
            seedContentHash: input.artifact.opportunitySeedReview.contentHash,
            coverageGaps: input.artifact.coverageGaps,
            warnings: input.artifact.warnings,
            pending: true
          }
          await client.query(
            `INSERT INTO appsea.production_analysis_runs
             (workspace_id, analysis_run_id, collection_run_id, idempotency_key,
             analysis_version, input_hash, artifact_id, artifact_snapshot, state,
              availability_state, seed_review_id, seed_content_hash, coverage_gaps,
              warnings, requested_by_actor_type, requested_by_actor_id,
              requested_at, started_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'running', 'active',
                   $9, $10, $11, $12, $13, $14, $15, $15)`,
            [
              input.workspaceId,
              input.analysisRunId,
              input.collectionRunId,
              input.idempotencyKey,
              analysisVersion,
              inputHash,
              input.artifact.id,
              JSON.stringify(initialSnapshot),
              input.artifact.opportunitySeedReview.reviewId,
              input.artifact.opportunitySeedReview.contentHash,
              input.artifact.coverageGaps,
              input.artifact.warnings,
              requestedBy.actorType,
              requestedBy.actorId,
              input.requestedAt
            ]
          )
          const created = await readRun(client, input.workspaceId, input.analysisRunId, true)
          if (!created) throw new Error('Production analysis run was not created')
          return created
        },
        { isolationLevel: 'SERIALIZABLE' }
      )

    try {
      return await create()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      return withWorkspaceTransaction(
        this.pool,
        input.workspaceId,
        async (client) => {
          const existingById = await readRun(client, input.workspaceId, input.analysisRunId, true)
          if (existingById) {
            if (existingById.input_hash !== inputHash) {
              throw new ImmutableRecordConflictError('production analysis run', input.analysisRunId)
            }
            if (
              existingById.requested_by_actor_type !== requestedBy.actorType ||
              existingById.requested_by_actor_id !== requestedBy.actorId
            ) {
              throw new ImmutableRecordConflictError(
                'production analysis actor',
                input.analysisRunId
              )
            }
            if (existingById.availability_state !== 'active') {
              throw new ProductionAnalysisAvailabilityError(
                existingById.analysis_run_id,
                existingById.availability_state
              )
            }
            if (['failed', 'canceled'].includes(existingById.state)) {
              throw new ProductionAnalysisStateError(
                existingById.analysis_run_id,
                existingById.state
              )
            }
            return existingById
          }
          const existing = await readRunByIdempotency(
            client,
            input.workspaceId,
            input.idempotencyKey,
            true
          )
          if (!existing) throw error
          if (existing.input_hash !== inputHash) {
            throw new IdempotencyConflictError(input.idempotencyKey)
          }
          if (
            existing.requested_by_actor_type !== requestedBy.actorType ||
            existing.requested_by_actor_id !== requestedBy.actorId
          ) {
            throw new ImmutableRecordConflictError('production analysis actor', input.analysisRunId)
          }
          if (existing.availability_state !== 'active') {
            throw new ProductionAnalysisAvailabilityError(
              existing.analysis_run_id,
              existing.availability_state
            )
          }
          if (existing.state === 'completed') return existing
          if (['failed', 'canceled'].includes(existing.state)) {
            throw new ProductionAnalysisStateError(existing.analysis_run_id, existing.state)
          }
          if (requestedBy.actorType === 'user') {
            assertProductionAnalysisAdmissionConsumed(
              await consumeProductionAnalysisAdmissionInTransaction(
                client,
                input.workspaceId,
                input.idempotencyKey,
                workflowInputHash,
                requestedBy.actorId
              )
            )
          }
          await assertCollectionAndPolicyLineage(client, input)
          await assertEvidenceLineage(client, input)
          return existing
        },
        { isolationLevel: 'READ COMMITTED' }
      )
    }
  }

  private async markFailed(
    input: ProductionAnalysisPersistenceInput,
    code:
      | 'analysis_input_invalid'
      | 'analysis_policy_denied'
      | 'analysis_budget_exceeded'
      | 'analysis_activity_failed'
      | 'analysis_reconciliation_required',
    summary: string
  ): Promise<void> {
    await withWorkspaceTransaction(this.pool, input.workspaceId, async (client) => {
      await client.query(
        `UPDATE appsea.production_analysis_runs
            SET state = 'failed', failure_code = $3, failure_summary = $4
          WHERE workspace_id = $1 AND analysis_run_id = $2
            AND state IN ('queued', 'running', 'partial')`,
        [input.workspaceId, input.analysisRunId, code, summary.slice(0, 500)]
      )
      const requestedBy = requestedByForInput(input)
      if (requestedBy.actorType === 'user') {
        await releaseProductionAnalysisAdmissionInTransaction(
          client,
          input.workspaceId,
          input.idempotencyKey,
          workflowInputHashForUser(input),
          requestedBy.actorId
        )
      }
    })
  }

  async persist(input: ProductionAnalysisPersistenceInput): Promise<ProductionAnalysisResult> {
    const parsed = productionAnalysisPersistenceInputSchema.parse(input)
    assertProductionAnalysisTimestamps(parsed)
    assertDeterministicScoreSnapshot(parsed.artifact.opportunity.scoreSnapshot)
    const inputHash = contentHash(parsed)
    const run = await this.prepareRun(parsed, inputHash)
    if (run.state === 'completed') {
      const result = rowResult(run, true)
      await Promise.all([
        assertObjectReferenceAvailable(
          this.objectStore,
          parsed.workspaceId,
          result.artifactObjectRef,
          result.analysisRunId
        ),
        assertObjectReferenceAvailable(
          this.objectStore,
          parsed.workspaceId,
          result.reportObjectRef,
          result.analysisRunId
        ),
        assertObjectReferenceAvailable(
          this.objectStore,
          parsed.workspaceId,
          result.planObjectRef,
          result.analysisRunId
        )
      ])
      return result
    }

    const retention = retentionUntil(parsed)
    const artifact = sanitizeProductionArtifact(parsed.artifact)
    const report = generateOpportunityReport(parsed.artifact, parsed.artifact.createdAt)
    const planPackage = generateProductionPlanPackage(parsed.artifact, parsed.artifact.createdAt)
    const reportManifestHash = contentHash(report)
    const planManifestHash = contentHash(planPackage)
    const opportunityId = parsed.artifact.opportunity.id
    const scoreInputHash = contentHash({
      analysisRunId: parsed.analysisRunId,
      collectionRunId: parsed.collectionRunId,
      complaintIds: parsed.artifact.opportunity.complaintIds,
      clusterIds: parsed.artifact.clusters.map((cluster) => cluster.id),
      scoreSnapshot: parsed.artifact.opportunity.scoreSnapshot
    })
    const scoreSnapshotId = hashIdentifier('score', {
      analysisRunId: parsed.analysisRunId,
      scoreInputHash
    })
    const reportId = hashIdentifier('report', {
      analysisRunId: parsed.analysisRunId,
      reportManifestHash
    })
    const planPackageId = hashIdentifier('plan', {
      analysisRunId: parsed.analysisRunId,
      planManifestHash
    })

    let artifactRef: ObjectReference
    let reportRef: ObjectReference
    let planRef: ObjectReference
    try {
      artifactRef = await this.objectStore.put({
        workspaceId: parsed.workspaceId,
        kind: 'workflow-artifact',
        body: encodeJson(artifact),
        contentType: 'application/json; charset=utf-8',
        createdAt: parsed.artifact.createdAt,
        retentionUntil: retention
      })
      reportRef = await storeOpportunityReport(this.objectStore, {
        workspaceId: parsed.workspaceId,
        createdAt: parsed.artifact.createdAt,
        retentionUntil: retention,
        report
      })
      planRef = await storePlanPackage(this.objectStore, {
        workspaceId: parsed.workspaceId,
        createdAt: parsed.artifact.createdAt,
        retentionUntil: retention,
        planPackage
      })
    } catch (error) {
      await this.markFailed(
        parsed,
        'analysis_activity_failed',
        error instanceof Error ? error.message : 'Object storage write failed'
      )
      throw error
    }

    const completedAt = completionTime(parsed)
    const snapshot = buildProductionAnalysisSnapshot(
      parsed,
      inputHash,
      opportunityId,
      scoreSnapshotId,
      reportId,
      planPackageId
    )

    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsed.workspaceId,
        async (client) => {
          const locked = await readRun(client, parsed.workspaceId, run.analysis_run_id, true)
          if (!locked) throw new Error('Production analysis run disappeared before finalization')
          if (locked.input_hash !== inputHash) {
            throw new IdempotencyConflictError(parsed.idempotencyKey)
          }
          if (locked.availability_state !== 'active') {
            throw new ProductionAnalysisAvailabilityError(
              locked.analysis_run_id,
              locked.availability_state
            )
          }
          if (locked.state === 'completed') return rowResult(locked, true)

          await assertCollectionAndPolicyLineage(client, parsed)
          await assertEvidenceLineage(client, parsed)
          await assertOpportunityLineage(client, parsed)

          await client.query(
            `INSERT INTO appsea.research_analysis_run_source_policies
             (workspace_id, analysis_run_id, source_id, policy_version,
              policy_content_hash, approval_review_id, linked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              parsed.analysisRunId,
              parsed.artifact.policySnapshot.sourceId,
              parsed.artifact.policySnapshot.policyVersion,
              parsed.artifact.policySnapshot.contentHash,
              parsed.artifact.policySnapshot.reviewId,
              completedAt
            ]
          )

          for (const complaint of parsed.artifact.complaints) {
            await client.query(
              `INSERT INTO appsea.research_analysis_run_evidence
               (workspace_id, analysis_run_id, complaint_id, evidence_id, source_item_id,
                evidence_content_hash, source_record_id, linked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.analysisRunId,
                complaint.id,
                complaint.evidenceId,
                complaint.sourceItemId,
                complaint.evidenceHash,
                complaint.sourceRecordId,
                completedAt
              ]
            )
          }

          const clusterVersionIds: string[] = []
          for (const cluster of parsed.artifact.clusters) {
            const clusterVersionId = hashIdentifier('cluster', {
              analysisRunId: parsed.analysisRunId,
              cluster
            })
            const clusterHash = contentHash({ cluster, version: clusterVersion })
            clusterVersionIds.push(clusterVersionId)
            await client.query(
              `INSERT INTO appsea.complaint_cluster_versions
               (workspace_id, cluster_version_id, cluster_id, run_id, cluster_version,
                working_label, problem_statement, product, category, complaint_count,
                unique_observation_count, source_count, confidence, review_state, input_hash,
                synthetic, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     'provisional', $14, false, $15)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                clusterVersionId,
                cluster.id,
                parsed.collectionRunId,
                clusterVersion,
                cluster.title,
                cluster.summary,
                cluster.product,
                cluster.category,
                cluster.complaintIds.length,
                cluster.uniqueObservationCount,
                cluster.sourceCount,
                cluster.confidence,
                clusterHash,
                completedAt
              ]
            )
            for (const complaintId of cluster.complaintIds) {
              await client.query(
                `INSERT INTO appsea.cluster_memberships
                 (workspace_id, cluster_version_id, complaint_id, membership_confidence,
                  inclusion_reason, review_state)
               VALUES ($1, $2, $3, $4, $5, 'unreviewed')
               ON CONFLICT DO NOTHING`,
                [
                  parsed.workspaceId,
                  clusterVersionId,
                  complaintId,
                  cluster.confidence,
                  `Production grouping by ${cluster.product} and ${cluster.category}`
                ]
              )
            }
            await client.query(
              `INSERT INTO appsea.opportunity_clusters
               (workspace_id, opportunity_id, cluster_version_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, opportunityId, clusterVersionId]
            )
            await client.query(
              `INSERT INTO appsea.research_run_cluster_versions
               (workspace_id, run_id, opportunity_id, cluster_version_id, linked_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.collectionRunId,
                opportunityId,
                clusterVersionId,
                completedAt
              ]
            )
          }

          await client.query(
            `INSERT INTO appsea.opportunities
             (workspace_id, opportunity_id, slug, name, one_line, thesis, audience, first_wedge,
              complaint_count, synthetic, tags, contrary_evidence, state, source_run_id,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11,
                   'researched', $12, $13, $13)
            ON CONFLICT (workspace_id, opportunity_id) DO UPDATE
              SET slug = EXCLUDED.slug, name = EXCLUDED.name, one_line = EXCLUDED.one_line,
                  thesis = EXCLUDED.thesis, audience = EXCLUDED.audience,
                  first_wedge = EXCLUDED.first_wedge, complaint_count = EXCLUDED.complaint_count,
                  tags = EXCLUDED.tags, contrary_evidence = EXCLUDED.contrary_evidence,
                  state = 'researched', source_run_id = EXCLUDED.source_run_id,
                  availability_state = CASE
                    WHEN appsea.opportunities.availability_state = 'invalidated'
                      THEN 'invalidated'
                    ELSE 'active'
                  END,
                  invalidated_at = CASE
                    WHEN appsea.opportunities.availability_state = 'invalidated'
                      THEN appsea.opportunities.invalidated_at
                    ELSE NULL
                  END,
                  invalidation_reason = CASE
                    WHEN appsea.opportunities.availability_state = 'invalidated'
                      THEN appsea.opportunities.invalidation_reason
                    ELSE NULL
                  END,
                  updated_at = EXCLUDED.updated_at`,
            [
              parsed.workspaceId,
              opportunityId,
              parsed.artifact.opportunity.slug,
              parsed.artifact.opportunity.name,
              parsed.artifact.opportunity.oneLine,
              parsed.artifact.opportunity.thesis,
              parsed.artifact.opportunity.audience,
              parsed.artifact.opportunity.firstWedge,
              parsed.artifact.opportunity.complaintCount,
              parsed.artifact.opportunity.tags,
              parsed.artifact.opportunity.contraryEvidence,
              parsed.collectionRunId,
              completedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.research_run_opportunities
             (workspace_id, run_id, opportunity_id, linked_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
            [parsed.workspaceId, parsed.collectionRunId, opportunityId, completedAt]
          )

          for (const competitor of parsed.artifact.opportunity.competitors) {
            const competitorId = hashIdentifier('competitor', {
              name: competitor.name,
              type: competitor.type
            })
            const competitorHash = contentHash(competitor)
            await client.query(
              `INSERT INTO appsea.competitors
               (workspace_id, competitor_id, name, competitor_type, positioning, strengths,
                weaknesses, related_complaint_categories, synthetic, content_hash, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                competitorId,
                competitor.name,
                competitor.type,
                competitor.positioning,
                competitor.strengths,
                competitor.weaknesses,
                competitor.relatedComplaintCategories,
                competitorHash,
                completedAt
              ]
            )
            await assertStoredHash(
              client,
              `SELECT content_hash FROM appsea.competitors
                WHERE workspace_id = $1 AND competitor_id = $2`,
              [parsed.workspaceId, competitorId],
              competitorHash,
              'competitor'
            )
            await client.query(
              `INSERT INTO appsea.opportunity_competitors
               (workspace_id, opportunity_id, competitor_id, relation_type, confidence)
             VALUES ($1, $2, $3, $4, 0.7000)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, opportunityId, competitorId, competitor.type]
            )
            await client.query(
              `INSERT INTO appsea.research_run_competitors
               (workspace_id, run_id, opportunity_id, competitor_id, relation_type,
                confidence, linked_at)
             VALUES ($1, $2, $3, $4, $5, 0.7000, $6)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.collectionRunId,
                opportunityId,
                competitorId,
                competitor.type,
                completedAt
              ]
            )
          }

          await client.query(
            `INSERT INTO appsea.opportunity_score_snapshots
             (workspace_id, score_snapshot_id, opportunity_id, scoring_version, score,
              factors, weights, input_hash, explanation, calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              scoreSnapshotId,
              opportunityId,
              parsed.artifact.opportunity.scoreSnapshot.version,
              parsed.artifact.opportunity.scoreSnapshot.score,
              JSON.stringify(parsed.artifact.opportunity.scoreSnapshot.factors),
              JSON.stringify(parsed.artifact.opportunity.scoreSnapshot.weights),
              scoreInputHash,
              JSON.stringify({
                production: true,
                analysisRunId: parsed.analysisRunId,
                contraryEvidence: parsed.artifact.opportunity.contraryEvidence
              }),
              parsed.artifact.opportunity.scoreSnapshot.calculatedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT input_hash AS content_hash FROM appsea.opportunity_score_snapshots
              WHERE workspace_id = $1 AND score_snapshot_id = $2`,
            [parsed.workspaceId, scoreSnapshotId],
            scoreInputHash,
            'score snapshot'
          )
          await client.query(
            `INSERT INTO appsea.research_run_score_snapshots
             (workspace_id, run_id, opportunity_id, score_snapshot_id, linked_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              parsed.collectionRunId,
              opportunityId,
              scoreSnapshotId,
              completedAt
            ]
          )

          await client.query(
            `INSERT INTO appsea.report_versions
             (workspace_id, report_id, opportunity_id, version, evidence_snapshot_ref,
              structured_report, structured_object_ref, manifest_hash, approval_state,
              generated_at, synthetic)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'draft', $9, false)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              reportId,
              opportunityId,
              'production-report-v1',
              `production-analysis:${parsed.analysisRunId}`,
              JSON.stringify({
                schemaVersion: report.schemaVersion,
                reportType: report.reportType,
                synthetic: false,
                testOnly: false,
                transport: report.transport,
                artifactId: report.artifactId,
                objectRef: reportRef.uri
              }),
              reportRef.uri,
              reportManifestHash,
              completedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT manifest_hash AS content_hash FROM appsea.report_versions
              WHERE workspace_id = $1 AND report_id = $2`,
            [parsed.workspaceId, reportId],
            reportManifestHash,
            'report'
          )

          await client.query(
            `INSERT INTO appsea.plan_package_versions
             (workspace_id, plan_package_id, opportunity_id, run_id, report_id, version,
              manifest_hash, package_object_ref, fixture_files, readiness_state, approval_state,
              synthetic, generated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'ready', 'unreviewed', false, $9)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              planPackageId,
              opportunityId,
              parsed.collectionRunId,
              reportId,
              planVersion,
              planManifestHash,
              planRef.uri,
              planPackage.generatedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT manifest_hash AS content_hash FROM appsea.plan_package_versions
              WHERE workspace_id = $1 AND plan_package_id = $2`,
            [parsed.workspaceId, planPackageId],
            planManifestHash,
            'plan package'
          )
          await client.query(
            `INSERT INTO appsea.research_run_plan_packages
             (workspace_id, run_id, opportunity_id, plan_package_id, linked_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
            [parsed.workspaceId, parsed.collectionRunId, opportunityId, planPackageId, completedAt]
          )

          await client.query(
            `INSERT INTO appsea.research_analysis_run_outputs
             (workspace_id, analysis_run_id, opportunity_id, score_snapshot_id, report_id,
              plan_package_id, linked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              parsed.analysisRunId,
              opportunityId,
              scoreSnapshotId,
              reportId,
              planPackageId,
              completedAt
            ]
          )

          // Link the new analysis while its run is active before clearing a
          // source-deletion invalidation. Migration 0036 permits same-run
          // reactivation only when this explicit active analysis output exists.
          await client.query(
            `UPDATE appsea.opportunities
                SET availability_state = 'active',
                    invalidated_at = NULL,
                    invalidation_reason = NULL,
                    current_score_snapshot_id = $3,
                    current_plan_package_id = $4,
                    updated_at = $5
              WHERE workspace_id = $1 AND opportunity_id = $2`,
            [parsed.workspaceId, opportunityId, scoreSnapshotId, planPackageId, completedAt]
          )

          await client.query(
            `UPDATE appsea.production_analysis_runs
                SET artifact_snapshot = $3::jsonb,
                    artifact_object_ref = $4::jsonb,
                    report_object_ref = $5::jsonb,
                    plan_object_ref = $6::jsonb,
                    state = 'completed', availability_state = 'active',
                    opportunity_id = $7, score_snapshot_id = $8, report_id = $9,
                    plan_package_id = $10, coverage_gaps = $11, warnings = $12,
                    completed_at = $13, failure_code = NULL, failure_summary = NULL
              WHERE workspace_id = $1 AND analysis_run_id = $2`,
            [
              parsed.workspaceId,
              parsed.analysisRunId,
              JSON.stringify(snapshot),
              JSON.stringify(artifactRef),
              JSON.stringify(reportRef),
              JSON.stringify(planRef),
              opportunityId,
              scoreSnapshotId,
              reportId,
              planPackageId,
              parsed.artifact.coverageGaps,
              parsed.artifact.warnings,
              completedAt
            ]
          )

          const requestedBy = requestedByForInput(parsed)
          if (requestedBy.actorType === 'user') {
            await releaseProductionAnalysisAdmissionInTransaction(
              client,
              parsed.workspaceId,
              parsed.idempotencyKey,
              workflowInputHashForUser(parsed),
              requestedBy.actorId
            )
          }

          await client.query(
            `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
              target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'system', 'production-analysis-worker',
                   'research.analysis.completed', 'production_analysis_run', $3, $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              hashIdentifier('audit', { analysisRunId: parsed.analysisRunId, action: 'completed' }),
              parsed.analysisRunId,
              JSON.stringify({
                inputHash,
                synthetic: false,
                collectionRunId: parsed.collectionRunId,
                requestedBy: requestedByForInput(parsed)
              }),
              completedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
              schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.analysis.completed', 'production_analysis_run', $3,
                   '1.0.0', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              hashIdentifier('outbox', { analysisRunId: parsed.analysisRunId, event: 'completed' }),
              parsed.analysisRunId,
              JSON.stringify({
                workspaceId: parsed.workspaceId,
                analysisRunId: parsed.analysisRunId,
                collectionRunId: parsed.collectionRunId,
                opportunityId,
                synthetic: false
              }),
              completedAt
            ]
          )

          const finalized = await readRun(client, parsed.workspaceId, parsed.analysisRunId, true)
          if (!finalized) throw new Error('Production analysis run disappeared after finalization')
          return rowResult(finalized, false)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (error instanceof ProductionAnalysisLineageError) {
        await this.markFailed(parsed, 'analysis_policy_denied', error.message)
      }
      throw error
    }
  }

  private async readRunRow(
    workspaceId: string,
    analysisRunId: string,
    userId?: string
  ): Promise<AnalysisRunRow | undefined> {
    const operation = (client: PoolClient): Promise<AnalysisRunRow | undefined> =>
      readRun(client, workspaceId, analysisRunId)
    return userId
      ? withAuthenticatedWorkspaceTransaction(this.pool, userId, workspaceId, operation, {
          readOnly: true
        })
      : withWorkspaceTransaction(this.pool, workspaceId, operation, { readOnly: true })
  }

  private async readModelFromRow(
    row: AnalysisRunRow
  ): Promise<ProductionAnalysisReadModel | undefined> {
    if (row.state !== 'completed' || row.availability_state !== 'active') return undefined
    const result = rowResult(row, false)
    const [artifactStored, reportStored, planStored] = await Promise.all([
      this.objectStore.get(row.workspace_id, result.artifactObjectRef),
      this.objectStore.get(row.workspace_id, result.reportObjectRef),
      this.objectStore.get(row.workspace_id, result.planObjectRef)
    ])
    if (!artifactStored || !reportStored || !planStored) {
      throw new ProductionAnalysisAvailabilityError(
        row.analysis_run_id,
        'an output object is missing'
      )
    }
    if (
      artifactStored.reference.deletionState !== 'active' ||
      reportStored.reference.deletionState !== 'active' ||
      planStored.reference.deletionState !== 'active'
    ) {
      throw new ProductionAnalysisAvailabilityError(
        row.analysis_run_id,
        'an output object is deleted'
      )
    }
    const artifact = productionResearchArtifactSchema.parse(decodeJson(artifactStored.body))
    const report = decodeOpportunityReport(reportStored.body)
    const planPackage = decodePlanPackage(planStored.body)
    return productionAnalysisReadModelSchema.parse({
      result,
      artifact,
      report,
      planPackage,
      governance: rowGovernance(row)
    })
  }

  async read(
    workspaceId: string,
    analysisRunId: string
  ): Promise<ProductionAnalysisReadModel | undefined> {
    const row = await this.readRunRow(workspaceId, analysisRunId)
    return row ? this.readModelFromRow(row) : undefined
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    analysisRunId: string
  ): Promise<ProductionAnalysisReadModel | undefined> {
    const row = await this.readRunRow(workspaceId, analysisRunId, userId)
    return row ? this.readModelFromRow(row) : undefined
  }

  /** Read only the durable analysis projection; hashes and object references stay private. */
  async readStatusForUser(
    userId: string,
    workspaceId: string,
    analysisRunId: string
  ): Promise<ProductionAnalysisStatusReadModel | undefined> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedAnalysisRunId = appseaIdentifierSchema.parse(analysisRunId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<AnalysisStatusRow>(
          `SELECT analysis.analysis_run_id, analysis.collection_run_id,
                  analysis.state, analysis.availability_state,
                  analysis.opportunity_id, opportunity.slug AS opportunity_slug,
                  analysis.failure_code, analysis.failure_summary,
                  analysis.requested_at, analysis.started_at, analysis.completed_at
             FROM appsea.production_analysis_runs analysis
             LEFT JOIN appsea.opportunities opportunity
               ON opportunity.workspace_id = analysis.workspace_id
              AND opportunity.opportunity_id = analysis.opportunity_id
             JOIN appsea.workspaces workspace
               ON workspace.workspace_id = analysis.workspace_id
            WHERE analysis.workspace_id = $1
              AND analysis.analysis_run_id = $2
              AND workspace.status = 'active'
              AND workspace.visibility = 'private'
              AND workspace.fixture_only = false`,
          [parsedWorkspaceId, parsedAnalysisRunId]
        )
        const row = result.rows[0]
        return row ? mapAnalysisStatus(row) : undefined
      },
      { readOnly: true }
    )
  }

  async readLatestForOpportunityForUser(
    userId: string,
    workspaceId: string,
    slug: string
  ): Promise<ProductionAnalysisReadModel | undefined> {
    const row = await withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const result = await client.query<AnalysisRunRow>(
          `SELECT analysis.workspace_id, analysis.analysis_run_id,
                  analysis.collection_run_id, analysis.idempotency_key,
                  analysis.input_hash, analysis.artifact_id, analysis.artifact_snapshot,
                  analysis.artifact_object_ref, analysis.report_object_ref,
                  analysis.plan_object_ref, analysis.state, analysis.availability_state,
                  analysis.opportunity_id, analysis.score_snapshot_id, analysis.report_id,
                  analysis.plan_package_id,
                  (SELECT report.approval_state
                     FROM appsea.report_versions report
                    WHERE report.workspace_id = analysis.workspace_id
                      AND report.report_id = analysis.report_id) AS report_approval_state,
                  (SELECT plan.approval_state
                     FROM appsea.plan_package_versions plan
                    WHERE plan.workspace_id = analysis.workspace_id
                      AND plan.plan_package_id = analysis.plan_package_id) AS plan_approval_state,
                  analysis.requested_by_actor_type, analysis.requested_by_actor_id,
                  analysis.completed_at,
                  analysis.invalidated_at, analysis.invalidation_reason
             FROM appsea.production_analysis_runs analysis
             JOIN appsea.opportunities opportunity
               ON opportunity.workspace_id = analysis.workspace_id
              AND opportunity.opportunity_id = analysis.opportunity_id
            WHERE analysis.workspace_id = $1
              AND opportunity.slug = $2
              AND analysis.state = 'completed'
              AND analysis.availability_state = 'active'
            ORDER BY analysis.completed_at DESC, analysis.analysis_run_id DESC
            LIMIT 1`,
          [workspaceId, slug]
        )
        return result.rows[0]
      },
      { readOnly: true }
    )
    return row ? this.readModelFromRow(row) : undefined
  }
}
