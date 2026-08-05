import {
  OpportunitySeedReviewLineageError,
  PostgresCompetitiveResearchRepository,
  PostgresOpportunitySeedReviewRepository,
  PostgresProductionCollectionRepository,
  ProductionCollectionAnalysisUnavailableError
} from '@appsea/db'
import { productionOpportunitySeedSchema, type ProductionResearchArtifact } from '@appsea/contracts'
import { buildProductionResearchArtifact } from '@appsea/research'
import type { Pool } from 'pg'

export interface ProductionAnalysisArtifactReconstructionInput {
  workspaceId: string
  collectionRunId: string
  analysisRunId: string
  seedReviewId: string
  analysisAt: string
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
