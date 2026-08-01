import { Connection, WorkflowClient } from '@temporalio/client'
import {
  temporalClientConfigFromEnv,
  temporalConnectionOptions,
  type TemporalClientConfig
} from '@appsea/workflows'

export {
  temporalClientConfigFromEnv,
  TemporalConfigurationError,
  type TemporalClientConfig
} from '@appsea/workflows'

export interface ConnectedTemporalClient {
  client: WorkflowClient
  connection: Awaited<ReturnType<typeof Connection.connect>>
}

export async function connectTemporalWorkflowClient(
  config: TemporalClientConfig = temporalClientConfigFromEnv()
): Promise<ConnectedTemporalClient> {
  const connection = await Connection.connect(temporalConnectionOptions(config))
  return { connection, client: new WorkflowClient({ connection, namespace: config.namespace }) }
}

declare global {
  var appseaTemporalClientPromise: Promise<ConnectedTemporalClient> | undefined
}

export async function getTemporalWorkflowClient(): Promise<WorkflowClient> {
  return (await getConnectedTemporalClient()).client
}

async function getConnectedTemporalClient(): Promise<ConnectedTemporalClient> {
  if (!globalThis.appseaTemporalClientPromise) {
    const promise = connectTemporalWorkflowClient()
    globalThis.appseaTemporalClientPromise = promise
    try {
      return await promise
    } catch (error) {
      if (globalThis.appseaTemporalClientPromise === promise) {
        globalThis.appseaTemporalClientPromise = undefined
      }
      throw error
    }
  }
  return globalThis.appseaTemporalClientPromise
}

/**
 * Verify the cached Temporal connection is reachable. Readiness probes call
 * this instead of starting a workflow, so health checks cannot create jobs or
 * reveal workflow input.
 */
export async function checkTemporalWorkflowClient(): Promise<void> {
  const connected = await getConnectedTemporalClient()
  await connected.connection.ensureConnected()
}

/**
 * Close the process-global connection during an explicit server shutdown or
 * test teardown. Next's request handlers intentionally retain one connection
 * per process; deployments should invoke this hook from their graceful
 * shutdown lifecycle rather than opening a connection for every request.
 */
export async function closeTemporalWorkflowClient(): Promise<void> {
  const promise = globalThis.appseaTemporalClientPromise
  globalThis.appseaTemporalClientPromise = undefined
  if (!promise) return
  const connected = await promise
  await connected.connection.close()
}
