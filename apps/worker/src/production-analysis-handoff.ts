import type { WorkflowClient } from '@temporalio/client'
import {
  PostgresOpportunitySeedReviewRepository,
  PostgresProductionAnalysisHandoffRepository,
  PostgresProductionCollectionRepository,
  ProductionCollectionAnalysisUnavailableError,
  type ProductionAnalysisHandoffRecord
} from '@appsea/db'
import type { Pool } from 'pg'
import { startProductionAnalysisWorkflow } from '@appsea/workflows'
import { fixtureResearchTaskQueue } from '@appsea/workflows'
import { emitWorkerEvent } from './observability'

const retryDelaySeconds = 300
const transientDelaySeconds = 30

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

export interface ProductionAnalysisHandoffDispatcher {
  dispatchOne(workspaceId: string): Promise<ProductionAnalysisHandoffRecord | null>
  dispatchBatch(maxWorkspaces?: number): Promise<number>
}

/**
 * Dispatches committed handoffs without acquiring source data. Every input is
 * reconstructed from active policy/evidence rows and an approved seed review;
 * Temporal start is idempotent and the database claim is crash-recoverable.
 */
export function createProductionAnalysisHandoffDispatcher(
  pool: Pool,
  client: WorkflowClient
): ProductionAnalysisHandoffDispatcher {
  const handoffs = new PostgresProductionAnalysisHandoffRepository(pool)
  const collections = new PostgresProductionCollectionRepository(pool)
  const seeds = new PostgresOpportunitySeedReviewRepository(pool)

  async function dispatchOne(workspaceId: string): Promise<ProductionAnalysisHandoffRecord | null> {
    const claimed = await handoffs.claimNext(workspaceId)
    if (!claimed) return null

    try {
      const source = await collections.readForAnalysisAsWorker(
        claimed.workspaceId,
        claimed.collectionRunId
      )
      if (!source) throw new Error('collection is no longer available')
      const seedReview = await seeds.readApprovedForWorker(
        claimed.workspaceId,
        claimed.seedReviewId
      )
      if (!seedReview) {
        const failed = await handoffs.fail(
          claimed.workspaceId,
          claimed.handoffId,
          'seed_not_approved',
          'The reviewed analysis seed is no longer approved.'
        )
        emitWorkerEvent({
          event: 'production_analysis_handoff_failed',
          taskQueue: fixtureResearchTaskQueue,
          jobId: claimed.handoffId,
          state: failed.state,
          attempt: claimed.attemptCount,
          failureCode: 'APPSEA_SEED_NOT_APPROVED'
        })
        return null
      }
      const handle = await startProductionAnalysisWorkflow(client, {
        workspaceId: claimed.workspaceId,
        collectionRunId: claimed.collectionRunId,
        analysisRunId: claimed.analysisRunId,
        idempotencyKey: claimed.idempotencyKey,
        workflowVersion: 'production-analysis-v2',
        requestedAt: claimed.requestedAt,
        seedReviewId: seedReview.seedReviewId
      })
      const started = await handoffs.markStarted(
        claimed.workspaceId,
        claimed.handoffId,
        handle.workflowId
      )
      emitWorkerEvent({
        event: 'production_analysis_handoff_started',
        taskQueue: fixtureResearchTaskQueue,
        jobId: claimed.handoffId,
        workflowId: handle.workflowId,
        state: started.state,
        attempt: started.attemptCount
      })
      return started
    } catch (error) {
      const waitingForReview = error instanceof ProductionCollectionAnalysisUnavailableError
      const invalidSeedLineage = errorName(error) === 'OpportunitySeedReviewLineageError'
      if (invalidSeedLineage) {
        const failed = await handoffs.fail(
          claimed.workspaceId,
          claimed.handoffId,
          'seed_not_approved',
          'The reviewed analysis seed failed its stored-content integrity check.'
        )
        emitWorkerEvent({
          event: 'production_analysis_handoff_failed',
          taskQueue: fixtureResearchTaskQueue,
          jobId: claimed.handoffId,
          state: failed.state,
          attempt: claimed.attemptCount,
          failureCode: 'APPSEA_SEED_LINEAGE_INVALID'
        })
        return failed
      }
      const failureCode = waitingForReview ? 'analysis_not_ready' : 'handoff_dispatch_failed'
      const failureSummary = waitingForReview
        ? 'The collection needs confirmed active excerpt evidence before analysis can start.'
        : 'The post-collection analysis handoff could not be dispatched.'
      const retry = await handoffs.reschedule(
        claimed.workspaceId,
        claimed.handoffId,
        failureCode,
        failureSummary,
        waitingForReview ? retryDelaySeconds : transientDelaySeconds
      )
      emitWorkerEvent({
        event: 'production_analysis_handoff_failed',
        taskQueue: fixtureResearchTaskQueue,
        jobId: claimed.handoffId,
        state: retry.state,
        attempt: claimed.attemptCount,
        failureCode
      })
      return retry.state === 'failed' ? retry : null
    }
  }

  async function dispatchBatch(maxWorkspaces = 32): Promise<number> {
    if (!Number.isSafeInteger(maxWorkspaces) || maxWorkspaces < 1 || maxWorkspaces > 100) {
      throw new Error('handoff workspace batch size is outside the supported range')
    }
    const workspaceIds = await handoffs.listActiveWorkspaceIds()
    let dispatched = 0
    for (const workspaceId of workspaceIds.slice(0, maxWorkspaces)) {
      const result = await dispatchOne(workspaceId)
      if (result?.state === 'started') dispatched += 1
    }
    return dispatched
  }

  return { dispatchOne, dispatchBatch }
}
