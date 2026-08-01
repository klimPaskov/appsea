import {
  ActivityCancellationType,
  CancellationScope,
  ApplicationFailure,
  defineQuery,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo
} from '@temporalio/workflow'
import type {
  FixtureResearchWorkflowInput,
  FixtureResearchWorkflowResult,
  FixtureResearchWorkflowStatus,
  ProductionCollectionWorkflowExecutionMetadata,
  WorkflowExecutionMetadata,
  WorkflowFailureCode
} from '@appsea/contracts'
import {
  productionAnalysisWorkflowInputSchema,
  type ProductionAnalysisResult,
  type ProductionAnalysisWorkflowInput,
  type ProductionAnalysisWorkflowResult,
  type ProductionAnalysisWorkflowStatus,
  type ProductionAnalysisWorkflowExecutionMetadata
} from '@appsea/contracts'
import { productionCollectionWorkflowInputSchema } from '@appsea/contracts'
import type {
  ProductionCollectionWorkflowInput,
  ProductionCollectionWorkflowResult,
  ProductionCollectionWorkflowStatus
} from '@appsea/contracts'
import type {
  FixtureResearchActivities,
  ProductionAnalysisActivities,
  ProductionCollectionActivities
} from './activity-contracts'
import {
  fixtureResearchStatusQueryName,
  fixtureResearchTaskQueue,
  productionAnalysisStatusQueryName,
  productionAnalysisWorkflowVersion,
  productionCollectionStatusQueryName,
  productionCollectionWorkflowVersion
} from './constants'

export const fixtureResearchStatusQuery = defineQuery<FixtureResearchWorkflowStatus>(
  fixtureResearchStatusQueryName
)

export const productionCollectionStatusQuery = defineQuery<ProductionCollectionWorkflowStatus>(
  productionCollectionStatusQueryName
)

export const productionAnalysisStatusQuery = defineQuery<ProductionAnalysisWorkflowStatus>(
  productionAnalysisStatusQueryName
)

const fixedFailureSummaries: Record<WorkflowFailureCode, string> = {
  source_item_budget_exceeded: 'Fixture source-item estimate exceeds the approved workflow budget.',
  cost_budget_exceeded: 'Fixture cost estimate exceeds the approved workflow budget.',
  activity_failed: 'A fixture research activity exhausted its bounded retry policy.',
  workflow_canceled: 'Fixture research was canceled before its persistence commit boundary.'
}

function applicationFailureType(error: unknown): string | undefined {
  if (error instanceof ApplicationFailure) return error.type ?? undefined
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return applicationFailureType(error.cause)
  }
  return undefined
}

function productionFailureSummary(error: unknown): string {
  switch (applicationFailureType(error)) {
    case 'APPSEA_POLICY_DENIED':
      return 'The production collection policy boundary rejected the request.'
    case 'APPSEA_RECONCILIATION_REQUIRED':
      return 'The production collection quota was settled without a committed result; operator reconciliation is required.'
    case 'APPSEA_IDEMPOTENCY_CONFLICT':
      return 'A production collection identity conflicts with different content.'
    case 'APPSEA_IMMUTABLE_CONFLICT':
      return 'Production collection state or immutable content is invalid.'
    case 'APPSEA_INPUT_INVALID':
      return 'Production collection input is invalid.'
    default:
      return productionFailureSummaries.activity_failed
  }
}

const workflowInputKeys = new Set([
  'workspaceId',
  'campaignId',
  'runId',
  'idempotencyDigest',
  'inputHash',
  'workflowVersion',
  'fixtureAt',
  'budget',
  'requestedBy'
])
const budgetKeys = new Set(['currency', 'maxSourceItems', 'maxCostMicros', 'maxActivityAttempts'])
const actorKeys = new Set(['actorType', 'actorId'])
const actorIdPattern = /^[a-z][a-z0-9_:-]{2,159}$/

function sanitizeWorkflowInput(input: FixtureResearchWorkflowInput): FixtureResearchWorkflowInput {
  const candidate = input as unknown as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (
    keys.some((key) => !workflowInputKeys.has(key)) ||
    (keys.length !== workflowInputKeys.size && keys.length !== workflowInputKeys.size - 1)
  ) {
    throw ApplicationFailure.nonRetryable(
      'Fixture workflow input contains unsupported fields.',
      'APPSEA_INPUT_INVALID'
    )
  }
  const budget = candidate.budget
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
    throw ApplicationFailure.nonRetryable(
      'Fixture workflow budget is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  const budgetRecord = budget as Record<string, unknown>
  const budgetFieldNames = Object.keys(budgetRecord)
  if (
    budgetFieldNames.length !== budgetKeys.size ||
    budgetFieldNames.some((key) => !budgetKeys.has(key)) ||
    budgetRecord.currency !== 'USD' ||
    typeof budgetRecord.maxSourceItems !== 'number' ||
    typeof budgetRecord.maxCostMicros !== 'number' ||
    typeof budgetRecord.maxActivityAttempts !== 'number'
  ) {
    throw ApplicationFailure.nonRetryable(
      'Fixture workflow budget is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  let requestedBy: FixtureResearchWorkflowInput['requestedBy']
  if (candidate.requestedBy !== undefined) {
    const actor = candidate.requestedBy
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
      throw ApplicationFailure.nonRetryable(
        'Fixture workflow actor is invalid.',
        'APPSEA_INPUT_INVALID'
      )
    }
    const actorRecord = actor as Record<string, unknown>
    const actorFieldNames = Object.keys(actorRecord)
    if (
      actorFieldNames.length !== actorKeys.size ||
      actorFieldNames.some((key) => !actorKeys.has(key)) ||
      (actorRecord.actorType !== 'user' && actorRecord.actorType !== 'service') ||
      typeof actorRecord.actorId !== 'string' ||
      !actorIdPattern.test(actorRecord.actorId) ||
      (actorRecord.actorType === 'service' && actorRecord.actorId !== 'appsea-worker')
    ) {
      throw ApplicationFailure.nonRetryable(
        'Fixture workflow actor is invalid.',
        'APPSEA_INPUT_INVALID'
      )
    }
    if (actorRecord.actorType === 'user') {
      requestedBy = { actorType: 'user', actorId: actorRecord.actorId }
    } else {
      requestedBy = { actorType: 'service', actorId: 'appsea-worker' }
    }
  }
  return {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    runId: input.runId,
    idempotencyDigest: input.idempotencyDigest,
    inputHash: input.inputHash,
    workflowVersion: input.workflowVersion,
    fixtureAt: input.fixtureAt,
    budget: {
      currency: 'USD',
      maxSourceItems: budgetRecord.maxSourceItems,
      maxCostMicros: budgetRecord.maxCostMicros,
      maxActivityAttempts: budgetRecord.maxActivityAttempts
    },
    ...(requestedBy ? { requestedBy } : {})
  }
}

function executionMetadata(): WorkflowExecutionMetadata {
  const info = workflowInfo()
  if (info.workflowType !== 'fixtureResearchWorkflow') {
    throw ApplicationFailure.nonRetryable(
      'Unexpected workflow type.',
      'APPSEA_WORKFLOW_TYPE_INVALID'
    )
  }
  if (info.taskQueue !== fixtureResearchTaskQueue) {
    throw ApplicationFailure.nonRetryable(
      'Unexpected workflow task queue.',
      'APPSEA_WORKFLOW_TASK_QUEUE_INVALID'
    )
  }
  return {
    workflowId: info.workflowId,
    temporalFirstExecutionRunId: info.firstExecutionRunId,
    workflowType: 'fixtureResearchWorkflow',
    workflowVersion: 'fixture-research-v1',
    taskQueue: info.taskQueue
  }
}

export async function fixtureResearchWorkflow(
  input: FixtureResearchWorkflowInput
): Promise<FixtureResearchWorkflowResult> {
  input = sanitizeWorkflowInput(input)
  const execution = executionMetadata()
  if (input.workflowVersion !== execution.workflowVersion) {
    throw ApplicationFailure.nonRetryable(
      'Unsupported fixture research workflow version.',
      'APPSEA_WORKFLOW_VERSION_INVALID'
    )
  }

  const activities = proxyActivities<FixtureResearchActivities>({
    startToCloseTimeout: '30 seconds',
    scheduleToCloseTimeout: '2 minutes',
    heartbeatTimeout: '5 seconds',
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      initialInterval: '1 second',
      maximumInterval: '10 seconds',
      backoffCoefficient: 2,
      maximumAttempts: input.budget.maxActivityAttempts,
      nonRetryableErrorTypes: [
        'APPSEA_INPUT_INVALID',
        'APPSEA_IDEMPOTENCY_CONFLICT',
        'APPSEA_IMMUTABLE_CONFLICT',
        'APPSEA_POLICY_DENIED',
        'APPSEA_RECONCILIATION_REQUIRED'
      ]
    }
  })
  const cleanupActivities = proxyActivities<FixtureResearchActivities>({
    startToCloseTimeout: '30 seconds',
    scheduleToCloseTimeout: '3 minutes',
    retry: {
      initialInterval: '1 second',
      maximumInterval: '15 seconds',
      backoffCoefficient: 2,
      maximumAttempts: 5,
      nonRetryableErrorTypes: [
        'APPSEA_INPUT_INVALID',
        'APPSEA_IDEMPOTENCY_CONFLICT',
        'APPSEA_IMMUTABLE_CONFLICT',
        'APPSEA_POLICY_DENIED',
        'APPSEA_RECONCILIATION_REQUIRED'
      ]
    }
  })

  let lastTransitionTime = Date.now()
  const transitionTime = (): string => {
    lastTransitionTime = Math.max(lastTransitionTime, Date.now())
    return new Date(lastTransitionTime).toISOString()
  }
  let status: FixtureResearchWorkflowStatus = {
    workflowId: execution.workflowId,
    temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
    inputHash: input.inputHash,
    state: 'queued',
    checkpoint: 'accepted',
    activityAttempts: 0,
    consumedSourceItems: 0,
    consumedCostMicros: 0,
    result: null
  }
  setHandler(fixtureResearchStatusQuery, () => status)

  try {
    await activities.initializeFixtureResearchJob({
      execution,
      input,
      occurredAt: transitionTime()
    })
    status = { ...status, state: 'running', checkpoint: 'initialized' }

    const inspection = await activities.inspectFixtureResearch(input)
    await activities.recordFixtureResearchCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:inspected',
      sequenceNo: 200,
      checkpoint: 'inspected',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: transitionTime()
    })
    status = { ...status, checkpoint: 'inspected' }

    const budgetFailure: WorkflowFailureCode | null =
      inspection.sourceItemCount > input.budget.maxSourceItems
        ? 'source_item_budget_exceeded'
        : inspection.estimatedCostMicros > input.budget.maxCostMicros
          ? 'cost_budget_exceeded'
          : null
    if (budgetFailure) {
      const failureSummary = fixedFailureSummaries[budgetFailure]
      const result: FixtureResearchWorkflowResult = {
        state: 'budget_rejected',
        workflowId: execution.workflowId,
        temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
        failureCode: budgetFailure,
        failureSummary,
        sourceItemsInspected: inspection.sourceItemCount,
        estimatedCostMicros: inspection.estimatedCostMicros
      }
      await CancellationScope.nonCancellable(() =>
        cleanupActivities.terminateFixtureResearchJob({
          execution,
          input,
          state: 'budget_rejected',
          checkpoint: 'budget_rejected',
          failureCode: budgetFailure,
          failureSummary,
          consumedSourceItems: 0,
          consumedCostMicros: 0,
          occurredAt: transitionTime()
        })
      )
      status = {
        ...status,
        state: 'budget_rejected',
        checkpoint: 'budget_rejected',
        result
      }
      return result
    }

    await activities.recordFixtureResearchCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:budget-approved',
      sequenceNo: 300,
      checkpoint: 'budget_approved',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: transitionTime()
    })
    status = { ...status, checkpoint: 'budget_approved' }

    const persisted = await CancellationScope.nonCancellable(async () => {
      status = { ...status, checkpoint: 'persisting' }
      const activityResult = await activities.persistFixtureResearch({
        execution,
        input,
        occurredAt: transitionTime()
      })
      status = {
        ...status,
        checkpoint: 'persisted',
        activityAttempts: activityResult.activityAttempt,
        consumedSourceItems: activityResult.sourceItemsProcessed,
        consumedCostMicros: activityResult.costMicros
      }
      await cleanupActivities.completeFixtureResearchJob({
        execution,
        workspaceId: input.workspaceId,
        result: activityResult,
        occurredAt: transitionTime()
      })
      return activityResult
    })

    const result: FixtureResearchWorkflowResult = {
      state: 'completed',
      workflowId: execution.workflowId,
      temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
      persistence: persisted.persistence,
      sourceItemsProcessed: persisted.sourceItemsProcessed,
      costMicros: persisted.costMicros,
      activityAttempts: persisted.activityAttempt
    }
    status = { ...status, state: 'completed', checkpoint: 'completed', result }
    return result
  } catch (error) {
    const canceled = isCancellation(error)
    const state = canceled ? 'canceled' : 'failed'
    const failureCode: WorkflowFailureCode = canceled ? 'workflow_canceled' : 'activity_failed'
    const terminal = await CancellationScope.nonCancellable(() =>
      cleanupActivities.terminateFixtureResearchJob({
        execution,
        input,
        state,
        checkpoint: state,
        failureCode,
        failureSummary: fixedFailureSummaries[failureCode],
        consumedSourceItems: status.consumedSourceItems,
        consumedCostMicros: status.consumedCostMicros,
        occurredAt: transitionTime()
      })
    )
    if (terminal.reconciled) {
      const reconciled = terminal.reconciled
      const result: FixtureResearchWorkflowResult = {
        state: 'completed',
        workflowId: execution.workflowId,
        temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
        persistence: reconciled.persistence,
        sourceItemsProcessed: reconciled.sourceItemsProcessed,
        costMicros: reconciled.costMicros,
        activityAttempts: reconciled.activityAttempt
      }
      status = {
        ...status,
        state: 'completed',
        checkpoint: 'completed',
        activityAttempts: reconciled.activityAttempt,
        consumedSourceItems: reconciled.sourceItemsProcessed,
        consumedCostMicros: reconciled.costMicros,
        result
      }
      return result
    }
    status = { ...status, state, checkpoint: state }
    throw error
  }
}

const productionFailureSummaries: Record<WorkflowFailureCode, string> = {
  source_item_budget_exceeded:
    'Production collection limit exceeds the approved source-item workflow budget.',
  cost_budget_exceeded: 'Production collection cost estimate exceeds the approved workflow budget.',
  activity_failed: 'The production collection activity exhausted its bounded retry policy.',
  workflow_canceled: 'Production collection was canceled before its persistence commit boundary.'
}

function productionCollectionExecutionMetadata(): ProductionCollectionWorkflowExecutionMetadata {
  const info = workflowInfo()
  if (info.workflowType !== 'productionCollectionWorkflow') {
    throw ApplicationFailure.nonRetryable(
      'Unexpected production collection workflow type.',
      'APPSEA_WORKFLOW_TYPE_INVALID'
    )
  }
  if (info.taskQueue !== fixtureResearchTaskQueue) {
    throw ApplicationFailure.nonRetryable(
      'Unexpected production collection workflow task queue.',
      'APPSEA_WORKFLOW_TASK_QUEUE_INVALID'
    )
  }
  return {
    workflowId: info.workflowId,
    temporalFirstExecutionRunId: info.firstExecutionRunId,
    workflowType: 'productionCollectionWorkflow',
    workflowVersion: productionCollectionWorkflowVersion,
    taskQueue: info.taskQueue
  }
}

function sanitizeProductionCollectionInput(
  input: ProductionCollectionWorkflowInput
): ProductionCollectionWorkflowInput {
  const candidate = input as unknown as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  const allowed = [
    'analysisSeedReviewId',
    'budget',
    'campaignId',
    'idempotencyDigest',
    'inputHash',
    'limit',
    'policyVersion',
    'purpose',
    'query',
    'requestedAt',
    'requestedBy',
    'requestedDisplayMode',
    'runId',
    'sourceId',
    'workflowVersion',
    'workspaceId'
  ]
  const requiredAllowed = allowed.filter(
    (key) => key !== 'requestedBy' && key !== 'analysisSeedReviewId'
  )
  const hasAllowedKeys =
    keys.length === allowed.length && keys.every((key, index) => key === allowed[index])
  const hasRequiredKeys =
    keys.length === requiredAllowed.length &&
    keys.every((key, index) => key === requiredAllowed[index])
  if (!hasAllowedKeys && !hasRequiredKeys) {
    throw ApplicationFailure.nonRetryable(
      'Production collection workflow input contains unsupported fields.',
      'APPSEA_INPUT_INVALID'
    )
  }
  const parsed = productionCollectionWorkflowInputSchema.safeParse(input)
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      'Production collection workflow input is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  return parsed.data
}

export async function productionCollectionWorkflow(
  rawInput: ProductionCollectionWorkflowInput
): Promise<ProductionCollectionWorkflowResult> {
  const input = sanitizeProductionCollectionInput(rawInput)
  const execution = productionCollectionExecutionMetadata()
  if (input.workflowVersion !== execution.workflowVersion) {
    throw ApplicationFailure.nonRetryable(
      'Unsupported production collection workflow version.',
      'APPSEA_WORKFLOW_VERSION_INVALID'
    )
  }

  const activities = proxyActivities<ProductionCollectionActivities>({
    // CFPB fetches are bounded to 30 seconds, while persistence can safely
    // take several minutes for a 5,000-item batch. No heartbeat timeout is
    // configured until the activity emits real progress heartbeats.
    startToCloseTimeout: '15 minutes',
    scheduleToCloseTimeout: '30 minutes',
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
      backoffCoefficient: 2,
      maximumAttempts: input.budget.maxActivityAttempts,
      nonRetryableErrorTypes: [
        'APPSEA_INPUT_INVALID',
        'APPSEA_IDEMPOTENCY_CONFLICT',
        'APPSEA_IMMUTABLE_CONFLICT',
        'APPSEA_POLICY_DENIED'
      ]
    }
  })
  const cleanupActivities = proxyActivities<ProductionCollectionActivities>({
    startToCloseTimeout: '30 seconds',
    scheduleToCloseTimeout: '3 minutes',
    retry: {
      initialInterval: '1 second',
      maximumInterval: '15 seconds',
      backoffCoefficient: 2,
      maximumAttempts: 5,
      nonRetryableErrorTypes: [
        'APPSEA_INPUT_INVALID',
        'APPSEA_IDEMPOTENCY_CONFLICT',
        'APPSEA_IMMUTABLE_CONFLICT',
        'APPSEA_POLICY_DENIED'
      ]
    }
  })

  let lastTransitionTime = Date.parse(input.requestedAt)
  const transitionTime = (): string => {
    lastTransitionTime = Math.max(lastTransitionTime, Date.now())
    return new Date(lastTransitionTime).toISOString()
  }
  let status: ProductionCollectionWorkflowStatus = {
    workflowId: execution.workflowId,
    temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
    inputHash: input.inputHash,
    state: 'queued',
    checkpoint: 'accepted',
    activityAttempts: 0,
    consumedSourceItems: 0,
    consumedCostMicros: 0,
    analysisSeedReviewId: input.analysisSeedReviewId ?? null,
    result: null
  }
  setHandler(productionCollectionStatusQuery, () => status)
  let initialized = false

  try {
    await activities.initializeProductionCollectionJob({
      execution,
      input,
      occurredAt: transitionTime()
    })
    initialized = true
    status = { ...status, state: 'running', checkpoint: 'initialized' }

    if (input.limit > input.budget.maxSourceItems) {
      const failureCode: WorkflowFailureCode = 'source_item_budget_exceeded'
      const failureSummary = productionFailureSummaries[failureCode]
      const result = {
        state: 'budget_rejected' as const,
        workflowId: execution.workflowId,
        temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
        failureCode,
        failureSummary,
        sourceItemsInspected: input.limit,
        estimatedCostMicros: 0
      }
      await CancellationScope.nonCancellable(() =>
        cleanupActivities.terminateProductionCollectionJob({
          execution,
          input,
          state: 'budget_rejected',
          checkpoint: 'budget_rejected',
          failureCode,
          failureSummary,
          consumedSourceItems: 0,
          consumedCostMicros: 0,
          occurredAt: transitionTime()
        })
      )
      status = { ...status, state: 'budget_rejected', checkpoint: 'budget_rejected', result }
      return result
    }

    await activities.recordProductionCollectionCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:budget-approved',
      sequenceNo: 300,
      checkpoint: 'budget_approved',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: transitionTime()
    })
    status = { ...status, checkpoint: 'budget_approved' }

    const persisted = await CancellationScope.nonCancellable(async () => {
      status = { ...status, checkpoint: 'persisting' }
      const activityResult = await activities.persistProductionCollection({
        execution,
        input,
        occurredAt: transitionTime()
      })
      status = {
        ...status,
        checkpoint: 'persisted',
        activityAttempts: activityResult.activityAttempt,
        consumedSourceItems: activityResult.sourceItemsProcessed,
        consumedCostMicros: activityResult.costMicros
      }
      await cleanupActivities.completeProductionCollectionJob({
        execution,
        workspaceId: input.workspaceId,
        result: activityResult,
        occurredAt: transitionTime()
      })
      return activityResult
    })

    const result: ProductionCollectionWorkflowResult = {
      state: 'completed',
      workflowId: execution.workflowId,
      temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
      persistence: persisted.persistence,
      sourceItemsProcessed: persisted.sourceItemsProcessed,
      costMicros: persisted.costMicros,
      activityAttempts: persisted.activityAttempt
    }
    status = { ...status, state: 'completed', checkpoint: 'completed', result }
    return result
  } catch (error) {
    const canceled = isCancellation(error)
    const state = canceled ? 'canceled' : 'failed'
    const failureCode: WorkflowFailureCode = canceled ? 'workflow_canceled' : 'activity_failed'
    const terminal = initialized
      ? await CancellationScope.nonCancellable(() =>
          cleanupActivities.terminateProductionCollectionJob({
            execution,
            input,
            state,
            checkpoint: state,
            failureCode,
            failureSummary:
              state === 'failed'
                ? productionFailureSummary(error)
                : productionFailureSummaries[failureCode],
            consumedSourceItems: status.consumedSourceItems,
            consumedCostMicros: status.consumedCostMicros,
            occurredAt: transitionTime()
          })
        )
      : null
    if (terminal?.reconciled) {
      const reconciled = terminal.reconciled
      const result: ProductionCollectionWorkflowResult = {
        state: 'completed',
        workflowId: execution.workflowId,
        temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
        persistence: reconciled.persistence,
        sourceItemsProcessed: reconciled.sourceItemsProcessed,
        costMicros: reconciled.costMicros,
        activityAttempts: reconciled.activityAttempt
      }
      status = {
        ...status,
        state: 'completed',
        checkpoint: 'completed',
        activityAttempts: reconciled.activityAttempt,
        consumedSourceItems: reconciled.sourceItemsProcessed,
        consumedCostMicros: reconciled.costMicros,
        result
      }
      return result
    }
    status = { ...status, state, checkpoint: state }
    throw error
  }
}

function productionAnalysisExecutionMetadata(): ProductionAnalysisWorkflowExecutionMetadata {
  const info = workflowInfo()
  if (info.workflowType !== 'productionAnalysisWorkflow') {
    throw ApplicationFailure.nonRetryable(
      'Unexpected production analysis workflow type.',
      'APPSEA_WORKFLOW_TYPE_INVALID'
    )
  }
  if (info.taskQueue !== fixtureResearchTaskQueue) {
    throw ApplicationFailure.nonRetryable(
      'Unexpected production analysis workflow task queue.',
      'APPSEA_WORKFLOW_TASK_QUEUE_INVALID'
    )
  }
  return {
    workflowId: info.workflowId,
    temporalFirstExecutionRunId: info.firstExecutionRunId,
    workflowType: 'productionAnalysisWorkflow',
    workflowVersion: productionAnalysisWorkflowVersion,
    taskQueue: info.taskQueue
  }
}

function productionAnalysisFailureCode(
  error: unknown
): Extract<ProductionAnalysisWorkflowResult, { state: 'failed' }>['failureCode'] {
  switch (applicationFailureType(error)) {
    case 'APPSEA_INPUT_INVALID':
      return 'analysis_input_invalid'
    case 'APPSEA_POLICY_DENIED':
      return 'analysis_policy_denied'
    case 'APPSEA_RECONCILIATION_REQUIRED':
      return 'analysis_reconciliation_required'
    case 'APPSEA_BUDGET_EXCEEDED':
      return 'analysis_budget_exceeded'
    default:
      return 'analysis_activity_failed'
  }
}

function productionAnalysisFailureSummary(
  code: Extract<ProductionAnalysisWorkflowResult, { state: 'failed' }>['failureCode']
): string {
  switch (code) {
    case 'analysis_input_invalid':
      return 'Production analysis input is invalid.'
    case 'analysis_policy_denied':
      return 'The production analysis policy lineage check rejected the request.'
    case 'analysis_budget_exceeded':
      return 'Production analysis exceeded its approved budget.'
    case 'analysis_reconciliation_required':
      return 'Production analysis requires operator reconciliation before retry.'
    default:
      return 'The production analysis activity exhausted its bounded retry policy.'
  }
}

export async function productionAnalysisWorkflow(
  rawInput: ProductionAnalysisWorkflowInput
): Promise<ProductionAnalysisWorkflowResult> {
  const parsed = productionAnalysisWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      'Production analysis workflow input is invalid.',
      'APPSEA_INPUT_INVALID'
    )
  }
  const input = parsed.data
  const execution = productionAnalysisExecutionMetadata()
  if (input.workflowVersion !== execution.workflowVersion) {
    throw ApplicationFailure.nonRetryable(
      'Unsupported production analysis workflow version.',
      'APPSEA_WORKFLOW_VERSION_INVALID'
    )
  }

  const activities = proxyActivities<ProductionAnalysisActivities>({
    startToCloseTimeout: '15 minutes',
    scheduleToCloseTimeout: '30 minutes',
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
      backoffCoefficient: 2,
      maximumAttempts: 5,
      nonRetryableErrorTypes: [
        'APPSEA_INPUT_INVALID',
        'APPSEA_POLICY_DENIED',
        'APPSEA_IDEMPOTENCY_CONFLICT',
        'APPSEA_IMMUTABLE_CONFLICT',
        'APPSEA_RECONCILIATION_REQUIRED'
      ]
    }
  })

  // The request timestamp is idempotency metadata, not an evidence or
  // retention clock. Use Temporal's deterministic server time so a caller
  // cannot move analysis artifacts into the future by supplying requestedAt.
  const occurredAt = (): string => new Date(Date.now()).toISOString()
  let status: ProductionAnalysisWorkflowStatus = {
    workflowId: execution.workflowId,
    temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
    inputHash: input.inputHash,
    state: 'queued',
    checkpoint: 'accepted',
    activityAttempts: 0,
    result: null
  }
  setHandler(productionAnalysisStatusQuery, () => status)

  try {
    status = { ...status, state: 'running', checkpoint: 'persisting' }
    const persistence: ProductionAnalysisResult = await activities.persistProductionAnalysis({
      execution,
      input,
      occurredAt: occurredAt()
    })
    const result: ProductionAnalysisWorkflowResult = {
      state: 'completed',
      workflowId: execution.workflowId,
      temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
      persistence,
      activityAttempts: 1
    }
    status = { ...status, state: 'completed', checkpoint: 'completed', activityAttempts: 1, result }
    return result
  } catch (error) {
    const failureCode = productionAnalysisFailureCode(error)
    const result: ProductionAnalysisWorkflowResult = {
      state: 'failed',
      workflowId: execution.workflowId,
      temporalFirstExecutionRunId: execution.temporalFirstExecutionRunId,
      failureCode,
      failureSummary: productionAnalysisFailureSummary(failureCode)
    }
    status = { ...status, state: 'failed', checkpoint: 'failed', result }
    return result
  }
}
