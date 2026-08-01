import type { WorkflowClient } from '@temporalio/client'
import {
  PostgresOpportunitySeedReviewRepository,
  PostgresProductionAnalysisRecomputeRepository,
  PostgresProductionCollectionRepository,
  ProductionCollectionAnalysisUnavailableError,
  type ProductionAnalysisRecomputeRecord
} from '@appsea/db'
import type { Pool } from 'pg'
import { buildProductionResearchArtifact } from '@appsea/research'
import { fixtureResearchTaskQueue, startProductionAnalysisWorkflow } from '@appsea/workflows'
import { emitWorkerEvent } from './observability'

const retryDelaySeconds = 300
const transientDelaySeconds = 30

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

export interface ProductionAnalysisRecomputeDispatcher {
  dispatchOne(workspaceId: string): Promise<ProductionAnalysisRecomputeRecord | null>
  dispatchBatch(maxWorkspaces?: number): Promise<number>
}

/**
 * Dispatches deletion-triggered repairs without acquiring source data. The
 * collection is reconstructed from active policy/evidence rows and an
 * approved, immutable seed; Temporal owns the durable execution history.
 */
export function createProductionAnalysisRecomputeDispatcher(
  pool: Pool,
  client: WorkflowClient
): ProductionAnalysisRecomputeDispatcher {
  const recomputations = new PostgresProductionAnalysisRecomputeRepository(pool)
  const collections = new PostgresProductionCollectionRepository(pool)
  const seeds = new PostgresOpportunitySeedReviewRepository(pool)

  async function dispatchOne(
    workspaceId: string
  ): Promise<ProductionAnalysisRecomputeRecord | null> {
    const claimed = await recomputations.claimNext(workspaceId)
    if (!claimed) return null

    try {
      const source = await collections.readForAnalysisAsWorker(
        claimed.workspaceId,
        claimed.collectionRunId
      )
      if (!source) throw new ProductionCollectionAnalysisUnavailableError()

      const seedReview = await seeds.readApprovedForWorker(
        claimed.workspaceId,
        claimed.seedReviewId
      )
      if (!seedReview || seedReview.seed.id !== claimed.opportunityId) {
        const blocked = await recomputations.reschedule(
          claimed.workspaceId,
          claimed.recomputeId,
          'seed_not_approved',
          'The reviewed repair seed is missing, withdrawn, or targets another opportunity.',
          retryDelaySeconds
        )
        emitWorkerEvent({
          event: 'production_analysis_recompute_blocked',
          taskQueue: fixtureResearchTaskQueue,
          jobId: claimed.recomputeId,
          state: blocked.state,
          attempt: claimed.attemptCount,
          failureCode: 'APPSEA_RECOMPUTE_SEED_NOT_APPROVED'
        })
        return blocked
      }

      const artifact = buildProductionResearchArtifact({
        collectionArtifactId: source.collectionArtifactId,
        runId: source.runId,
        analysisRunId: claimed.analysisRunId,
        transport: 'persisted-collection',
        testOnly: false,
        request: source.request,
        policySnapshot: source.policySnapshot,
        complaints: source.complaints,
        deletions: source.deletions,
        coverageGaps: source.coverageGaps,
        warnings: source.warnings,
        opportunitySeed: {
          seed: seedReview.seed,
          seedVersion: seedReview.seedVersion,
          contentHash: seedReview.contentHash,
          reviewId: seedReview.seedReviewId,
          reviewedBy: seedReview.reviewedBy ?? seedReview.createdBy,
          reviewedAt: seedReview.reviewedAt ?? seedReview.createdAt
        },
        analysisAt: claimed.requestedAt
      })
      const handle = await startProductionAnalysisWorkflow(client, {
        workspaceId: claimed.workspaceId,
        collectionRunId: claimed.collectionRunId,
        analysisRunId: claimed.analysisRunId,
        idempotencyKey: claimed.idempotencyKey,
        workflowVersion: 'production-analysis-v1',
        requestedAt: claimed.requestedAt,
        artifact
      })
      const started = await recomputations.markStarted(
        claimed.workspaceId,
        claimed.recomputeId,
        handle.workflowId
      )
      emitWorkerEvent({
        event: 'production_analysis_recompute_started',
        taskQueue: fixtureResearchTaskQueue,
        jobId: claimed.recomputeId,
        workflowId: handle.workflowId,
        state: started.state,
        attempt: started.attemptCount
      })
      return started
    } catch (error) {
      const waitingForEvidence = error instanceof ProductionCollectionAnalysisUnavailableError
      const invalidSeedLineage = errorName(error) === 'OpportunitySeedReviewLineageError'
      if (invalidSeedLineage) {
        const failed = await recomputations.fail(
          claimed.workspaceId,
          claimed.recomputeId,
          'seed_not_approved',
          'The reviewed repair seed failed its stored-content integrity check.'
        )
        emitWorkerEvent({
          event: 'production_analysis_recompute_failed',
          taskQueue: fixtureResearchTaskQueue,
          jobId: claimed.recomputeId,
          state: failed.state,
          attempt: claimed.attemptCount,
          failureCode: 'APPSEA_RECOMPUTE_SEED_LINEAGE_INVALID'
        })
        return failed
      }
      const failureCode = waitingForEvidence ? 'analysis_not_ready' : 'recompute_dispatch_failed'
      const failureSummary = waitingForEvidence
        ? 'The collection needs confirmed, active, policy-allowed evidence before repair can start.'
        : 'The deletion-triggered analysis repair could not be dispatched.'
      const retry = await recomputations.reschedule(
        claimed.workspaceId,
        claimed.recomputeId,
        failureCode,
        failureSummary,
        waitingForEvidence ? retryDelaySeconds : transientDelaySeconds
      )
      emitWorkerEvent({
        event: 'production_analysis_recompute_failed',
        taskQueue: fixtureResearchTaskQueue,
        jobId: claimed.recomputeId,
        state: retry.state,
        attempt: claimed.attemptCount,
        failureCode: waitingForEvidence
          ? 'APPSEA_RECOMPUTE_ANALYSIS_NOT_READY'
          : 'APPSEA_RECOMPUTE_DISPATCH_FAILED'
      })
      return retry.state === 'failed' ? retry : null
    }
  }

  async function dispatchBatch(maxWorkspaces = 32): Promise<number> {
    if (!Number.isSafeInteger(maxWorkspaces) || maxWorkspaces < 1 || maxWorkspaces > 100) {
      throw new Error('recomputation workspace batch size is outside the supported range')
    }
    const workspaceIds = await recomputations.listActiveWorkspaceIds()
    let dispatched = 0
    for (const workspaceId of workspaceIds.slice(0, maxWorkspaces)) {
      const result = await dispatchOne(workspaceId)
      if (result?.state === 'started') dispatched += 1
    }
    return dispatched
  }

  return { dispatchOne, dispatchBatch }
}
