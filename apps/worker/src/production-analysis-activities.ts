import { ApplicationFailure, Context } from '@temporalio/activity'
import {
  persistProductionAnalysisWorkflowActivityInputSchema,
  type ProductionAnalysisResult
} from '@appsea/contracts'
import {
  IdempotencyConflictError,
  ImmutableRecordConflictError,
  PostgresProductionAnalysisRepository,
  ProductionAnalysisAvailabilityError,
  ProductionAnalysisLineageError,
  ProductionAnalysisStateError
} from '@appsea/db'
import type { ObjectStore } from '@appsea/object-store'
import type { Pool } from 'pg'
import type { ProductionAnalysisActivities } from '@appsea/workflows'
import { fixtureResearchTaskQueue } from '@appsea/workflows'
import { emitWorkerEvent } from './observability'
import { reconstructProductionAnalysisArtifact } from './production-analysis-input'

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

function sanitizedFailure(error: unknown): ApplicationFailure {
  if (error instanceof ApplicationFailure) return error
  if (error instanceof ProductionAnalysisLineageError) {
    return ApplicationFailure.nonRetryable(
      'The production analysis policy or evidence lineage boundary rejected the request.',
      'APPSEA_POLICY_DENIED'
    )
  }
  if (error instanceof IdempotencyConflictError) {
    return ApplicationFailure.nonRetryable(
      'A production analysis identity conflicts with different content.',
      'APPSEA_IDEMPOTENCY_CONFLICT'
    )
  }
  if (
    error instanceof ImmutableRecordConflictError ||
    error instanceof ProductionAnalysisAvailabilityError ||
    error instanceof ProductionAnalysisStateError
  ) {
    return ApplicationFailure.nonRetryable(
      'Production analysis state or immutable output is invalid.',
      'APPSEA_IMMUTABLE_CONFLICT'
    )
  }
  if (errorName(error) === 'ZodError') {
    return ApplicationFailure.nonRetryable(
      'Production analysis input is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  return ApplicationFailure.create({
    message: 'The production analysis activity failed.',
    type: 'APPSEA_ACTIVITY_FAILED',
    nonRetryable: false
  })
}

async function runSanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const failure = sanitizedFailure(error)
    emitWorkerEvent({
      event: 'production_analysis_activity_failed',
      taskQueue: fixtureResearchTaskQueue,
      failureCode: failure.type ?? 'APPSEA_ACTIVITY_FAILED'
    })
    throw failure
  }
}

export function createProductionAnalysisActivities(
  pool: Pool,
  objectStore: ObjectStore
): ProductionAnalysisActivities {
  const repository = new PostgresProductionAnalysisRepository(pool, objectStore)
  return {
    persistProductionAnalysis: (input) =>
      runSanitized(async (): Promise<ProductionAnalysisResult> => {
        const parsed = persistProductionAnalysisWorkflowActivityInputSchema.parse(input)
        const attempt = Context.current().info.attempt
        const artifact = await reconstructProductionAnalysisArtifact(pool, {
          workspaceId: parsed.input.workspaceId,
          collectionRunId: parsed.input.collectionRunId,
          analysisRunId: parsed.input.analysisRunId,
          seedReviewId: parsed.input.seedReviewId,
          analysisAt: parsed.occurredAt
        })
        const result = await repository.persist({
          workspaceId: parsed.input.workspaceId,
          collectionRunId: parsed.input.collectionRunId,
          analysisRunId: parsed.input.analysisRunId,
          idempotencyKey: parsed.input.idempotencyDigest,
          requestedAt: parsed.occurredAt,
          artifact
        })
        emitWorkerEvent({
          event: 'production_analysis_activity_finished',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: result.state,
          attempt
        })
        return result
      })
  }
}
