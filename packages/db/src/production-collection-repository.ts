import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  complaintAnalysisSchema,
  evidenceRedactionMarker,
  evidenceRedactionFieldSchema,
  productionAnalysisComplaintSchema,
  productionAnalysisHandoffReadModelSchema,
  productionCollectionAnalysisSourceSchema,
  productionCollectionPersistenceInputSchema,
  productionCollectionReadModelSchema,
  productionCollectionResultSchema,
  productionCollectionSnapshotSchema,
  productionCollectionRequestSchema,
  productionPolicySnapshotSchema,
  redactComplaint,
  redactComplaintAnalysis,
  researchJobBudgetSchema,
  sourceDeletionEventSchema,
  sourcePolicySchema,
  workspaceComplaintReviewInputSchema,
  workspaceComplaintReviewReadModelSchema,
  type ComplaintAnalysis,
  type ComplaintAnalysisCorrection,
  type EvidenceRedactionField,
  type ProductionCollectionPersistenceInput,
  type ProductionCollectionAnalysisSource,
  type ProductionCollectionReadModel,
  type ProductionCollectionResult,
  type ProductionCollectionSnapshot,
  type ProductionAnalysisHandoffReadModel,
  type WorkspaceComplaintReviewInput,
  type WorkspaceComplaintReviewReadModel
} from '@appsea/contracts'
import { analyzeComplaint } from '@appsea/research'
import { contentHash } from './hash'
import { IdempotencyConflictError, ImmutableRecordConflictError } from './fixture-repository'
import { consumeManualImportBatchInTransaction } from './manual-import-repository'
import {
  withAuthenticatedWorkspaceTransaction,
  withServiceWorkspaceTransaction,
  withWorkspaceTransaction
} from './transaction'

export interface ProductionCollectionPersistenceLease {
  leaseId: string
  inputHash: string
}

export class ProductionCollectionLeaseAssertionError extends Error {
  constructor() {
    super('Source collection lease was not active for persistence')
    this.name = 'ProductionCollectionLeaseAssertionError'
  }
}

const productionNormalizerVersion = 'production-normalizer-v1'
const productionExtractionVersion = 'production-extractor-v1'

export class ProductionComplaintReviewPermissionError extends Error {
  constructor() {
    super('The workspace role cannot review production complaints')
    this.name = 'ProductionComplaintReviewPermissionError'
  }
}

export class ProductionComplaintReviewNotFoundError extends Error {
  constructor() {
    super('The production complaint was not found')
    this.name = 'ProductionComplaintReviewNotFoundError'
  }
}

export class ProductionComplaintReviewConflictError extends Error {
  constructor() {
    super('The production complaint review transition is not permitted')
    this.name = 'ProductionComplaintReviewConflictError'
  }
}

export class ProductionCollectionAnalysisUnavailableError extends Error {
  constructor() {
    super('The production collection is not ready for reviewed analysis')
    this.name = 'ProductionCollectionAnalysisUnavailableError'
  }
}

export class ProductionCollectionRecollectionUnavailableError extends Error {
  constructor() {
    super(
      'The requested source re-collection tombstone is not completed or does not match the source'
    )
    this.name = 'ProductionCollectionRecollectionUnavailableError'
  }
}

interface ExistingRunRow extends QueryResultRow {
  run_id: string
  campaign_id: string
  idempotency_key: string
  input_hash: string
  state: string
  artifact_id: string
  artifact_snapshot: unknown
  completed_at: Date | string | null
  requested_at: Date | string
  recollection_tombstone_id: string | null
}

interface CampaignRow extends QueryResultRow {
  purpose: string
  configuration: unknown
  budget: unknown
}

interface CountRow extends QueryResultRow {
  count: string
}

interface AnalysisHandoffRow extends QueryResultRow {
  handoff_id: string
  collection_workflow_id: string
  collection_run_id: string
  seed_review_id: string
  analysis_run_id: string
  state: 'queued' | 'dispatching' | 'started' | 'failed'
  attempt_count: number | string
  workflow_id: string | null
  failure_code: 'analysis_not_ready' | 'seed_not_approved' | 'handoff_dispatch_failed' | null
  failure_summary: string | null
  requested_at: Date | string
  next_attempt_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
  updated_at: Date | string
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function hashIdentifier(prefix: string, value: unknown): string {
  return `${prefix}:${contentHash(value).slice(0, 32)}`
}

export interface ProductionCollectionCompletedIdentity {
  result: ProductionCollectionResult
  requestHash: string
  idempotencyKey: string
  campaignId: string
  sourceId: string
  policyVersion: string
  query: string
  limit: number
  purpose: string
  requestedDisplayMode: 'excerpt' | 'metadata-only' | 'aggregate-only'
  manualImportBatchId: string | null
  recollectionTombstoneId: string | null
}

export interface ProductionCollectionRecollectionTarget {
  tombstoneId: string
  sourceId: string
  sourceRecordId: string
  completedAt: string
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function countRows(client: PoolClient, sql: string, parameters: unknown[]): Promise<number> {
  const result = await client.query<CountRow>(sql, parameters)
  return Number(result.rows[0]?.count ?? 0)
}

async function isProductionWorkspace(client: PoolClient, workspaceId: string): Promise<boolean> {
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

function validatePersistenceLease(
  lease: ProductionCollectionPersistenceLease
): ProductionCollectionPersistenceLease {
  return {
    leaseId: appseaIdentifierSchema.parse(lease.leaseId),
    inputHash: (() => {
      if (!/^[a-f0-9]{64}$/.test(lease.inputHash)) {
        throw new Error('Production collection lease inputHash must be a lowercase SHA-256 digest')
      }
      return lease.inputHash
    })()
  }
}

async function assertPersistenceLeaseInTransaction(
  client: PoolClient,
  workspaceId: string,
  lease: ProductionCollectionPersistenceLease
): Promise<void> {
  const result = await client.query<{ active: boolean }>(
    `SELECT appsea.assert_source_collection_lease($1, $2, $3) AS active`,
    [workspaceId, lease.leaseId, lease.inputHash]
  )
  if (!result.rows[0]?.active) {
    throw new ProductionCollectionLeaseAssertionError()
  }
}

async function assertHash(
  client: PoolClient,
  sql: string,
  parameters: unknown[],
  expectedHash: string,
  recordType: string,
  identifier: string
): Promise<void> {
  const result = await client.query<{ content_hash: string }>(sql, parameters)
  if (result.rows[0]?.content_hash !== expectedHash) {
    throw new ImmutableRecordConflictError(recordType, identifier)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    [
      'research_runs_workspace_id_idempotency_key_key',
      'research_runs_pkey',
      'research_runs_workspace_id_artifact_id_key'
    ].includes(String(error.constraint))
  )
}

function coverageGaps(input: ProductionCollectionPersistenceInput): string[] {
  const gaps = [
    'This collection covers only the requested source and query route; it is not a statistical sample.',
    'Opportunity clustering, competitor research, contrary-evidence review, deterministic scoring, and report generation have not run for this collection.'
  ]
  if (input.request.manualImportBatchId) {
    gaps.push(
      'This run uses owner-authorized tenant-private import evidence; it does not establish public market coverage or population-level prevalence.'
    )
  }
  if (!input.policy.deletion.supportsTombstones) {
    gaps.push(
      'The source has no tombstone feed; deletion absence requires a full-snapshot reconciliation.'
    )
  }
  return [...new Set(gaps)]
}

function redactionFields(
  evidenceFields: readonly string[] | null | undefined,
  sourceFields: readonly string[] | null | undefined
): EvidenceRedactionField[] {
  return evidenceRedactionFieldSchema
    .array()
    .parse([...new Set([...(evidenceFields ?? []), ...(sourceFields ?? [])])].sort())
}

function buildSnapshot(
  input: ProductionCollectionPersistenceInput,
  artifactId: string,
  sourceItemCount: number,
  evidenceCount: number,
  complaintCount: number,
  deletionCount: number
): ProductionCollectionSnapshot {
  return productionCollectionSnapshotSchema.parse({
    mode: 'production-collection',
    artifactId,
    requestHash: contentHash(input.request),
    sourceId: input.request.sourceId,
    policyVersion: input.request.policyVersion,
    query: input.request.query,
    ...(input.request.dateRange ? { dateRange: input.request.dateRange } : {}),
    limit: input.request.limit,
    purpose: input.request.purpose,
    requestedDisplayMode: input.request.requestedDisplayMode,
    manualImportBatchId: input.request.manualImportBatchId ?? null,
    recollectionTombstoneId: input.request.recollectionTombstoneId ?? null,
    sourceItemCount,
    evidenceCount,
    complaintCount,
    deletionCount,
    costMicros: input.costMicros,
    coverageGaps: coverageGaps(input),
    warnings: input.warnings,
    capturedAt: input.observedAt
  })
}

async function resultFromRun(
  client: PoolClient,
  workspaceId: string,
  run: ExistingRunRow,
  replayed: boolean
): Promise<ProductionCollectionResult> {
  const snapshot = productionCollectionSnapshotSchema.parse(run.artifact_snapshot)
  return productionCollectionResultSchema.parse({
    workspaceId,
    campaignId: run.campaign_id,
    runId: run.run_id,
    artifactId: run.artifact_id,
    sourceId: snapshot.sourceId,
    policyVersion: snapshot.policyVersion,
    query: snapshot.query,
    dateRange: snapshot.dateRange ?? { from: null, to: null },
    sourceItemCount: snapshot.sourceItemCount,
    evidenceCount: snapshot.evidenceCount,
    complaintCount: snapshot.complaintCount,
    deletionCount: snapshot.deletionCount,
    costMicros: snapshot.costMicros,
    manualImportBatchId: snapshot.manualImportBatchId,
    recollectionTombstoneId: snapshot.recollectionTombstoneId,
    coverageGaps: snapshot.coverageGaps,
    warnings: snapshot.warnings,
    state: 'completed',
    completedAt: run.completed_at ? asIso(run.completed_at) : snapshot.capturedAt,
    replayed
  })
}

async function readRun(
  client: PoolClient,
  workspaceId: string,
  idempotencyKey: string
): Promise<ExistingRunRow | undefined> {
  const result = await client.query<ExistingRunRow>(
    `SELECT run_id, campaign_id, idempotency_key, input_hash, state, artifact_id,
            artifact_snapshot, completed_at, recollection_tombstone_id
       FROM appsea.research_runs
      WHERE workspace_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [workspaceId, idempotencyKey]
  )
  return result.rows[0]
}

export class PostgresProductionCollectionRepository {
  constructor(private readonly pool: Pool) {}

  async readRecollectionTargetForUser(
    userId: string,
    workspaceId: string,
    tombstoneId: string,
    sourceId: string
  ): Promise<ProductionCollectionRecollectionTarget | null> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      (client) =>
        this.readRecollectionTargetInTransaction(client, workspaceId, tombstoneId, sourceId),
      { readOnly: true }
    )
  }

  async readRecollectionTarget(
    workspaceId: string,
    tombstoneId: string,
    sourceId: string
  ): Promise<ProductionCollectionRecollectionTarget | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      (client) =>
        this.readRecollectionTargetInTransaction(client, workspaceId, tombstoneId, sourceId),
      { readOnly: true }
    )
  }

  private async readRecollectionTargetInTransaction(
    client: PoolClient,
    workspaceId: string,
    tombstoneId: string,
    sourceId: string
  ): Promise<ProductionCollectionRecollectionTarget | null> {
    const result = await client.query<
      QueryResultRow & {
        tombstone_id: string
        source_id: string
        source_record_id: string
        completed_at: Date | string
      }
    >(
      `SELECT tombstone_id, source_id, source_record_id, completed_at
         FROM appsea.deletion_tombstones
        WHERE workspace_id = $1
          AND tombstone_id = $2
          AND source_id = $3
          AND state = 'completed'
          AND completed_at IS NOT NULL`,
      [workspaceId, tombstoneId, sourceId]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      tombstoneId: appseaIdentifierSchema.parse(row.tombstone_id),
      sourceId: appseaIdentifierSchema.parse(row.source_id),
      sourceRecordId: row.source_record_id,
      completedAt: asIso(row.completed_at)
    }
  }

  async readCompletedIdentity(
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionCompletedIdentity | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        if (!(await isProductionWorkspace(client, workspaceId))) return null
        const result = await client.query<ExistingRunRow>(
          `SELECT run_id, campaign_id, idempotency_key, input_hash, state, artifact_id,
                  artifact_snapshot, completed_at, recollection_tombstone_id
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2
              AND mode = 'production' AND state = 'completed'`,
          [workspaceId, runId]
        )
        const run = result.rows[0]
        if (!run) return null
        const snapshot = productionCollectionSnapshotSchema.parse(run.artifact_snapshot)
        return {
          result: await resultFromRun(client, workspaceId, run, true),
          requestHash: snapshot.requestHash,
          idempotencyKey: run.idempotency_key,
          campaignId: run.campaign_id,
          sourceId: snapshot.sourceId,
          policyVersion: snapshot.policyVersion,
          query: snapshot.query,
          limit: snapshot.limit,
          purpose: snapshot.purpose,
          requestedDisplayMode: snapshot.requestedDisplayMode,
          manualImportBatchId: snapshot.manualImportBatchId ?? null,
          recollectionTombstoneId: snapshot.recollectionTombstoneId
        }
      },
      { readOnly: true }
    )
  }

  /**
   * Reconstruct the server-owned analysis input from a completed collection.
   * The caller supplies no complaint payload: only confirmed/corrected, active,
   * excerpt-represented observations cross this boundary.
   */
  async readForAnalysis(
    userId: string,
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionAnalysisSource | null> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      (client) => this.readForAnalysisInTransaction(client, workspaceId, runId),
      { readOnly: true }
    )
  }

  /** Worker-only reconstruction uses the workspace RLS context without user impersonation. */
  async readForAnalysisAsWorker(
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionAnalysisSource | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      (client) => this.readForAnalysisInTransaction(client, workspaceId, runId),
      { readOnly: true }
    )
  }

  private async readForAnalysisInTransaction(
    client: PoolClient,
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionAnalysisSource | null> {
    if (!(await isProductionWorkspace(client, workspaceId))) return null
    const runResult = await client.query<ExistingRunRow>(
      `SELECT run_id, campaign_id, idempotency_key, input_hash, state, artifact_id,
                  artifact_snapshot, completed_at, requested_at, recollection_tombstone_id
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2
              AND mode = 'production' AND state = 'completed'`,
      [workspaceId, runId]
    )
    const run = runResult.rows[0]
    if (!run) return null
    const snapshot = productionCollectionSnapshotSchema.parse(run.artifact_snapshot)
    const campaignResult = await client.query<CampaignRow>(
      `SELECT purpose, budget
             FROM appsea.research_campaigns
            WHERE workspace_id = $1 AND campaign_id = $2`,
      [workspaceId, run.campaign_id]
    )
    const campaign = campaignResult.rows[0]
    if (!campaign || campaign.purpose !== snapshot.purpose) {
      throw new ProductionCollectionAnalysisUnavailableError()
    }
    const request = productionCollectionRequestSchema.parse({
      workspaceId,
      campaignId: run.campaign_id,
      runId,
      idempotencyKey: run.idempotency_key,
      sourceId: snapshot.sourceId,
      policyVersion: snapshot.policyVersion,
      query: snapshot.query,
      ...(snapshot.dateRange ? { dateRange: snapshot.dateRange } : {}),
      limit: snapshot.limit,
      purpose: campaign.purpose,
      requestedDisplayMode: snapshot.requestedDisplayMode,
      budget: researchJobBudgetSchema.parse(campaign.budget),
      requestedAt: asIso(run.requested_at),
      ...(snapshot.manualImportBatchId
        ? { manualImportBatchId: snapshot.manualImportBatchId }
        : {}),
      ...(snapshot.recollectionTombstoneId
        ? { recollectionTombstoneId: snapshot.recollectionTombstoneId }
        : {})
    })
    if (contentHash(request) !== snapshot.requestHash) {
      throw new ProductionCollectionAnalysisUnavailableError()
    }

    const policyResult = await client.query<
      QueryResultRow & {
        source_id: string
        display_name: string
        source_type: string
        lifecycle_state: string
        current_policy_version: string | null
        policy_version: string
        policy_state: string
        commercial_use: string
        policy_payload: unknown
        content_hash: string
        reviewed_at: Date | string | null
        expires_at: Date | string | null
        policy_document_ref: string | null
        review_id: string
      }
    >(
      `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, source.current_policy_version,
                  policy.policy_version, policy.policy_state, policy.commercial_use,
                  policy.policy_payload,
                  policy.content_hash, policy.reviewed_at, policy.expires_at,
                  policy.policy_document_ref,
                  (
                    SELECT review.review_id
                      FROM appsea.source_policy_reviews review
                     WHERE review.source_id = policy.source_id
                       AND review.policy_version = policy.policy_version
                       AND review.decision = 'approved'
                       AND review.content_hash = policy.content_hash
                       AND review.independence_attested
                       AND review.reviewer_role <> 'legacy'
                     ORDER BY review.reviewed_at DESC, review.review_id
                     LIMIT 1
                  ) AS review_id
             FROM appsea.sources source
             JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = $2
            WHERE source.source_id = $1
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
            LIMIT 1`,
      [snapshot.sourceId, snapshot.policyVersion]
    )
    const storedPolicy = policyResult.rows[0]
    if (
      !storedPolicy ||
      !storedPolicy.reviewed_at ||
      !storedPolicy.policy_payload ||
      contentHash(storedPolicy.policy_payload) !== storedPolicy.content_hash
    ) {
      throw new ProductionCollectionAnalysisUnavailableError()
    }
    const policyDraft = sourcePolicySchema.safeParse(storedPolicy.policy_payload)
    if (!policyDraft.success) throw new ProductionCollectionAnalysisUnavailableError()
    const policy = sourcePolicySchema.parse({
      ...policyDraft.data,
      displayName: storedPolicy.display_name,
      enabled: true,
      policyState: 'approved',
      reviewedAt: asIso(storedPolicy.reviewed_at),
      expiresAt: storedPolicy.expires_at ? asIso(storedPolicy.expires_at) : null,
      policyDocumentRef: storedPolicy.policy_document_ref ?? policyDraft.data.policyDocumentRef
    })
    const policySnapshot = productionPolicySnapshotSchema.parse({
      sourceId: storedPolicy.source_id,
      policyVersion: storedPolicy.policy_version,
      contentHash: storedPolicy.content_hash,
      reviewId: storedPolicy.review_id,
      policy
    })

    const evidenceRows = await client.query<
      QueryResultRow & {
        complaint_id: string
        evidence_id: string
        evidence_hash: string
        source_item_id: string
        source_record_id: string
        canonical_locator: string | null
        normalized_text: string
        language: string
        product_candidate: string
        company_candidate: string
        feature_candidate: string
        category_candidate: string
        redacted_fields: string[]
        source_redacted_fields: string[]
        analysis_snapshot: unknown
        allowed_representation: 'excerpt' | 'metadata-only' | 'aggregate-only'
        redacted: boolean
        captured_at: Date | string
        published_at: Date | string | null
        review_state: 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'
      }
    >(
      `SELECT complaint.complaint_id, evidence.evidence_id,
                  evidence.content_hash AS evidence_hash, evidence.source_item_id,
                  source_item.source_record_id, source_item.canonical_locator,
                  evidence.normalized_text,
                  evidence.language, evidence.product_candidate,
                   evidence.company_candidate, evidence.feature_candidate,
                   evidence.category_candidate, evidence.allowed_representation,
                   evidence.redacted, evidence.redacted_fields,
                   source_item.redacted_fields AS source_redacted_fields,
                   source_item.captured_at, source_item.published_at,
                  complaint.review_state, complaint.analysis_snapshot
             FROM appsea.research_run_source_items run_item
             JOIN appsea.research_run_complaints run_complaint
               ON run_complaint.workspace_id = run_item.workspace_id
              AND run_complaint.run_id = run_item.run_id
             JOIN appsea.complaint_observations complaint
               ON complaint.workspace_id = run_complaint.workspace_id
              AND complaint.complaint_id = run_complaint.complaint_id
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = complaint.workspace_id
              AND evidence.evidence_id = complaint.evidence_id
              AND evidence.source_item_id = run_item.source_item_id
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = run_item.workspace_id
              AND source_item.source_item_id = run_item.source_item_id
            WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
              AND complaint.review_state IN ('confirmed', 'corrected')
              AND evidence.deletion_state = 'active'
              AND source_item.deletion_state = 'active'
            ORDER BY source_item.captured_at, evidence.evidence_id`,
      [workspaceId, runId]
    )
    if (
      evidenceRows.rows.length === 0 ||
      evidenceRows.rows.some((row) => row.allowed_representation !== 'excerpt' || !row.redacted)
    ) {
      throw new ProductionCollectionAnalysisUnavailableError()
    }

    const tombstoneRows = await client.query<
      QueryResultRow & {
        source_id: string
        source_record_id: string
        received_at: Date | string
        reason: string
      }
    >(
      `SELECT tombstone.source_id, tombstone.source_record_id,
                  tombstone.received_at, tombstone.reason
             FROM appsea.deletion_tombstones tombstone
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = tombstone.workspace_id
              AND source_item.source_id = tombstone.source_id
              AND source_item.source_record_id = tombstone.source_record_id
             JOIN appsea.research_run_source_items run_item
               ON run_item.workspace_id = source_item.workspace_id
              AND run_item.source_item_id = source_item.source_item_id
            WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
            ORDER BY tombstone.received_at, tombstone.tombstone_id`,
      [workspaceId, runId]
    )
    const deletions = tombstoneRows.rows.map((row) =>
      sourceDeletionEventSchema.parse({
        sourceId: row.source_id,
        sourceRecordId: row.source_record_id,
        observedAt: asIso(row.received_at),
        reason: row.reason
      })
    )
    const coverageGaps = snapshot.coverageGaps.filter(
      (gap) => !gap.startsWith('Opportunity clustering, competitor research')
    )
    if (evidenceRows.rows.length < snapshot.complaintCount) {
      coverageGaps.push(
        'Only active complaint observations explicitly confirmed or corrected by a workspace reviewer enter this analysis.'
      )
    }
    const complaints = evidenceRows.rows.map((row) => {
      const fields = redactionFields(row.redacted_fields, row.source_redacted_fields)
      const complaint = productionAnalysisComplaintSchema.parse({
        id: row.complaint_id,
        sourceId: snapshot.sourceId,
        sourceRecordId: row.source_record_id,
        canonicalLocator: row.canonical_locator,
        capturedAt: asIso(row.captured_at),
        publishedAt: row.published_at === null ? null : asIso(row.published_at),
        query: snapshot.query || 'reviewed collection',
        product: row.product_candidate,
        company: row.company_candidate,
        feature: row.feature_candidate,
        category: row.category_candidate,
        text: row.normalized_text,
        language: row.language,
        synthetic: false,
        redacted: row.redacted,
        allowedRepresentation: row.allowed_representation,
        redactedFields: fields,
        evidenceId: row.evidence_id,
        sourceItemId: row.source_item_id,
        evidenceHash: row.evidence_hash
      })
      return fields.length > 0
        ? redactComplaint(complaint, { evidenceId: row.evidence_id, fields })
        : complaint
    })
    const analyses = evidenceRows.rows.map((row) => {
      const fields = redactionFields(row.redacted_fields, row.source_redacted_fields)
      const analysis = complaintAnalysisSchema.parse({
        ...complaintAnalysisSchema.parse(row.analysis_snapshot),
        reviewState: row.review_state
      })
      return fields.length > 0 ? redactComplaintAnalysis(analysis, new Set(fields)) : analysis
    })
    return productionCollectionAnalysisSourceSchema.parse({
      request,
      collectionArtifactId: run.artifact_id,
      runId,
      policySnapshot,
      complaints,
      analyses,
      deletions,
      coverageGaps: [...new Set(coverageGaps)],
      warnings: snapshot.warnings
    })
  }

  async persist(input: ProductionCollectionPersistenceInput): Promise<ProductionCollectionResult> {
    return this.persistInternal(input)
  }

  /** Persist only while the policy-bound source lease is locked and active. */
  async persistWithLease(
    input: ProductionCollectionPersistenceInput,
    lease: ProductionCollectionPersistenceLease
  ): Promise<ProductionCollectionResult> {
    return this.persistInternal(input, validatePersistenceLease(lease))
  }

  private async persistInternal(
    input: ProductionCollectionPersistenceInput,
    persistenceLease?: ProductionCollectionPersistenceLease
  ): Promise<ProductionCollectionResult> {
    const parsed = productionCollectionPersistenceInputSchema.parse(input)
    const inputHash = contentHash(parsed)
    const artifactId = hashIdentifier('production-collection', {
      workspaceId: parsed.request.workspaceId,
      campaignId: parsed.request.campaignId,
      runId: parsed.request.runId,
      inputHash
    })

    try {
      const transaction = parsed.request.manualImportBatchId
        ? withServiceWorkspaceTransaction
        : withWorkspaceTransaction
      return await transaction(
        this.pool,
        parsed.request.workspaceId,
        async (client) => {
          if (!(await isProductionWorkspace(client, parsed.request.workspaceId))) {
            throw new Error(
              'Production collection requires an active private non-fixture workspace'
            )
          }
          if (persistenceLease) {
            await assertPersistenceLeaseInTransaction(
              client,
              parsed.request.workspaceId,
              persistenceLease
            )
          }
          const existing = await readRun(
            client,
            parsed.request.workspaceId,
            parsed.request.idempotencyKey
          )
          if (existing) {
            if (existing.input_hash !== inputHash) {
              throw new IdempotencyConflictError(parsed.request.idempotencyKey)
            }
            if (existing.state !== 'completed') {
              throw new Error(`Production collection run ${existing.run_id} is ${existing.state}`)
            }
            return resultFromRun(client, parsed.request.workspaceId, existing, true)
          }

          const existingCampaign = await client.query<{ synthetic: boolean }>(
            // The later campaign upsert takes the write lock. This admission
            // read must remain lock-free because the worker only has the
            // narrow column grants needed for the production state update.
            `SELECT synthetic
               FROM appsea.research_campaigns
              WHERE workspace_id = $1 AND campaign_id = $2`,
            [parsed.request.workspaceId, parsed.request.campaignId]
          )
          if (existingCampaign.rows[0]?.synthetic) {
            throw new Error('Production collection cannot reuse a synthetic campaign')
          }

          const sourcePolicy = await client.query<
            QueryResultRow & {
              source_id: string
              display_name: string
              source_type: string
              lifecycle_state: string
              current_policy_version: string | null
              policy_state: string
              commercial_use: string
              display_mode: string
              content_hash: string
              reviewed_at: Date | string | null
              expires_at: Date | string | null
              policy_document_ref: string | null
              policy_payload: unknown
            }
          >(
            `SELECT source.source_id, source.display_name, source.source_type, source.lifecycle_state,
                    source.current_policy_version, policy.policy_state,
                    policy.commercial_use, policy.display_mode, policy.content_hash,
                    policy.reviewed_at, policy.expires_at,
                    policy.policy_document_ref, policy.policy_payload
               FROM appsea.sources source
               JOIN appsea.source_policy_versions policy
                 ON policy.source_id = source.source_id
                AND policy.policy_version = $2
              WHERE source.source_id = $1
                AND appsea.source_policy_has_complete_reviews(
                  policy.source_id, policy.policy_version, policy.content_hash
                )`,
            [parsed.request.sourceId, parsed.request.policyVersion]
          )
          const storedPolicy = sourcePolicy.rows[0]
          if (
            !storedPolicy ||
            storedPolicy.source_type === 'fixture' ||
            storedPolicy.lifecycle_state !== 'active' ||
            storedPolicy.current_policy_version !== parsed.request.policyVersion ||
            storedPolicy.policy_state !== 'approved' ||
            !['allowed', 'restricted'].includes(storedPolicy.commercial_use) ||
            storedPolicy.display_mode !== parsed.request.requestedDisplayMode ||
            !storedPolicy.reviewed_at ||
            (storedPolicy.expires_at && Date.parse(asIso(storedPolicy.expires_at)) <= Date.now())
          ) {
            throw new Error('Source policy is not approved for production collection')
          }
          const storedDraft = sourcePolicySchema.safeParse(storedPolicy.policy_payload)
          if (!storedDraft.success || contentHash(storedDraft.data) !== storedPolicy.content_hash) {
            throw new Error('Stored source policy failed its immutable content hash check')
          }
          const effectivePolicy = sourcePolicySchema.parse({
            ...storedDraft.data,
            displayName: storedPolicy.display_name,
            enabled: true,
            policyState: 'approved',
            reviewedAt: asIso(storedPolicy.reviewed_at),
            expiresAt: storedPolicy.expires_at ? asIso(storedPolicy.expires_at) : null,
            policyDocumentRef:
              storedPolicy.policy_document_ref ?? storedDraft.data.policyDocumentRef
          })
          if (
            parsed.policy.sourceId !== storedPolicy.source_id ||
            contentHash(parsed.policy) !== contentHash(effectivePolicy)
          ) {
            throw new Error('Collection policy does not match the approved database snapshot')
          }

          let recollectionTarget: ProductionCollectionRecollectionTarget | null = null
          if (parsed.request.recollectionTombstoneId) {
            recollectionTarget = await this.readRecollectionTargetInTransaction(
              client,
              parsed.request.workspaceId,
              parsed.request.recollectionTombstoneId,
              parsed.request.sourceId
            )
            if (!recollectionTarget) {
              throw new ProductionCollectionRecollectionUnavailableError()
            }
            if (
              parsed.complaints.some(
                (complaint) => complaint.sourceRecordId !== recollectionTarget?.sourceRecordId
              )
            ) {
              throw new ImmutableRecordConflictError(
                'source recollection record',
                parsed.request.recollectionTombstoneId
              )
            }
          }

          await client.query(
            `INSERT INTO appsea.research_campaigns
             (workspace_id, campaign_id, name, purpose, state, configuration, budget,
              synthetic, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'running', $5::jsonb, $6::jsonb, false, $7, $7)
           ON CONFLICT (workspace_id, campaign_id) DO UPDATE
             SET state = CASE
                   WHEN appsea.research_campaigns.state IN ('failed', 'canceled') THEN 'running'
                   ELSE appsea.research_campaigns.state
                 END,
                 configuration = EXCLUDED.configuration,
                 budget = EXCLUDED.budget,
                 updated_at = GREATEST(appsea.research_campaigns.updated_at, EXCLUDED.updated_at)
           WHERE appsea.research_campaigns.state <> 'archived'`,
            [
              parsed.request.workspaceId,
              parsed.request.campaignId,
              'Production source collection',
              parsed.request.purpose,
              JSON.stringify({
                mode: 'production-collection',
                sourceId: parsed.request.sourceId,
                policyVersion: parsed.request.policyVersion,
                query: parsed.request.query,
                requestedDisplayMode: parsed.request.requestedDisplayMode,
                ...(parsed.request.manualImportBatchId
                  ? { manualImportBatchId: parsed.request.manualImportBatchId }
                  : {}),
                ...(parsed.request.recollectionTombstoneId
                  ? { recollectionTombstoneId: parsed.request.recollectionTombstoneId }
                  : {})
              }),
              JSON.stringify(parsed.request.budget),
              parsed.observedAt
            ]
          )

          const snapshotBeforeCounts = buildSnapshot(parsed, artifactId, 0, 0, 0, 0)
          await client.query(
            `INSERT INTO appsea.research_runs
             (workspace_id, run_id, campaign_id, idempotency_key, mode, state,
              artifact_id, input_hash, artifact_snapshot, recollection_tombstone_id,
              coverage_gaps, warnings, requested_at, started_at)
           VALUES ($1, $2, $3, $4, 'production', 'running', $5, $6, $7::jsonb,
                   $8, $9, $10, $11, $12)`,
            [
              parsed.request.workspaceId,
              parsed.request.runId,
              parsed.request.campaignId,
              parsed.request.idempotencyKey,
              artifactId,
              inputHash,
              JSON.stringify(snapshotBeforeCounts),
              parsed.request.recollectionTombstoneId ?? null,
              snapshotBeforeCounts.coverageGaps,
              snapshotBeforeCounts.warnings,
              parsed.request.requestedAt,
              parsed.observedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.research_run_source_policies
             (workspace_id, run_id, source_id, policy_version, linked_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.request.workspaceId,
              parsed.request.runId,
              parsed.request.sourceId,
              parsed.request.policyVersion,
              parsed.observedAt
            ]
          )

          for (const complaint of parsed.complaints) {
            const text = normalizeText(complaint.text)
            const candidateSourceItemId = hashIdentifier('source-item', {
              sourceId: complaint.sourceId,
              sourceRecordId: complaint.sourceRecordId,
              recollectionTombstoneId: parsed.request.recollectionTombstoneId ?? null
            })
            const sourceItemHash = contentHash({
              sourceId: complaint.sourceId,
              sourceRecordId: complaint.sourceRecordId,
              capturedAt: complaint.capturedAt,
              publishedAt: complaint.publishedAt,
              query: complaint.query,
              canonicalLocator: complaint.canonicalLocator,
              product: complaint.product,
              company: complaint.company,
              feature: complaint.feature,
              category: complaint.category,
              text,
              synthetic: false
            })
            await client.query(
              `INSERT INTO appsea.source_items
               (workspace_id, source_item_id, source_id, source_policy_version,
                source_record_id, canonical_locator, query_route, content_hash,
                captured_at, published_at, synthetic, created_at, collection_purpose,
                requested_display_mode,
                recollection_tombstone_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $9, $11, $12, $13)
             ON CONFLICT (workspace_id, source_id, source_record_id)
               WHERE deletion_state = 'active' DO NOTHING`,
              [
                parsed.request.workspaceId,
                candidateSourceItemId,
                complaint.sourceId,
                parsed.request.policyVersion,
                complaint.sourceRecordId,
                complaint.canonicalLocator,
                complaint.query,
                sourceItemHash,
                complaint.capturedAt,
                complaint.publishedAt,
                parsed.request.purpose,
                parsed.request.requestedDisplayMode,
                parsed.request.recollectionTombstoneId ?? null
              ]
            )
            const storedSourceItem = await client.query<
              QueryResultRow & {
                source_item_id: string
                content_hash: string
                canonical_locator: string | null
                source_policy_version: string
                collection_purpose: string
                requested_display_mode: string
                deletion_state: string
                recollection_tombstone_id: string | null
              }
            >(
              `SELECT source_item_id, content_hash, canonical_locator, source_policy_version,
                      collection_purpose, requested_display_mode, deletion_state,
                      recollection_tombstone_id
                 FROM appsea.source_items
                WHERE workspace_id = $1 AND source_id = $2 AND source_record_id = $3
                  AND deletion_state = 'active'`,
              [parsed.request.workspaceId, complaint.sourceId, complaint.sourceRecordId]
            )
            const storedSourceItemRow = storedSourceItem.rows[0]
            const sourceItemId = storedSourceItemRow?.source_item_id ?? candidateSourceItemId
            if (
              !storedSourceItemRow ||
              storedSourceItemRow.content_hash !== sourceItemHash ||
              storedSourceItemRow.canonical_locator !== complaint.canonicalLocator ||
              storedSourceItemRow.source_policy_version !== parsed.request.policyVersion ||
              storedSourceItemRow.collection_purpose !== parsed.request.purpose ||
              storedSourceItemRow.requested_display_mode !== parsed.request.requestedDisplayMode ||
              storedSourceItemRow.deletion_state !== 'active' ||
              storedSourceItemRow.recollection_tombstone_id !==
                (parsed.request.recollectionTombstoneId ?? null)
            ) {
              throw new ImmutableRecordConflictError('source item', candidateSourceItemId)
            }
            await client.query(
              `INSERT INTO appsea.research_run_source_items
               (workspace_id, run_id, source_item_id, source_id, source_policy_version)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [
                parsed.request.workspaceId,
                parsed.request.runId,
                sourceItemId,
                complaint.sourceId,
                parsed.request.policyVersion
              ]
            )

            const evidenceId = hashIdentifier('evidence', {
              sourceItemId,
              normalizationVersion: productionNormalizerVersion
            })
            const evidenceHash = contentHash({
              sourceItemHash,
              text,
              language: complaint.language,
              allowedRepresentation: complaint.allowedRepresentation,
              redacted: complaint.redacted,
              product: complaint.product,
              company: complaint.company,
              feature: complaint.feature,
              category: complaint.category,
              normalizationVersion: productionNormalizerVersion
            })
            await client.query(
              `INSERT INTO appsea.evidence_records
               (workspace_id, evidence_id, source_item_id, normalized_text, language,
                allowed_representation, redacted, synthetic, normalization_version,
                content_hash, product_candidate, company_candidate, feature_candidate,
                category_candidate, policy_flags, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $12, $13,
                     $14::jsonb, $15)
             ON CONFLICT (workspace_id, evidence_id) DO NOTHING`,
              [
                parsed.request.workspaceId,
                evidenceId,
                sourceItemId,
                text,
                complaint.language,
                complaint.allowedRepresentation,
                complaint.redacted,
                productionNormalizerVersion,
                evidenceHash,
                complaint.product,
                complaint.company,
                complaint.feature,
                complaint.category,
                JSON.stringify({ sourcePolicyVersion: parsed.request.policyVersion }),
                parsed.observedAt
              ]
            )
            await assertHash(
              client,
              `SELECT content_hash FROM appsea.evidence_records
                WHERE workspace_id = $1 AND evidence_id = $2`,
              [parsed.request.workspaceId, evidenceId],
              evidenceHash,
              'evidence record',
              evidenceId
            )

            const complaintId = hashIdentifier('complaint', {
              sourceItemId,
              extractionVersion: productionExtractionVersion
            })
            // The persisted complaint identity is derived from the source
            // item, not trusted connector input. Keep the immutable analysis
            // snapshot keyed to that same identity so the production
            // analysis boundary can replay reviewed snapshots without
            // silently losing the complaint-to-analysis mapping.
            const analysis = complaintAnalysisSchema.parse({
              ...analyzeComplaint(complaint),
              complaintId
            })
            const complaintHash = contentHash({
              evidenceHash,
              classification: analysis.classification,
              complaintType: analysis.complaintType,
              problemStatement: analysis.problemStatement,
              affectedWorkflow: analysis.affectedWorkflow,
              targetProduct: analysis.entities.product.canonicalName ?? complaint.product,
              targetCompany: analysis.entities.company.canonicalName ?? complaint.company,
              targetFeature: analysis.entities.feature.canonicalName ?? complaint.feature,
              extractionVersion: analysis.extractionVersion,
              analysis
            })
            await client.query(
              `INSERT INTO appsea.complaint_observations
               (workspace_id, complaint_id, evidence_id, classification, complaint_type,
                problem_statement, affected_workflow, target_product, target_company,
                target_feature, severity, confidence, review_state, extraction_version,
                synthetic, content_hash, analysis_snapshot, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     $14, false, $15, $16::jsonb, $17)
             ON CONFLICT (workspace_id, complaint_id) DO NOTHING`,
              [
                parsed.request.workspaceId,
                complaintId,
                evidenceId,
                analysis.classification,
                analysis.complaintType,
                analysis.problemStatement,
                analysis.affectedWorkflow,
                analysis.entities.product.canonicalName ?? complaint.product,
                analysis.entities.company.canonicalName ?? complaint.company,
                analysis.entities.feature.canonicalName ?? complaint.feature,
                analysis.severity,
                analysis.classificationConfidence,
                analysis.reviewState,
                analysis.extractionVersion,
                complaintHash,
                JSON.stringify(analysis),
                parsed.observedAt
              ]
            )
            await assertHash(
              client,
              `SELECT content_hash FROM appsea.complaint_observations
                WHERE workspace_id = $1 AND complaint_id = $2`,
              [parsed.request.workspaceId, complaintId],
              complaintHash,
              'complaint observation',
              complaintId
            )
            await client.query(
              `INSERT INTO appsea.research_run_complaints
               (workspace_id, run_id, complaint_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
              [parsed.request.workspaceId, parsed.request.runId, complaintId]
            )
          }

          for (const deletion of parsed.deletions) {
            const tombstoneId = hashIdentifier('tombstone', {
              sourceId: deletion.sourceId,
              sourceRecordId: deletion.sourceRecordId,
              reason: deletion.reason
            })
            await client.query(
              `INSERT INTO appsea.deletion_tombstones
               (workspace_id, tombstone_id, source_id, source_record_id, reason, state, received_at)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6)
             ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING`,
              [
                parsed.request.workspaceId,
                tombstoneId,
                deletion.sourceId,
                deletion.sourceRecordId,
                deletion.reason,
                deletion.observedAt
              ]
            )
          }

          if (parsed.request.manualImportBatchId) {
            await consumeManualImportBatchInTransaction(client, {
              workspaceId: parsed.request.workspaceId,
              batchId: parsed.request.manualImportBatchId,
              campaignId: parsed.request.campaignId,
              policyVersion: parsed.request.policyVersion,
              runId: parsed.request.runId,
              observedAt: parsed.observedAt
            })
          }

          const sourceItemCount = await countRows(
            client,
            `SELECT count(*)::text AS count
               FROM appsea.research_run_source_items run_item
               JOIN appsea.source_items source_item
                 ON source_item.workspace_id = run_item.workspace_id
                AND source_item.source_item_id = run_item.source_item_id
              WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
                AND source_item.deletion_state = 'active'`,
            [parsed.request.workspaceId, parsed.request.runId]
          )
          const evidenceCount = await countRows(
            client,
            `SELECT count(*)::text AS count
               FROM appsea.evidence_records evidence
               JOIN appsea.research_run_source_items run_item
                 ON run_item.workspace_id = evidence.workspace_id
                AND run_item.source_item_id = evidence.source_item_id
               JOIN appsea.source_items source_item
                 ON source_item.workspace_id = run_item.workspace_id
                AND source_item.source_item_id = run_item.source_item_id
              WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
                AND source_item.deletion_state = 'active'
                AND evidence.deletion_state = 'active'`,
            [parsed.request.workspaceId, parsed.request.runId]
          )
          const complaintCount = await countRows(
            client,
            `SELECT count(*)::text AS count
               FROM appsea.research_run_complaints run_complaint
               JOIN appsea.complaint_observations complaint
                 ON complaint.workspace_id = run_complaint.workspace_id
                AND complaint.complaint_id = run_complaint.complaint_id
               JOIN appsea.evidence_records evidence
                 ON evidence.workspace_id = complaint.workspace_id
                AND evidence.evidence_id = complaint.evidence_id
              WHERE run_complaint.workspace_id = $1 AND run_complaint.run_id = $2
                AND evidence.deletion_state = 'active'`,
            [parsed.request.workspaceId, parsed.request.runId]
          )
          const snapshot = buildSnapshot(
            parsed,
            artifactId,
            sourceItemCount,
            evidenceCount,
            complaintCount,
            parsed.deletions.length
          )
          await client.query(
            `UPDATE appsea.research_runs
                SET state = 'completed',
                    artifact_snapshot = $3::jsonb,
                    coverage_gaps = $4,
                    warnings = $5,
                    completed_at = $6,
                    finished_at = $6
              WHERE workspace_id = $1 AND run_id = $2`,
            [
              parsed.request.workspaceId,
              parsed.request.runId,
              JSON.stringify(snapshot),
              snapshot.coverageGaps,
              snapshot.warnings,
              parsed.observedAt
            ]
          )
          await client.query(
            `UPDATE appsea.research_campaigns
                SET state = 'completed', updated_at = GREATEST(updated_at, $3)
              WHERE workspace_id = $1 AND campaign_id = $2
                AND state <> 'archived'`,
            [parsed.request.workspaceId, parsed.request.campaignId, parsed.observedAt]
          )
          await client.query(
            `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
              target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'service', 'appsea-worker', 'research.collection.completed',
                   'research_run', $3, $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.request.workspaceId,
              hashIdentifier('audit', {
                runId: parsed.request.runId,
                action: 'collection-completed'
              }),
              parsed.request.runId,
              JSON.stringify({
                sourceId: parsed.request.sourceId,
                policyVersion: parsed.request.policyVersion,
                sourceItemCount,
                complaintCount,
                deletionCount: parsed.deletions.length,
                costMicros: parsed.costMicros,
                synthetic: false
              }),
              parsed.observedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
              schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.collection.completed', 'research_run', $3,
                   '1.0.0', $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.request.workspaceId,
              hashIdentifier('outbox', {
                runId: parsed.request.runId,
                event: 'collection-completed'
              }),
              parsed.request.runId,
              JSON.stringify({
                workspaceId: parsed.request.workspaceId,
                runId: parsed.request.runId,
                sourceId: parsed.request.sourceId,
                sourceItemCount,
                complaintCount,
                costMicros: parsed.costMicros,
                synthetic: false
              }),
              parsed.observedAt
            ]
          )

          const completed = await client.query<ExistingRunRow>(
            `SELECT run_id, campaign_id, idempotency_key, input_hash, state, artifact_id,
            artifact_snapshot, completed_at, recollection_tombstone_id
               FROM appsea.research_runs
              WHERE workspace_id = $1 AND run_id = $2`,
            [parsed.request.workspaceId, parsed.request.runId]
          )
          const completedRun = completed.rows[0]
          if (!completedRun) throw new Error('Production collection run was not persisted')
          return resultFromRun(client, parsed.request.workspaceId, completedRun, false)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      return withWorkspaceTransaction(
        this.pool,
        parsed.request.workspaceId,
        async (client) => {
          const existing = await readRun(
            client,
            parsed.request.workspaceId,
            parsed.request.idempotencyKey
          )
          if (!existing) throw error
          if (existing.input_hash !== inputHash) {
            throw new IdempotencyConflictError(parsed.request.idempotencyKey)
          }
          if (existing.state !== 'completed') {
            throw new Error(`Production collection run ${existing.run_id} is ${existing.state}`)
          }
          return resultFromRun(client, parsed.request.workspaceId, existing, true)
        },
        { isolationLevel: 'READ COMMITTED' }
      )
    }
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionReadModel | null> {
    if (!(await isProductionWorkspace(client, workspaceId))) return null
    const run = await client.query<ExistingRunRow>(
      `SELECT run_id, campaign_id, idempotency_key, input_hash, state, artifact_id,
                    artifact_snapshot, completed_at, recollection_tombstone_id
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2
              AND mode = 'production' AND state = 'completed'`,
      [workspaceId, runId]
    )
    const storedRun = run.rows[0]
    if (!storedRun) return null
    productionCollectionSnapshotSchema.parse(storedRun.artifact_snapshot)
    const evidenceRows = await client.query<
      QueryResultRow & {
        evidence_id: string
        complaint_id: string
        review_state: 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'
        source_item_id: string
        source_record_id: string
        canonical_locator: string | null
        normalized_text: string
        language: string
        product_candidate: string
        company_candidate: string
        feature_candidate: string
        category_candidate: string
        redacted_fields: string[]
        source_redacted_fields: string[]
        analysis_snapshot: unknown
        allowed_representation: 'excerpt' | 'metadata-only' | 'aggregate-only'
        redacted: boolean
        captured_at: Date | string
        published_at: Date | string | null
      }
    >(
      `SELECT evidence.evidence_id, complaint.complaint_id, complaint.review_state,
                  evidence.source_item_id,
                  source_item.source_record_id, source_item.canonical_locator,
                  evidence.normalized_text,
                  evidence.language, evidence.product_candidate,
                   evidence.company_candidate, evidence.feature_candidate,
                   evidence.category_candidate, evidence.allowed_representation,
                   evidence.redacted, evidence.redacted_fields,
                   source_item.redacted_fields AS source_redacted_fields,
                   source_item.captured_at, source_item.published_at,
                  complaint.analysis_snapshot
             FROM appsea.research_run_source_items run_item
             JOIN appsea.research_run_complaints run_complaint
               ON run_complaint.workspace_id = run_item.workspace_id
              AND run_complaint.run_id = run_item.run_id
             JOIN appsea.complaint_observations complaint
               ON complaint.workspace_id = run_complaint.workspace_id
              AND complaint.complaint_id = run_complaint.complaint_id
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = run_item.workspace_id
              AND evidence.source_item_id = run_item.source_item_id
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = run_item.workspace_id
              AND source_item.source_item_id = run_item.source_item_id
            WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
              AND evidence.deletion_state = 'active'
              AND source_item.deletion_state = 'active'
              AND (evidence.synthetic OR evidence.redacted)
            ORDER BY source_item.captured_at DESC, evidence.evidence_id`,
      [workspaceId, runId]
    )
    const sourceCoverage = await client.query<
      QueryResultRow & {
        source_id: string
        display_name: string
        source_type: 'fixture' | 'api' | 'export' | 'licensed-feed' | 'manual'
        lifecycle_state: string
        policy_state: 'approved' | 'pending_review' | 'expired' | 'revoked'
        enabled: boolean
        display_mode: 'excerpt' | 'metadata-only' | 'aggregate-only' | 'fixture'
        coverage_notes: string[]
        reviewed_at: Date | string | null
        expires_at: Date | string | null
        observation_count: string
      }
    >(
      `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, policy.policy_state,
                  (
                    source.lifecycle_state = 'active'
                    AND (
                      source.source_type = 'fixture'
                      OR (
                        source.source_type <> 'fixture'
                        AND source.current_policy_version = policy.policy_version
                        AND policy.policy_state = 'approved'
                        AND policy.reviewed_at IS NOT NULL
                        AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
                        AND policy.commercial_use IN ('allowed', 'restricted')
                        AND appsea.source_policy_has_complete_reviews(
                          policy.source_id, policy.policy_version, policy.content_hash
                        )
                      )
                    )
                  ) AS enabled,
                  policy.display_mode, policy.coverage_notes,
                  policy.reviewed_at, policy.expires_at,
                  count(source_item.source_item_id)::text AS observation_count
             FROM appsea.research_run_source_policies run_policy
             JOIN appsea.sources source
               ON source.source_id = run_policy.source_id
             JOIN appsea.source_policy_versions policy
               ON policy.source_id = run_policy.source_id
              AND policy.policy_version = run_policy.policy_version
            LEFT JOIN appsea.research_run_source_items run_item
               ON run_item.workspace_id = run_policy.workspace_id
              AND run_item.run_id = run_policy.run_id
              AND run_item.source_id = run_policy.source_id
            LEFT JOIN appsea.source_items source_item
               ON source_item.workspace_id = run_item.workspace_id
              AND source_item.source_item_id = run_item.source_item_id
              AND source_item.deletion_state = 'active'
            WHERE run_policy.workspace_id = $1 AND run_policy.run_id = $2
            GROUP BY source.source_id, source.display_name, source.source_type,
                     source.lifecycle_state, policy.policy_state, policy.display_mode,
                     policy.coverage_notes, policy.reviewed_at, policy.expires_at
            ORDER BY source.source_id`,
      [workspaceId, runId]
    )
    const analysisHandoff = await client.query<AnalysisHandoffRow>(
      `SELECT handoff_id, collection_workflow_id, collection_run_id, seed_review_id,
              analysis_run_id, state, attempt_count, workflow_id, failure_code,
              failure_summary, requested_at, next_attempt_at, started_at,
              finished_at, updated_at
         FROM appsea.production_analysis_handoffs
        WHERE workspace_id = $1 AND collection_run_id = $2
        ORDER BY requested_at DESC, handoff_id
        LIMIT 1`,
      [workspaceId, runId]
    )
    const handoffRow = analysisHandoff.rows[0]
    const handoff: ProductionAnalysisHandoffReadModel | null = handoffRow
      ? productionAnalysisHandoffReadModelSchema.parse({
          handoffId: handoffRow.handoff_id,
          collectionWorkflowId: handoffRow.collection_workflow_id,
          collectionRunId: handoffRow.collection_run_id,
          seedReviewId: handoffRow.seed_review_id,
          analysisRunId: handoffRow.analysis_run_id,
          state: handoffRow.state,
          attemptCount: Number(handoffRow.attempt_count),
          workflowId: handoffRow.workflow_id,
          failureCode: handoffRow.failure_code,
          failureSummary: handoffRow.failure_summary,
          requestedAt: asIso(handoffRow.requested_at),
          nextAttemptAt: asIso(handoffRow.next_attempt_at),
          startedAt: handoffRow.started_at === null ? null : asIso(handoffRow.started_at),
          finishedAt: handoffRow.finished_at === null ? null : asIso(handoffRow.finished_at),
          updatedAt: asIso(handoffRow.updated_at)
        })
      : null
    const result = await resultFromRun(client, workspaceId, storedRun, false)
    return productionCollectionReadModelSchema.parse({
      result,
      evidence: evidenceRows.rows.map((row) => {
        const fields = redactionFields(row.redacted_fields, row.source_redacted_fields)
        const analysis = complaintAnalysisSchema.parse({
          ...complaintAnalysisSchema.parse(row.analysis_snapshot),
          reviewState: row.review_state
        })
        return {
          id: row.evidence_id,
          complaintId: row.complaint_id,
          reviewState: row.review_state,
          sourceItemId: row.source_item_id,
          sourceRecordId: row.source_record_id,
          canonicalLocator: fields.includes('canonicalLocator') ? null : row.canonical_locator,
          text: fields.includes('text')
            ? evidenceRedactionMarker
            : row.allowed_representation === 'excerpt'
              ? row.normalized_text
              : null,
          language: row.language,
          product: fields.includes('product') ? evidenceRedactionMarker : row.product_candidate,
          company: fields.includes('company') ? evidenceRedactionMarker : row.company_candidate,
          feature: fields.includes('feature') ? evidenceRedactionMarker : row.feature_candidate,
          category: fields.includes('category') ? evidenceRedactionMarker : row.category_candidate,
          analysis:
            fields.length > 0 ? redactComplaintAnalysis(analysis, new Set(fields)) : analysis,
          synthetic: false,
          redacted: row.redacted,
          redactedFields: fields,
          allowedRepresentation: row.allowed_representation,
          capturedAt: asIso(row.captured_at),
          publishedAt: row.published_at === null ? null : asIso(row.published_at)
        }
      }),
      sourceCoverage: sourceCoverage.rows.map((row) => ({
        sourceId: row.source_id,
        displayName: row.display_name,
        sourceType: row.source_type,
        policyState: row.policy_state,
        enabled: row.enabled,
        displayMode: row.display_mode,
        coverageNotes: row.coverage_notes,
        reviewedAt: row.reviewed_at === null ? null : asIso(row.reviewed_at),
        expiresAt: row.expires_at === null ? null : asIso(row.expires_at),
        observationCount: Number(row.observation_count),
        synthetic: false
      })),
      analysisHandoff: handoff
    })
  }

  async read(workspaceId: string, runId: string): Promise<ProductionCollectionReadModel | null> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      (client) => this.readInTransaction(client, workspaceId, runId),
      { readOnly: true }
    )
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    runId: string
  ): Promise<ProductionCollectionReadModel | null> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      (client) => this.readInTransaction(client, workspaceId, runId),
      { readOnly: true }
    )
  }

  async updateComplaintReview(
    userId: string,
    workspaceId: string,
    runId: string,
    complaintId: string,
    input: WorkspaceComplaintReviewInput
  ): Promise<WorkspaceComplaintReviewReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRunId = appseaIdentifierSchema.parse(runId)
    const parsedComplaintId = appseaIdentifierSchema.parse(complaintId)
    const parsedInput = workspaceComplaintReviewInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const actor = await client.query<{ role: string }>(
            `SELECT role
               FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2
              FOR SHARE`,
            [parsedWorkspaceId, parsedUserId]
          )
          if (!['owner', 'editor'].includes(actor.rows[0]?.role ?? '')) {
            throw new ProductionComplaintReviewPermissionError()
          }

          const result = await client.query<
            QueryResultRow & {
              complaint_id: string
              review_state: 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'
              evidence_state: string
              source_state: string
              redacted_fields: string[]
              source_redacted_fields: string[]
              analysis_snapshot: unknown
            }
          >(
            `SELECT complaint.complaint_id, complaint.review_state,
                     complaint.analysis_snapshot,
                     evidence.redacted_fields,
                     source_item.redacted_fields AS source_redacted_fields,
                     evidence.deletion_state AS evidence_state,
                    source_item.deletion_state AS source_state
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
                AND run_complaint.complaint_id = $3
              FOR UPDATE OF complaint`,
            [parsedWorkspaceId, parsedRunId, parsedComplaintId]
          )
          const row = result.rows[0]
          if (!row || row.evidence_state !== 'active' || row.source_state !== 'active') {
            throw new ProductionComplaintReviewNotFoundError()
          }
          const currentAnalysis = complaintAnalysisSchema.parse(row.analysis_snapshot)
          const fields = redactionFields(row.redacted_fields, row.source_redacted_fields)
          if (parsedInput.action === 'corrected') {
            const correction = parsedInput.analysisCorrection
            const correctionId = parsedInput.correctionId
            if (!correction || !correctionId) {
              throw new ProductionComplaintReviewConflictError()
            }
            const nextAnalysis = mergeComplaintAnalysisCorrection(currentAnalysis, correction)
            const correctionResult = await client.query<{
              review_state: string
              invalidated_analysis_count: number | string
              invalidated_opportunity_count: number | string
            }>(
              `SELECT review_state, invalidated_analysis_count,
                      invalidated_opportunity_count
                 FROM appsea.apply_complaint_analysis_correction(
                   $1, $2, $3, $4, $5, $6::jsonb
                 )`,
              [
                parsedWorkspaceId,
                parsedComplaintId,
                correctionId,
                contentHash(currentAnalysis),
                contentHash(nextAnalysis),
                JSON.stringify(nextAnalysis)
              ]
            )
            const corrected = correctionResult.rows[0]
            if (!corrected) throw new ProductionComplaintReviewConflictError()
            return workspaceComplaintReviewReadModelSchema.parse({
              complaintId: row.complaint_id,
              reviewState: corrected.review_state,
              analysis:
                fields.length > 0
                  ? redactComplaintAnalysis(nextAnalysis, new Set(fields))
                  : nextAnalysis,
              invalidatedAnalysisCount: Number(corrected.invalidated_analysis_count),
              invalidatedOpportunityCount: Number(corrected.invalidated_opportunity_count)
            })
          }
          if (row.review_state === parsedInput.action) {
            return workspaceComplaintReviewReadModelSchema.parse({
              complaintId: row.complaint_id,
              reviewState: row.review_state,
              analysis:
                fields.length > 0
                  ? redactComplaintAnalysis(currentAnalysis, new Set(fields))
                  : currentAnalysis
            })
          }
          const allowed =
            (row.review_state === 'unreviewed' &&
              (parsedInput.action === 'confirmed' || parsedInput.action === 'rejected')) ||
            (['confirmed', 'corrected'].includes(row.review_state) &&
              parsedInput.action === 'rejected')
          if (!allowed) throw new ProductionComplaintReviewConflictError()

          await client.query(
            `UPDATE appsea.complaint_observations
                SET review_state = $4
              WHERE workspace_id = $1
                AND complaint_id = $2
                AND EXISTS (
                  SELECT 1
                    FROM appsea.research_run_complaints run_complaint
                   WHERE run_complaint.workspace_id = $1
                     AND run_complaint.run_id = $3
                     AND run_complaint.complaint_id = $2
                )`,
            [parsedWorkspaceId, parsedComplaintId, parsedRunId, parsedInput.action]
          )
          return workspaceComplaintReviewReadModelSchema.parse({
            complaintId: parsedComplaintId,
            reviewState: parsedInput.action,
            analysis: (() => {
              const nextReviewAnalysis = complaintAnalysisSchema.parse({
                ...currentAnalysis,
                reviewState: parsedInput.action
              })
              return fields.length > 0
                ? redactComplaintAnalysis(nextReviewAnalysis, new Set(fields))
                : nextReviewAnalysis
            })()
          })
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isComplaintReviewConflict(error)) {
        throw new ProductionComplaintReviewConflictError()
      }
      throw error
    }
  }
}

function isComplaintReviewConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['23505', '23514'].includes(String((error as { code?: unknown }).code)) &&
    'message' in error &&
    /complaint(?:[ _](?:review|correction)|_analysis_corrections)|rejected complaints/i.test(
      String((error as { message?: unknown }).message)
    )
  )
}

function mergeComplaintAnalysisCorrection(
  current: ComplaintAnalysis,
  correction: ComplaintAnalysisCorrection
): ComplaintAnalysis {
  const entities = correction.entities ?? current.entities
  const unresolvedTypes: ComplaintAnalysis['entities']['unresolvedTypes'] = [
    ...(entities.product.canonicalName === null ? (['product'] as const) : []),
    ...(entities.company.canonicalName === null ? (['company'] as const) : []),
    ...(entities.feature.canonicalName === null ? (['feature'] as const) : []),
    ...(entities.substitutes.some((entry) => entry.canonicalName !== null)
      ? []
      : (['substitute'] as const)),
    ...(entities.competitors.some((entry) => entry.canonicalName !== null)
      ? []
      : (['competitor'] as const))
  ]
  return complaintAnalysisSchema.parse({
    ...current,
    ...correction,
    complaintId: current.complaintId,
    reviewState: 'corrected',
    extractionVersion: 'complaint-analysis-correction-v1',
    derivation: {
      ...current.derivation,
      modelVersion: 'human-correction-v1',
      promptVersion: 'none'
    },
    entities: {
      ...entities,
      unresolvedTypes
    }
  })
}
