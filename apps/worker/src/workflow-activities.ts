import type { Pool } from 'pg'
import { ApplicationFailure, Context } from '@temporalio/activity'
import {
  fixtureResearchInspectionSchema,
  fixtureResearchPersistenceActivityResultSchema,
  fixtureResearchWorkflowInputSchema,
  persistFixtureResearchActivityInputSchema,
  workflowJobCheckpointWriteSchema,
  workflowJobCompletionInputSchema,
  workflowJobInitializeInputSchema,
  workflowJobTerminationInputSchema
} from '@appsea/contracts'
import {
  IdempotencyConflictError,
  ImmutableRecordConflictError,
  PostgresFixtureResearchRepository,
  PostgresWorkflowJobRepository,
  WorkflowCheckpointConflictError,
  WorkflowJobConflictError,
  WorkflowJobStateError
} from '@appsea/db'
import { generatePlanPackage } from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'
import type {
  FixtureResearchActivities,
  TerminateFixtureResearchActivityResult
} from '@appsea/workflows'
import { fixtureResearchTaskQueue } from '@appsea/workflows'
import { emitWorkerEvent } from './observability'

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

export function sanitizedActivityFailure(error: unknown): ApplicationFailure {
  if (error instanceof ApplicationFailure) {
    if (
      error.type === 'APPSEA_INPUT_INVALID' ||
      error.type === 'APPSEA_IDEMPOTENCY_CONFLICT' ||
      error.type === 'APPSEA_IMMUTABLE_CONFLICT' ||
      error.type === 'APPSEA_POLICY_DENIED'
    ) {
      return ApplicationFailure.nonRetryable(
        'The fixture workflow activity rejected the request.',
        error.type
      )
    }
    return ApplicationFailure.create({
      message: 'The fixture workflow activity failed.',
      type: 'APPSEA_ACTIVITY_FAILED',
      nonRetryable: false
    })
  }
  if (
    error instanceof IdempotencyConflictError ||
    error instanceof WorkflowJobConflictError ||
    error instanceof WorkflowCheckpointConflictError
  ) {
    return ApplicationFailure.nonRetryable(
      'An idempotency identity conflicts with different content.',
      'APPSEA_IDEMPOTENCY_CONFLICT'
    )
  }
  if (
    error instanceof ImmutableRecordConflictError ||
    errorName(error) === 'InvalidScoreSnapshotError'
  ) {
    return ApplicationFailure.nonRetryable(
      'Immutable fixture content conflicts with an existing record.',
      'APPSEA_IMMUTABLE_CONFLICT'
    )
  }
  if (error instanceof WorkflowJobStateError || errorName(error) === 'ZodError') {
    return ApplicationFailure.nonRetryable(
      'Fixture workflow input or state is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  if (errorCode(error) === '42501') {
    return ApplicationFailure.nonRetryable(
      'A source or workspace policy denied the fixture operation.',
      'APPSEA_POLICY_DENIED'
    )
  }
  return ApplicationFailure.create({
    message: 'The fixture workflow activity failed.',
    type: 'APPSEA_ACTIVITY_FAILED',
    nonRetryable: false
  })
}

async function runSanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const failure = sanitizedActivityFailure(error)
    emitWorkerEvent({
      event: 'activity_failed',
      taskQueue: fixtureResearchTaskQueue,
      failureCode: failure.type ?? 'APPSEA_ACTIVITY_FAILED'
    })
    throw failure
  }
}

export function createFixtureResearchActivities(pool: Pool): FixtureResearchActivities {
  const fixtureRepository = new PostgresFixtureResearchRepository(pool)
  const workflowRepository = new PostgresWorkflowJobRepository(pool)

  return {
    initializeFixtureResearchJob: (input) =>
      runSanitized(async () => {
        const job = await workflowRepository.initialize(
          workflowJobInitializeInputSchema.parse(input)
        )
        return { state: job.state }
      }),

    inspectFixtureResearch: (input) =>
      runSanitized(async () => {
        const parsed = fixtureResearchWorkflowInputSchema.parse(input)
        const artifact = await buildFixtureResearchArtifact(parsed.fixtureAt)
        return fixtureResearchInspectionSchema.parse({
          sourceItemCount: artifact.complaints.length,
          estimatedCostMicros: 0
        })
      }),

    recordFixtureResearchCheckpoint: (input) =>
      runSanitized(async () => {
        const job = await workflowRepository.recordCheckpoint(
          workflowJobCheckpointWriteSchema.parse(input)
        )
        return { state: job.state }
      }),

    persistFixtureResearch: (input) =>
      runSanitized(async () => {
        const parsed = persistFixtureResearchActivityInputSchema.parse(input)
        const activityAttempt = Context.current().info.attempt
        const persistenceSequence = 400 + activityAttempt * 2 - 1
        await workflowRepository.recordCheckpoint({
          execution: parsed.execution,
          workspaceId: parsed.input.workspaceId,
          checkpointKey: `activity:persisting:attempt:${activityAttempt}`,
          sequenceNo: persistenceSequence,
          checkpoint: 'persisting',
          state: 'running',
          activityAttempt,
          consumedSourceItems: 0,
          consumedCostMicros: 0,
          occurredAt: parsed.occurredAt
        })

        const artifact = await buildFixtureResearchArtifact(parsed.input.fixtureAt)
        const planPackage = generatePlanPackage(artifact, parsed.input.fixtureAt)
        const persistence = await fixtureRepository.persist({
          workspaceId: parsed.input.workspaceId,
          campaignId: parsed.input.campaignId,
          runId: parsed.input.runId,
          idempotencyKey: `workflow:${parsed.input.idempotencyDigest}`,
          requestedAt: parsed.occurredAt,
          artifact,
          planPackage
        })
        const result = fixtureResearchPersistenceActivityResultSchema.parse({
          persistence,
          sourceItemsProcessed: persistence.sourceItemCount,
          costMicros: 0,
          activityAttempt
        })
        await workflowRepository.recordCheckpoint({
          execution: parsed.execution,
          workspaceId: parsed.input.workspaceId,
          checkpointKey: `activity:persisted:attempt:${activityAttempt}`,
          sequenceNo: persistenceSequence + 1,
          checkpoint: 'persisted',
          state: 'running',
          activityAttempt,
          consumedSourceItems: result.sourceItemsProcessed,
          consumedCostMicros: result.costMicros,
          occurredAt: new Date().toISOString()
        })
        return result
      }),

    completeFixtureResearchJob: (input) =>
      runSanitized(async () => {
        const parsed = workflowJobCompletionInputSchema.parse(input)
        const job = await workflowRepository.complete(parsed)
        emitWorkerEvent({
          event: 'workflow_finished',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: job.state,
          sourceItems: parsed.result.sourceItemsProcessed,
          costMicros: parsed.result.costMicros
        })
        return { state: job.state }
      }),

    terminateFixtureResearchJob: (input) =>
      runSanitized(async (): Promise<TerminateFixtureResearchActivityResult> => {
        const parsed = workflowJobTerminationInputSchema.parse(input)
        let job = await workflowRepository.read(
          parsed.input.workspaceId,
          parsed.execution.workflowId
        )
        if (!job) {
          job = await workflowRepository.initialize({
            execution: parsed.execution,
            input: parsed.input,
            occurredAt: parsed.occurredAt
          })
        }

        const committedIdentity = await fixtureRepository.readCompletedRunIdentity(
          parsed.input.workspaceId,
          parsed.input.runId
        )
        const expectedIdempotencyKey = `workflow:${parsed.input.idempotencyDigest}`
        const canReconcile =
          parsed.state !== 'budget_rejected' &&
          committedIdentity !== undefined &&
          committedIdentity.campaignId === parsed.input.campaignId &&
          committedIdentity.idempotencyKey === expectedIdempotencyKey
        const committed = canReconcile
          ? await fixtureRepository.read(parsed.input.workspaceId, parsed.input.runId)
          : undefined
        if (committed && committedIdentity) {
          const activityAttempt = Math.max(1, job.activityAttempts)
          const reconciled = fixtureResearchPersistenceActivityResultSchema.parse({
            persistence: { ...committed.result, replayed: true },
            sourceItemsProcessed: committed.result.sourceItemCount,
            costMicros: 0,
            activityAttempt
          })
          await workflowRepository.recordCheckpoint({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            checkpointKey: 'checkpoint:reconciled-persisted',
            sequenceNo: 850,
            checkpoint: 'persisted',
            state: 'running',
            activityAttempt,
            consumedSourceItems: reconciled.sourceItemsProcessed,
            consumedCostMicros: reconciled.costMicros,
            occurredAt: parsed.occurredAt
          })
          await workflowRepository.complete({
            execution: parsed.execution,
            workspaceId: parsed.input.workspaceId,
            result: reconciled,
            occurredAt: parsed.occurredAt
          })
          emitWorkerEvent({
            event: 'workflow_finished',
            taskQueue: fixtureResearchTaskQueue,
            workflowId: parsed.execution.workflowId,
            state: 'completed',
            sourceItems: reconciled.sourceItemsProcessed,
            costMicros: reconciled.costMicros
          })
          return { state: 'completed', reconciled }
        }

        await workflowRepository.terminate(parsed)
        emitWorkerEvent({
          event:
            parsed.state === 'budget_rejected' ? 'workflow_budget_rejected' : 'workflow_failed',
          taskQueue: fixtureResearchTaskQueue,
          workflowId: parsed.execution.workflowId,
          state: parsed.state,
          sourceItems: parsed.consumedSourceItems,
          costMicros: parsed.consumedCostMicros,
          failureCode: parsed.failureCode
        })
        return { state: parsed.state, reconciled: null }
      })
  }
}
