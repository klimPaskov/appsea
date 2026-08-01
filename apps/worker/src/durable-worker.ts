import { fileURLToPath } from 'node:url'
import { Connection, WorkflowClient } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import { objectStoreFromEnv } from '@appsea/object-store'
import { fixtureResearchTaskQueue } from '@appsea/workflows'
import { localTemporalAddressFromEnv } from './temporal-local'
import { createFixtureResearchActivities } from './workflow-activities'
import { createProductionCollectionActivities } from './production-workflow-activities'
import { createProductionAnalysisActivities } from './production-analysis-activities'
import { createProductionAnalysisHandoffDispatcher } from './production-analysis-handoff'
import { createProductionAnalysisRecomputeDispatcher } from './production-analysis-recompute'
import { emitWorkerEvent, startWorkerHeartbeat } from './observability'

const pool = createDatabasePool(databaseConfigFromEnv())
const objectStore = objectStoreFromEnv(process.env)
const temporalAddress = localTemporalAddressFromEnv()
const workerConnection = await NativeConnection.connect({ address: temporalAddress })
const clientConnection = await Connection.connect({ address: temporalAddress })
const workflowClient = new WorkflowClient({
  connection: clientConnection,
  namespace: process.env.APPSEA_TEMPORAL_NAMESPACE?.trim() || 'default'
})
const handoffDispatcher = createProductionAnalysisHandoffDispatcher(pool, workflowClient)
const recomputeDispatcher = createProductionAnalysisRecomputeDispatcher(pool, workflowClient)

let stopping = false
let stopHeartbeat = (): void => undefined
const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))
const handoffLoop = (async (): Promise<void> => {
  while (!stopping) {
    try {
      await handoffDispatcher.dispatchBatch()
    } catch {
      emitWorkerEvent({
        event: 'production_analysis_handoff_scan_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_HANDOFF_SCAN_FAILED'
      })
    }
    try {
      await recomputeDispatcher.dispatchBatch()
    } catch {
      emitWorkerEvent({
        event: 'production_analysis_recompute_scan_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_RECOMPUTE_SCAN_FAILED'
      })
    }
    if (!stopping) await wait(5_000)
  }
})()

try {
  const worker = await Worker.create({
    connection: workerConnection,
    taskQueue: fixtureResearchTaskQueue,
    workflowsPath: fileURLToPath(import.meta.resolve('@appsea/workflows/workflows')),
    activities: {
      ...createFixtureResearchActivities(pool),
      ...createProductionCollectionActivities(pool),
      ...createProductionAnalysisActivities(pool, objectStore)
    },
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 8
  })
  emitWorkerEvent({ event: 'worker_started', taskQueue: fixtureResearchTaskQueue })
  stopHeartbeat = startWorkerHeartbeat(fixtureResearchTaskQueue)
  await worker.run()
} finally {
  stopping = true
  stopHeartbeat()
  await handoffLoop
  emitWorkerEvent({ event: 'worker_stopped', taskQueue: fixtureResearchTaskQueue })
  await Promise.all([pool.end(), clientConnection.close(), workerConnection.close()])
}
