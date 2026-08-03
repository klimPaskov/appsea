import { fileURLToPath } from 'node:url'
import { Connection, WorkflowClient } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import { objectStoreFromEnv } from '@appsea/object-store'
import {
  fixtureResearchTaskQueue,
  temporalClientConfigFromEnv,
  temporalConnectionOptions
} from '@appsea/workflows'
import { createFixtureResearchActivities } from './workflow-activities'
import { createProductionCollectionActivities } from './production-workflow-activities'
import { createProductionAnalysisActivities } from './production-analysis-activities'
import { createProductionAnalysisHandoffDispatcher } from './production-analysis-handoff'
import { createProductionAnalysisRecomputeDispatcher } from './production-analysis-recompute'
import { emitWorkerEvent, startWorkerHeartbeat } from './observability'
import { createDurableWorkerShutdownLifecycle } from './durable-worker-lifecycle'

let stopping = false
let worker: Worker | undefined
let stopHeartbeat = (): void => undefined
const shutdownController = new AbortController()
const shutdown = createDurableWorkerShutdownLifecycle(() => {
  stopping = true
  shutdownController.abort()
  stopHeartbeat()
  worker?.shutdown()
})
const requestShutdown = (): void => shutdown.request()
process.once('SIGINT', requestShutdown)
process.once('SIGTERM', requestShutdown)

const pool = createDatabasePool(databaseConfigFromEnv())
const objectStore = objectStoreFromEnv(process.env)
const temporalConfig = temporalClientConfigFromEnv()
const temporalOptions = temporalConnectionOptions(temporalConfig)
const workerConnection = await NativeConnection.connect(temporalOptions)
const clientConnection = await Connection.connect(temporalOptions)
const workflowClient = new WorkflowClient({
  connection: clientConnection,
  namespace: temporalConfig.namespace
})
const handoffDispatcher = createProductionAnalysisHandoffDispatcher(pool, workflowClient)
const recomputeDispatcher = createProductionAnalysisRecomputeDispatcher(pool, workflowClient)

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    if (shutdownController.signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      shutdownController.signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      shutdownController.signal.removeEventListener('abort', onAbort)
      resolve()
    }
    shutdownController.signal.addEventListener('abort', onAbort, { once: true })
  })
const handoffLoop = (async (): Promise<void> => {
  while (!stopping && !shutdownController.signal.aborted) {
    try {
      await handoffDispatcher.dispatchBatch()
    } catch {
      emitWorkerEvent({
        event: 'production_analysis_handoff_scan_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_HANDOFF_SCAN_FAILED'
      })
    }
    if (stopping || shutdownController.signal.aborted) break
    try {
      await recomputeDispatcher.dispatchBatch()
    } catch {
      emitWorkerEvent({
        event: 'production_analysis_recompute_scan_failed',
        taskQueue: fixtureResearchTaskQueue,
        failureCode: 'APPSEA_RECOMPUTE_SCAN_FAILED'
      })
    }
    if (!stopping && !shutdownController.signal.aborted) await wait(5_000)
  }
})()

try {
  worker = await Worker.create({
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
  if (shutdown.isRequested()) {
    worker.shutdown()
  } else {
    emitWorkerEvent({ event: 'worker_started', taskQueue: fixtureResearchTaskQueue })
    stopHeartbeat = startWorkerHeartbeat(fixtureResearchTaskQueue)
  }
  await worker.run()
} finally {
  shutdown.request()
  await handoffLoop
  emitWorkerEvent({ event: 'worker_stopped', taskQueue: fixtureResearchTaskQueue })
  process.removeListener('SIGINT', requestShutdown)
  process.removeListener('SIGTERM', requestShutdown)
  await Promise.all([pool.end(), clientConnection.close(), workerConnection.close()])
}
