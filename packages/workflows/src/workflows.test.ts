import { fileURLToPath } from 'node:url'
import { ApplicationFailure } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  FixtureResearchPersistenceActivityResult,
  ProductionCollectionWorkflowPersistenceActivityResult
} from '@appsea/contracts'
import type {
  FixtureResearchActivities,
  ProductionCollectionActivities,
  TerminateFixtureResearchActivityResult
} from './activity-contracts'
import {
  prepareFixtureResearchWorkflowStart,
  prepareProductionCollectionWorkflowStart,
  startFixtureResearchWorkflow
} from './client'
import {
  fixtureResearchStatusQueryName,
  fixtureResearchTaskQueue,
  productionCollectionStatusQueryName
} from './constants'

const workflowsPath = fileURLToPath(new URL('./workflows.ts', import.meta.url))
const baseRequest = {
  workspaceId: 'workspace-workflow-test',
  campaignId: 'campaign-workflow-test',
  runId: 'run-workflow-test',
  idempotencyKey: 'workflow-test-idempotency-key',
  workflowVersion: 'fixture-research-v1' as const,
  fixtureAt: '2026-07-10T00:00:00.000Z',
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  }
}

const persistenceResult: FixtureResearchPersistenceActivityResult = {
  persistence: {
    workspaceId: baseRequest.workspaceId,
    campaignId: baseRequest.campaignId,
    runId: baseRequest.runId,
    artifactId: 'artifact-workflow-test',
    opportunityId: 'opportunity-workflow-test',
    scoreSnapshotId: 'score-workflow-test',
    planPackageId: 'plan-workflow-test',
    sourceItemCount: 4,
    evidenceCount: 4,
    complaintCount: 4,
    clusterCount: 3,
    competitorCount: 3,
    state: 'completed',
    completedAt: '2026-07-10T00:00:00.000Z',
    replayed: false
  },
  sourceItemsProcessed: 4,
  costMicros: 0,
  activityAttempt: 1
}

const productionRequest = {
  workspaceId: 'workspace-production-workflow-test',
  campaignId: 'campaign-production-workflow-test',
  runId: 'run-production-workflow-test',
  idempotencyKey: 'production-workflow-test-idempotency-key',
  workflowVersion: 'production-collection-v1' as const,
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-v1',
  query: 'billing',
  limit: 4,
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt' as const,
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  requestedAt: '2026-07-10T00:00:00.000Z'
}

const productionPersistenceResult: ProductionCollectionWorkflowPersistenceActivityResult = {
  persistence: {
    workspaceId: productionRequest.workspaceId,
    campaignId: productionRequest.campaignId,
    runId: productionRequest.runId,
    artifactId: 'production-collection-artifact',
    sourceId: productionRequest.sourceId,
    policyVersion: productionRequest.policyVersion,
    sourceItemCount: 4,
    evidenceCount: 4,
    complaintCount: 4,
    deletionCount: 0,
    coverageGaps: ['Not a statistical sample.'],
    warnings: [],
    state: 'completed',
    completedAt: '2026-07-10T00:00:00.000Z',
    replayed: false
  },
  sourceItemsProcessed: 4,
  costMicros: 0,
  activityAttempt: 1
}

function baseActivities(): FixtureResearchActivities {
  return {
    initializeFixtureResearchJob: async () => ({ state: 'running' }),
    inspectFixtureResearch: async () => ({ sourceItemCount: 4, estimatedCostMicros: 0 }),
    recordFixtureResearchCheckpoint: async () => ({ state: 'running' }),
    persistFixtureResearch: async () => persistenceResult,
    completeFixtureResearchJob: async () => ({ state: 'completed' }),
    terminateFixtureResearchJob: async (
      input
    ): Promise<TerminateFixtureResearchActivityResult> => ({
      state: input.state,
      reconciled: null
    })
  }
}

function baseProductionActivities(): ProductionCollectionActivities {
  return {
    initializeProductionCollectionJob: async () => ({ state: 'running' }),
    recordProductionCollectionCheckpoint: async () => ({ state: 'running' }),
    persistProductionCollection: async () => productionPersistenceResult,
    completeProductionCollectionJob: async () => ({ state: 'completed' }),
    terminateProductionCollectionJob: async (input) => ({
      state: input.state,
      reconciled: null
    })
  }
}

describe.sequential('fixture research Temporal workflow', () => {
  let testEnvironment: TestWorkflowEnvironment
  let queueCounter = 0

  beforeAll(async () => {
    testEnvironment = await TestWorkflowEnvironment.createTimeSkipping()
  }, 60_000)

  afterAll(async () => {
    await testEnvironment?.teardown()
  })

  async function execute(
    activities: FixtureResearchActivities,
    request = baseRequest,
    interact?: (
      handle: ReturnType<typeof testEnvironment.client.workflow.getHandle>
    ) => Promise<void>
  ) {
    queueCounter += 1
    const taskQueue = fixtureResearchTaskQueue
    const prepared = prepareFixtureResearchWorkflowStart(request)
    const workflowId = `${prepared.workflowId}:case:${queueCounter}`
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue,
      workflowsPath,
      activities
    })
    return worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('fixtureResearchWorkflow', {
        taskQueue,
        workflowId,
        args: [prepared.input]
      })
      if (interact) await interact(handle)
      const result = await handle.result()
      const status = await handle.query(fixtureResearchStatusQueryName)
      return { handle, result, status }
    })
  }

  it('completes and exposes a queryable terminal status', async () => {
    const { result, status } = await execute(baseActivities())

    expect(result).toMatchObject({ state: 'completed', sourceItemsProcessed: 4 })
    expect(status).toMatchObject({ state: 'completed', checkpoint: 'completed' })
  })

  it('rejects an over-budget estimate without persisting', async () => {
    let persistenceCalls = 0
    let terminalState = ''
    const activities = baseActivities()
    activities.inspectFixtureResearch = async () => ({
      sourceItemCount: 11,
      estimatedCostMicros: 0
    })
    activities.persistFixtureResearch = async () => {
      persistenceCalls += 1
      return persistenceResult
    }
    activities.terminateFixtureResearchJob = async (input) => {
      terminalState = input.state
      return { state: input.state, reconciled: null }
    }

    const { result } = await execute(activities)

    expect(result).toMatchObject({
      state: 'budget_rejected',
      failureCode: 'source_item_budget_exceeded'
    })
    expect(persistenceCalls).toBe(0)
    expect(terminalState).toBe('budget_rejected')
  })

  it('rejects unsupported direct workflow fields before scheduling activities', async () => {
    let initializeCalls = 0
    const activities = baseActivities()
    activities.initializeFixtureResearchJob = async () => {
      initializeCalls += 1
      return { state: 'running' }
    }
    const prepared = prepareFixtureResearchWorkflowStart(baseRequest)
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities
    })
    await worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('fixtureResearchWorkflow', {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: `${prepared.workflowId}:unsupported-field`,
        args: [{ ...prepared.input, leakedSecret: 'must-not-reach-activity' }]
      })
      await expect(handle.result()).rejects.toThrow()
    })
    expect(initializeCalls).toBe(0)
  })

  it('rejects malformed direct workflow actors before scheduling activities', async () => {
    let initializeCalls = 0
    const activities = baseActivities()
    activities.initializeFixtureResearchJob = async () => {
      initializeCalls += 1
      return { state: 'running' }
    }
    const prepared = prepareFixtureResearchWorkflowStart(baseRequest)
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities
    })
    await worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('fixtureResearchWorkflow', {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: `${prepared.workflowId}:malformed-actor`,
        args: [
          {
            ...prepared.input,
            requestedBy: { actorType: 'service', actorId: 'not-the-worker' }
          }
        ]
      })
      await expect(handle.result()).rejects.toThrow()
    })
    expect(initializeCalls).toBe(0)
  })

  it('retries a transient persistence failure to the configured bound', async () => {
    let attempts = 0
    const activities = baseActivities()
    activities.persistFixtureResearch = async () => {
      attempts += 1
      if (attempts < 3) {
        throw ApplicationFailure.create({
          message: 'sanitized transient failure',
          type: 'APPSEA_ACTIVITY_FAILED',
          nonRetryable: false
        })
      }
      return { ...persistenceResult, activityAttempt: attempts }
    }

    const { result } = await execute(activities)

    expect(result).toMatchObject({ state: 'completed', activityAttempts: 3 })
    expect(attempts).toBe(3)
  })

  it('does not retry a declared non-retryable activity failure', async () => {
    let attempts = 0
    let terminalState = ''
    const activities = baseActivities()
    activities.persistFixtureResearch = async () => {
      attempts += 1
      throw ApplicationFailure.nonRetryable('invalid input', 'APPSEA_INPUT_INVALID')
    }
    activities.terminateFixtureResearchJob = async (input) => {
      terminalState = input.state
      return { state: input.state, reconciled: null }
    }

    await expect(execute(activities)).rejects.toThrow()
    expect(attempts).toBe(1)
    expect(terminalState).toBe('failed')
  })

  it('records cancellation before the persistence safe point', async () => {
    let inspectionStarted!: () => void
    const started = new Promise<void>((resolve) => {
      inspectionStarted = resolve
    })
    let terminalState = ''
    const activities = baseActivities()
    activities.inspectFixtureResearch = async () => {
      inspectionStarted()
      for (;;) {
        Context.current().heartbeat()
        await Context.current().sleep(25)
      }
    }
    activities.terminateFixtureResearchJob = async (input) => {
      terminalState = input.state
      return { state: input.state, reconciled: null }
    }

    await expect(
      execute(activities, baseRequest, async (handle) => {
        await started
        await handle.cancel()
      })
    ).rejects.toThrow()
    expect(terminalState).toBe('canceled')
  })

  it('lets a committed persistence safe point win over late cancellation', async () => {
    let persistenceStarted!: () => void
    let releasePersistence!: () => void
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const activities = baseActivities()
    activities.persistFixtureResearch = async () => {
      persistenceStarted()
      await release
      return persistenceResult
    }

    const { result } = await execute(activities, baseRequest, async (handle) => {
      await started
      await handle.cancel()
      releasePersistence()
    })

    expect(result.state).toBe('completed')
  })

  it('coalesces duplicate starts and rejects conflicting reuse', async () => {
    let persistenceCalls = 0
    const activities = baseActivities()
    activities.persistFixtureResearch = async () => {
      persistenceCalls += 1
      return {
        ...persistenceResult,
        persistence: {
          ...persistenceResult.persistence,
          workspaceId: 'workspace-client-idempotency',
          campaignId: 'campaign-client-idempotency',
          runId: 'run-client-idempotency'
        }
      }
    }
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities
    })
    const request = {
      ...baseRequest,
      workspaceId: 'workspace-client-idempotency',
      campaignId: 'campaign-client-idempotency',
      runId: 'run-client-idempotency',
      idempotencyKey: 'client-idempotency-concurrent-key'
    }
    await worker.runUntil(async () => {
      const [first, duplicate] = await Promise.all([
        startFixtureResearchWorkflow(testEnvironment.client.workflow, request),
        startFixtureResearchWorkflow(testEnvironment.client.workflow, request)
      ])
      expect(duplicate.workflowId).toBe(first.workflowId)
      await first.result()
      const completedReplay = await startFixtureResearchWorkflow(
        testEnvironment.client.workflow,
        request
      )
      expect((await completedReplay.result()).state).toBe('completed')
      await expect(
        startFixtureResearchWorkflow(testEnvironment.client.workflow, {
          ...request,
          budget: { ...request.budget, maxSourceItems: 9 }
        })
      ).rejects.toThrow(/conflicts with different input/)
    })
    expect(persistenceCalls).toBe(1)
  })
})

describe.sequential('production collection Temporal workflow', () => {
  let testEnvironment: TestWorkflowEnvironment
  let queueCounter = 0

  beforeAll(async () => {
    testEnvironment = await TestWorkflowEnvironment.createTimeSkipping()
  }, 60_000)

  afterAll(async () => {
    await testEnvironment?.teardown()
  })

  it('keeps the caller idempotency key out of workflow history and completes', async () => {
    const prepared = prepareProductionCollectionWorkflowStart(productionRequest)
    expect(JSON.stringify(prepared.input)).not.toContain(productionRequest.idempotencyKey)
    queueCounter += 1
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities: baseProductionActivities()
    })
    await worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('productionCollectionWorkflow', {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: `${prepared.workflowId}:case:${queueCounter}`,
        args: [prepared.input]
      })
      const result = await handle.result()
      const status = await handle.query(productionCollectionStatusQueryName)
      expect(result).toMatchObject({ state: 'completed', sourceItemsProcessed: 4 })
      expect(status).toMatchObject({ state: 'completed', checkpoint: 'completed' })
    })
  })

  it('rejects a production collection over its source-item budget before persistence', async () => {
    let persistenceCalls = 0
    const activities = baseProductionActivities()
    activities.persistProductionCollection = async () => {
      persistenceCalls += 1
      return productionPersistenceResult
    }
    activities.terminateProductionCollectionJob = async (input) => ({
      state: input.state,
      reconciled: null
    })
    const prepared = prepareProductionCollectionWorkflowStart({
      ...productionRequest,
      workspaceId: 'workspace-production-budget-test',
      campaignId: 'campaign-production-budget-test',
      runId: 'run-production-budget-test',
      idempotencyKey: 'production-budget-idempotency-key',
      limit: 11,
      budget: { ...productionRequest.budget, maxSourceItems: 10 }
    })
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities
    })
    await worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('productionCollectionWorkflow', {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: `${prepared.workflowId}:budget`,
        args: [prepared.input]
      })
      await expect(handle.result()).resolves.toMatchObject({
        state: 'budget_rejected',
        failureCode: 'source_item_budget_exceeded'
      })
    })
    expect(persistenceCalls).toBe(0)
  })

  it('records operator reconciliation detail when quota settlement has no result', async () => {
    let termination:
      Parameters<ProductionCollectionActivities['terminateProductionCollectionJob']>[0] | undefined
    const activities = baseProductionActivities()
    activities.persistProductionCollection = async () => {
      throw ApplicationFailure.nonRetryable(
        'operator reconciliation required',
        'APPSEA_RECONCILIATION_REQUIRED'
      )
    }
    activities.terminateProductionCollectionJob = async (input) => {
      termination = input
      return { state: input.state, reconciled: null }
    }
    const prepared = prepareProductionCollectionWorkflowStart({
      ...productionRequest,
      workspaceId: 'workspace-production-reconciliation-test',
      campaignId: 'campaign-production-reconciliation-test',
      runId: 'run-production-reconciliation-test',
      idempotencyKey: 'production-reconciliation-idempotency-key',
      budget: { ...productionRequest.budget, maxActivityAttempts: 1 }
    })
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: fixtureResearchTaskQueue,
      workflowsPath,
      activities
    })
    await worker.runUntil(async () => {
      const handle = await testEnvironment.client.workflow.start('productionCollectionWorkflow', {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: `${prepared.workflowId}:reconciliation`,
        args: [prepared.input]
      })
      await expect(handle.result()).rejects.toThrow()
    })
    expect(termination?.failureCode).toBe('activity_failed')
    expect(termination?.failureSummary).toMatch(/operator reconciliation/i)
  })
})
