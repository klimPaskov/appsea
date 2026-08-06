import {
  OpportunitySeedReviewLineageError,
  PostgresCompetitiveResearchRepository,
  PostgresOpportunitySeedReviewRepository,
  PostgresProductionCollectionRepository,
  ProductionCollectionAnalysisUnavailableError
} from '@appsea/db'
import {
  productionOpportunitySeedSchema,
  type ModelGatewaySnapshot,
  type ProductionAnalysisComplaint,
  type ProductionPolicySnapshot,
  type ProductionResearchArtifact
} from '@appsea/contracts'
import { buildComplaintAnalysisRequest, createModelGateway } from '@appsea/model-gateway'
import { buildProductionResearchArtifact } from '@appsea/research'
import type { Pool } from 'pg'

export interface ProductionAnalysisArtifactReconstructionInput {
  workspaceId: string
  collectionRunId: string
  analysisRunId: string
  seedReviewId: string
  analysisAt: string
}

export interface ProductionModelGatewaySnapshotInput {
  workspaceId: string
  analysisRunId: string
  analysisAt: string
  policySnapshot: ProductionPolicySnapshot
  complaints: ProductionAnalysisComplaint[]
}

/**
 * Run the bounded gateway review inside the activity process. Only the
 * non-sensitive summary crosses into the production artifact; deterministic
 * and human-corrected complaint analyses remain authoritative.
 */
export function buildProductionModelGatewaySnapshot(
  input: ProductionModelGatewaySnapshotInput
): ModelGatewaySnapshot {
  const modelGateway = createModelGateway({
    provider: 'deterministic-fallback',
    policyState: 'external-not-approved',
    now: () => input.analysisAt
  })
  const gatewayResults = input.complaints.map((complaint) =>
    modelGateway.execute(
      buildComplaintAnalysisRequest({
        workspaceId: input.workspaceId,
        requestId: `model-request:${input.analysisRunId}:${complaint.id}`,
        idempotencyKey: `model-analysis:${input.analysisRunId}:${complaint.id}`,
        text: complaint.text,
        category: complaint.category,
        product: complaint.product,
        company: complaint.company,
        feature: complaint.feature,
        sourcePolicy: {
          sourceId: input.policySnapshot.sourceId,
          policyVersion: input.policySnapshot.policyVersion,
          contentHash: input.policySnapshot.contentHash
        }
      })
    )
  )
  return modelGateway.summarize(gatewayResults, input.analysisAt)
}

/**
 * Rebuild the analysis artifact inside a worker activity from workspace-bound
 * collection and seed rows. Complaint text never crosses the Temporal input
 * boundary; the database transaction and the reviewed seed remain the source
 * of truth for every retry.
 */
export async function reconstructProductionAnalysisArtifact(
  pool: Pool,
  input: ProductionAnalysisArtifactReconstructionInput
): Promise<ProductionResearchArtifact> {
  const collections = new PostgresProductionCollectionRepository(pool)
  const competitiveResearch = new PostgresCompetitiveResearchRepository(pool)
  const seeds = new PostgresOpportunitySeedReviewRepository(pool)
  const source = await collections.readForAnalysisAsWorker(input.workspaceId, input.collectionRunId)
  if (!source) throw new ProductionCollectionAnalysisUnavailableError()
  const seedReview = await seeds.readApprovedForWorker(input.workspaceId, input.seedReviewId)
  if (!seedReview) throw new OpportunitySeedReviewLineageError()
  const seed = productionOpportunitySeedSchema.safeParse(seedReview.seed)
  if (!seed.success) throw new OpportunitySeedReviewLineageError()
  const competitiveSnapshot = await competitiveResearch.readConfirmedSnapshotForAnalysis(
    input.workspaceId,
    input.collectionRunId,
    seed.data.id
  )
  const modelGatewaySnapshot = buildProductionModelGatewaySnapshot({
    workspaceId: input.workspaceId,
    analysisRunId: input.analysisRunId,
    analysisAt: input.analysisAt,
    policySnapshot: source.policySnapshot,
    complaints: source.complaints
  })
  return buildProductionResearchArtifact({
    collectionArtifactId: source.collectionArtifactId,
    runId: source.runId,
    analysisRunId: input.analysisRunId,
    transport: 'persisted-collection',
    testOnly: false,
    request: source.request,
    policySnapshot: source.policySnapshot,
    complaints: source.complaints,
    analyses: source.analyses,
    deletions: source.deletions,
    competitiveResearch: competitiveSnapshot,
    coverageGaps: source.coverageGaps,
    warnings: source.warnings,
    modelGateway: modelGatewaySnapshot,
    opportunitySeed: {
      seed: seed.data,
      seedVersion: seedReview.seedVersion,
      contentHash: seedReview.contentHash,
      reviewId: seedReview.seedReviewId,
      reviewedBy: seedReview.reviewedBy ?? seedReview.createdBy,
      reviewedAt: seedReview.reviewedAt ?? seedReview.createdAt
    },
    analysisAt: input.analysisAt
  })
}
