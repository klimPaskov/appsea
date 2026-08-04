import type { Pool } from 'pg'
import { ApplicationFailure, Context } from '@temporalio/activity'
import {
  type PersistProductionCollectionWorkflowActivityInput,
  persistProductionCollectionWorkflowActivityInputSchema,
  productionCollectionWorkflowCheckpointWriteSchema,
  productionCollectionWorkflowCompletionInputSchema,
  productionCollectionWorkflowJobInitializeInputSchema,
  productionCollectionWorkflowPersistenceActivityResultSchema,
  productionCollectionWorkflowTerminationInputSchema
} from '@appsea/contracts'
import {
  IdempotencyConflictError,
  ImmutableRecordConflictError,
  PostgresProductionCollectionRepository,
  PostgresProductionCollectionWorkflowRepository,
  ProductionCollectionRecollectionUnavailableError as DbProductionCollectionRecollectionUnavailableError,
  WorkflowCheckpointConflictError,
  WorkflowJobConflictError,
  WorkflowJobStateError
} from '@appsea/db'
import type {
  ProductionCollectionActivities,
  TerminateProductionCollectionActivityResult
} from '@appsea/workflows'
import { fixtureResearchTaskQueue } from '@appsea/workflows'
import {
  ProductionCollectionPolicyDeniedError,
  ProductionCollectionCostBudgetExceededError,
  ProductionCollectionReconciliationError,
  ProductionCollectionRecollectionUnavailableError,
  runProductionCollection
} from './production-cfpb-runner'
import { emitWorkerEvent } from './observability'

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

function sanitizedProductionActivityFailure(error: unknown): ApplicationFailure {
  if (error instanceof ApplicationFailure) return error
  if (
    error instanceof ProductionCollectionReconciliationError ||
    errorName(error) === 'SourceQuotaReservationReplayError'
  ) {
    return ApplicationFailure.nonRetryable(
      'The production collection quota was settled without a committed result; operator reconciliation is required.',
      'APPSEA_RECONCILIATION_REQUIRED'
    )
  }
  if (error instanceof ProductionCollectionPolicyDeniedError) {
    return ApplicationFailure.nonRetryable(
      'The production collection policy boundary rejected the request.',
      'APPSEA_POLICY_DENIED'
    )
  }
  if (error instanceof ProductionCollectionCostBudgetExceededError) {
    return ApplicationFailure.nonRetryable(
      'The production collection source cost exceeds the approved workflow budget.',
      'APPSEA_BUDGET_EXCEEDED',
      error.estimatedCostMicros
    )
  }
  if (
    error instanceof IdempotencyConflictError ||
    error instanceof WorkflowJobConflictError ||
    error instanceof WorkflowCheckpointConflictError
  ) {
    return ApplicationFailure.nonRetryable(
      'A production collection identity conflicts with different content.',
      'APPSEA_IDEMPOTENCY_CONFLICT'
    )
  }
  if (
    error instanceof ImmutableRecordConflictError ||
    error instanceof WorkflowJobStateError ||
    error instanceof ProductionCollectionRecollectionUnavailableError ||
    error instanceof DbProductionCollectionRecollectionUnavailableError ||
    errorName(error) === 'ProductionCollectionRecollectionUnavailableError'
  ) {
    return ApplicationFailure.nonRetryable(
      'Production collection state or immutable content is invalid.',
      'APPSEA_IMMUTABLE_CONFLICT'
    )
  }
  if (errorName(error) === 'ZodError') {
    return ApplicationFailure.nonRetryable(
      'Production collection input is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  return ApplicationFailure.create({
    message: 'The production collection activity failed.',
    type: 'APPSEA_ACTIVITY_FAILED',
    nonRetryable: false
  })
}

async function runSanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const failure = sanitizedProductionActivityFailure(error)
    emitWorkerEvent({
      event: 'production_collection_activity_failed',
      taskQueue: fixtureResearchTaskQueue,
      failureCode: failure.type ?? 'APPSEA_ACTIVITY_FAILED'
    })
    throw failure
  }
}

/**
 * Reconstruct the database-facing collection request from identifier-only
 * Temporal input. The manual import batch identifier must survive this
 * boundary so owner-authorized intake can be consumed by the connector.
 */
export function productionCollectionRequestFromActivityInput(
  input: PersistProductionCollectionWorkflowActivityInput['input']
) {
  return {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    runId: input.runId,
    // The caller-owned key is intentionally not placed in Temporal history;
    // the stable digest is the persistence idempotency key.
    idempotencyKey: input.idempotencyDigest,
    sourceId: input.sourceId,
    policyVersion: input.policyVersion,
    query: input.query,
    limit: input.limit,
    purpose: input.purpose,
    requestedDisplayMode: input.requestedDisplayMode,
    budget: input.budget,
    requestedAt: input.requestedAt,
    ...(input.manualImportBatchId ? { manualImportBatchId: input.manualImportBatchId } : {}),
    ...(input.recollectionTombstoneId
      ? { recollectionTombstoneId: input.recollectionTombstoneId }
      : {})
  }
}

export function createProductionCollectionActivities(pool: Pool): ProductionCollectionActivities {
  const workflowRepository = new PostgresProductionCollectionWorkflowRepository(pool)
  const collectionRepository = new PostgresProductionCollectionRepository(pool)

  return {
    initializeProductionCollectionJob: (input) =>
      runSanitized(async () => {
        const job = await workflowRepository.initialize(
          productionCollectionWorkflowJobInitializeInputSchema.parse(input)
        )
        return { state: job.state }
      }),

    recordProductionCollectionCheckpoint: (input) =>
      runSanitized(async () => {
        const job = await workflowRepository.recordCheckpoint(
          productionCollectionWorkflowCheckpointWriteSchema.parse(input)
        )
        return { state: job.state }
      }),

    persistProductionCollection: (input) =>
      runSanitized(async () => {
        const parsed = persistProductionCollectionWorkflowActivityInputSchema.parse(input)
        const activityAttempt = Context.current().info.attempt
        await workflowRepository.recordCheckpoint({
          execution: parsed.execution,
          workspaceId: parsed.input.workspaceId,
          checkpointKey: `checkpoint:persisting:attempt:${activityAttempt}`,
          sequenceNo: 400 + activityAttempt * 2 - 1,
          checkpoint: 'persisting',
          state: 'running',
          activityAttempt,
          consumedSourceItems: 0,
          consumedCostMicros: 0,
          occurredAt: parsed.occurredAt
        })
        const persistence = await runProductionCollection(
          pool,
          productionCollectionRequestFromActivityInput(parsed.input),
          { observedAt: parsed.occurredAt }
        )
        const result = productionCollectionWorkflowPersistenceActivityResultSchema.parse({
          persistence,
          sourceItemsProcessed: persistence.sourceItemCount,
          costMicros: persistence.costMicros,
          activityAttempt
        })
        await workflowRepository.recordCheckpoint({
          execution: parsed.execution,
          workspaceId: parsed.input.workspaceId,
          checkpointKey: `checkpoint:persisted:attempt:${activityAttempt}`,
          sequenceNo: 400 + activityAttempt * 2,
          checkpoint: 'persisted',
          state: 'running',
          activityAttempt,
          consumedSourceItems: result.sourceItemsProcessed,
          consumedCostMicros: result.costMicros,
          occurredAt: parsed.occurredAt
        })
        return result
      }),

    completeProductionCollectionJob: (input) =>
      runSanitized(async () => {
        const parsed = productionCollectionWorkflowCompletionInputSchema.parse(input)
        const job = await workflowRepository.complete(parsed)
        emitWorkerEvent({
          event: 'production_collection_workflow_finished',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: job.state,
          sourceItems: parsed.result.sourceItemsProcessed,
          costMicros: parsed.result.costMicros
        })
        return { state: job.state }
      }),

    terminateProductionCollectionJob: (input) =>
      runSanitized(async (): Promise<TerminateProductionCollectionActivityResult> => {
        const parsed = productionCollectionWorkflowTerminationInputSchema.parse(input)
        const completed = await collectionRepository.read(
          parsed.input.workspaceId,
          parsed.input.runId
        )
        if (completed) {
          const reconciled = productionCollectionWorkflowPersistenceActivityResultSchema.parse({
            persistence: { ...completed.result, replayed: true },
            sourceItemsProcessed: completed.result.sourceItemCount,
            costMicros: completed.result.costMicros,
            activityAttempt: 1
          })
          await workflowRepository.complete({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            result: reconciled,
            occurredAt: parsed.occurredAt
          })
          return { state: 'completed', reconciled }
        }
        const job = await workflowRepository.terminate(parsed)
        emitWorkerEvent({
          event: 'production_collection_workflow_failed',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: job.state,
          sourceItems: parsed.consumedSourceItems,
          costMicros: parsed.consumedCostMicros,
          failureCode: parsed.failureCode
        })
        return { state: parsed.state, reconciled: null }
      })
  }
}
