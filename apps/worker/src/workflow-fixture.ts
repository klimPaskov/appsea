import { fileURLToPath } from 'node:url'
import { Connection, WorkflowClient } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import { fixtureResearchTaskQueue, startFixtureResearchWorkflow } from '@appsea/workflows'
import { localTemporalAddressFromEnv } from './temporal-local'
import { createFixtureResearchActivities } from './workflow-activities'
import { emitWorkerEvent } from './observability'

const address = localTemporalAddressFromEnv()
const pool = createDatabasePool(databaseConfigFromEnv())
const [clientConnection, workerConnection] = await Promise.all([
  Connection.connect({ address }),
  NativeConnection.connect({ address })
])

try {
  const worker = await Worker.create({
    connection: workerConnection,
    taskQueue: fixtureResearchTaskQueue,
    workflowsPath: fileURLToPath(import.meta.resolve('@appsea/workflows/workflows')),
    activities: createFixtureResearchActivities(pool),
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 8
  })
  const client = new WorkflowClient({ connection: clientConnection })
  let completedOutput = ''
  await worker.runUntil(async () => {
    const handle = await startFixtureResearchWorkflow(client, {
      workspaceId: 'workspace-fixture-workflow-local',
      campaignId: 'campaign-fixture-workflow-local',
      runId: 'run-fixture-workflow-local',
      idempotencyKey: 'fixture-workflow-local-v1',
      workflowVersion: 'fixture-research-v1',
      fixtureAt: '2026-07-10T00:00:00.000Z',
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      }
    })
    try {
      const result = await handle.result()
      if (result.state === 'completed') {
        completedOutput = JSON.stringify({
          state: result.state,
          workflowId: result.workflowId,
          temporalFirstExecutionRunId: result.temporalFirstExecutionRunId,
          researchRunId: result.persistence.runId,
          artifactId: result.persistence.artifactId,
          opportunityId: result.persistence.opportunityId,
          scoreSnapshotId: result.persistence.scoreSnapshotId,
          planPackageId: result.persistence.planPackageId,
          outputLocator: `postgresql://appsea/workspace/${result.persistence.workspaceId}/run/${result.persistence.runId}`
        })
      } else {
        completedOutput = JSON.stringify({
          state: result.state,
          workflowId: result.workflowId,
          temporalFirstExecutionRunId: result.temporalFirstExecutionRunId,
          failureCode: result.failureCode
        })
      }
    } catch {
      emitWorkerEvent({
        event: 'workflow_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_WORKFLOW_FAILED'
      })
      throw new Error('Durable fixture workflow failed; inspect structured worker events')
    }
  })
  console.log(`durable fixture workflow output=${completedOutput}`)
} finally {
  await Promise.all([pool.end(), clientConnection.close(), workerConnection.close()])
}
