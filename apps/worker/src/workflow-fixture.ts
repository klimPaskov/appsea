import { fileURLToPath } from 'node:url'
import { Connection, WorkflowClient } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import { fixtureResearchTaskQueue, startFixtureResearchWorkflow } from '@appsea/workflows'
import { localTemporalAddressFromEnv } from './temporal-local'
import { createFixtureResearchActivities } from './workflow-activities'
import { emitWorkerEvent } from './observability'

const address = localTemporalAddressFromEnv()
const externalWorker = process.env.APPSEA_WORKFLOW_FIXTURE_EXTERNAL_WORKER === 'true'
const idSuffix = process.env.APPSEA_WORKFLOW_FIXTURE_ID_SUFFIX?.trim() || 'local'
if (!/^[a-z0-9-]{1,48}$/.test(idSuffix)) {
  throw new Error('Fixture workflow id suffix is invalid')
}
const workspaceId = `workspace-fixture-workflow-${idSuffix}`
const campaignId = `campaign-fixture-workflow-${idSuffix}`
const runId = `run-fixture-workflow-${idSuffix}`
const idempotencyKey = `fixture-workflow-${idSuffix}-v1`
const pool = createDatabasePool(databaseConfigFromEnv())
const clientConnection = await Connection.connect({ address })
const workerConnection = externalWorker ? undefined : await NativeConnection.connect({ address })

try {
  const worker = workerConnection
    ? await Worker.create({
        connection: workerConnection,
        taskQueue: fixtureResearchTaskQueue,
        workflowsPath: fileURLToPath(import.meta.resolve('@appsea/workflows/workflows')),
        activities: createFixtureResearchActivities(pool),
        maxConcurrentActivityTaskExecutions: 4,
        maxConcurrentWorkflowTaskExecutions: 8
      })
    : undefined
  const client = new WorkflowClient({ connection: clientConnection })
  const runWorkflow = async (): Promise<string> => {
    const handle = await startFixtureResearchWorkflow(client, {
      workspaceId,
      campaignId,
      runId,
      idempotencyKey,
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
        return JSON.stringify({
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
      }
      return JSON.stringify({
        state: result.state,
        workflowId: result.workflowId,
        temporalFirstExecutionRunId: result.temporalFirstExecutionRunId,
        failureCode: result.failureCode
      })
    } catch {
      emitWorkerEvent({
        event: 'workflow_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_WORKFLOW_FAILED'
      })
      throw new Error('Durable fixture workflow failed; inspect structured worker events')
    }
  }
  const completedOutput = worker ? await worker.runUntil(runWorkflow) : await runWorkflow()
  console.log(`durable fixture workflow output=${completedOutput}`)
} finally {
  await Promise.all([
    pool.end(),
    clientConnection.close(),
    workerConnection?.close() ?? Promise.resolve()
  ])
}
