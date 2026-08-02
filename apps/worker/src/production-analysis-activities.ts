import { ApplicationFailure, Context } from '@temporalio/activity'
import {
  persistProductionAnalysisWorkflowActivityInputSchema,
  productionAnalysisWorkflowPersistenceActivityResultSchema
} from '@appsea/contracts'
import type { ProductionAnalysisFailureCode } from '@appsea/contracts'
import {
  IdempotencyConflictError,
  ImmutableRecordConflictError,
  PostgresProductionAnalysisRepository,
  type ProductionAnalysisActivityAttemptIdentity,
  ProductionAnalysisAvailabilityError,
  ProductionAnalysisAdmissionRequiredError,
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
  if (error instanceof ProductionAnalysisAdmissionRequiredError) {
    return ApplicationFailure.nonRetryable(
      'Production analysis admission is missing or expired.',
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

function failureCodeFor(error: ApplicationFailure): ProductionAnalysisFailureCode {
  switch (error.type) {
    case 'APPSEA_INPUT_INVALID':
      return 'analysis_input_invalid'
    case 'APPSEA_POLICY_DENIED':
      return 'analysis_policy_denied'
    case 'APPSEA_BUDGET_EXCEEDED':
      return 'analysis_budget_exceeded'
    case 'APPSEA_RECONCILIATION_REQUIRED':
      return 'analysis_reconciliation_required'
    default:
      return 'analysis_activity_failed'
  }
}

export function createProductionAnalysisActivities(
  pool: Pool,
  objectStore: ObjectStore
): ProductionAnalysisActivities {
  const repository = new PostgresProductionAnalysisRepository(pool, objectStore)
  return {
    persistProductionAnalysis: async (input) => {
      const parsed = persistProductionAnalysisWorkflowActivityInputSchema.parse(input)
      const attempt = Context.current().info.attempt
      const activityIdentity: ProductionAnalysisActivityAttemptIdentity = {
        workspaceId: parsed.input.workspaceId,
        collectionRunId: parsed.input.collectionRunId,
        analysisRunId: parsed.input.analysisRunId,
        activityAttempt: attempt
      }
      await repository.recordActivityAttemptStarted(activityIdentity)
      try {
        Context.current().heartbeat({ activityAttempt: attempt, phase: 'reconstructing' })
        const artifact = await reconstructProductionAnalysisArtifact(pool, {
          workspaceId: parsed.input.workspaceId,
          collectionRunId: parsed.input.collectionRunId,
          analysisRunId: parsed.input.analysisRunId,
          seedReviewId: parsed.input.seedReviewId,
          analysisAt: parsed.occurredAt
        })
        await repository.recordActivityAttemptHeartbeat(activityIdentity)
        Context.current().heartbeat({ activityAttempt: attempt, phase: 'persisting' })
        const persistence = await repository.persist(
          {
            workspaceId: parsed.input.workspaceId,
            collectionRunId: parsed.input.collectionRunId,
            analysisRunId: parsed.input.analysisRunId,
            idempotencyKey: parsed.input.idempotencyDigest,
            requestedAt: parsed.occurredAt,
            workflowInputHash: parsed.input.inputHash,
            requestedBy: parsed.input.requestedBy,
            artifact
          },
          attempt
        )
        Context.current().heartbeat({ activityAttempt: attempt, phase: 'completed' })
        await repository.recordActivityAttemptFinished({
          ...activityIdentity,
          state: 'completed'
        })
        const result = productionAnalysisWorkflowPersistenceActivityResultSchema.parse({
          persistence,
          activityAttempt: attempt
        })
        emitWorkerEvent({
          event: 'production_analysis_activity_finished',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: result.persistence.state,
          attempt
        })
        return result
      } catch (error) {
        const failure = sanitizedFailure(error)
        await repository.recordActivityAttemptFinished({
          ...activityIdentity,
          state: 'failed',
          failureCode: failureCodeFor(failure)
        })
        emitWorkerEvent({
          event: 'production_analysis_activity_failed',
          taskQueue: fixtureResearchTaskQueue,
          failureCode: failure.type ?? 'APPSEA_ACTIVITY_FAILED'
        })
        throw failure
      }
    }
  }
}
