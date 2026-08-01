import { Connection, WorkflowClient } from '@temporalio/client'

export interface TemporalClientConfig {
  address: string
  namespace: string
  apiKey?: string
  tlsCa?: string
  localUnauthenticated: boolean
}

export class TemporalConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemporalConfigurationError'
  }
}

interface ParsedAddress {
  host: string
  port: number
}

function parseAddress(address: string): ParsedAddress {
  const value = address.trim()
  if (!value) throw new TemporalConfigurationError('Temporal address is required')
  let host: string
  let portText: string
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0 || value.charAt(end + 1) !== ':') {
      throw new TemporalConfigurationError('Temporal address must include a host and port')
    }
    host = value.slice(1, end)
    portText = value.slice(end + 2)
  } else {
    const separator = value.lastIndexOf(':')
    if (separator <= 0) {
      throw new TemporalConfigurationError('Temporal address must include a host and port')
    }
    host = value.slice(0, separator)
    portText = value.slice(separator + 1)
  }
  if (!host || !/^\d{1,5}$/.test(portText)) {
    throw new TemporalConfigurationError('Temporal address must include a host and port')
  }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TemporalConfigurationError('Temporal address port is invalid')
  }
  return { host: host.toLowerCase(), port }
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new TemporalConfigurationError(`${name} is required`)
  return value
}

function requiredTlsCa(environment: NodeJS.ProcessEnv): string {
  const value = required(environment, 'APPSEA_TEMPORAL_TLS_CA')
  const pem =
    value.includes('-----BEGIN CERTIFICATE-----') && value.includes('-----END CERTIFICATE-----')
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 16
  if (!pem && !base64) {
    throw new TemporalConfigurationError(
      'APPSEA_TEMPORAL_TLS_CA must be a PEM certificate or base64 certificate'
    )
  }
  return value
}

export function temporalClientConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): TemporalClientConfig {
  const address = (environment.APPSEA_TEMPORAL_ADDRESS ?? '127.0.0.1:7233').trim()
  const { host } = parseAddress(address)
  const production = environment.NODE_ENV === 'production'
  const localUnauthenticated = isLoopback(host)

  if (production && localUnauthenticated) {
    throw new TemporalConfigurationError(
      'Production Temporal requires a non-loopback authenticated endpoint'
    )
  }

  if (localUnauthenticated) {
    if (environment.APPSEA_TEMPORAL_API_KEY || environment.APPSEA_TEMPORAL_TLS_CA) {
      throw new TemporalConfigurationError(
        'Loopback Temporal must use unauthenticated local mode without remote credentials'
      )
    }
    return {
      address,
      namespace: environment.APPSEA_TEMPORAL_NAMESPACE?.trim() || 'default',
      localUnauthenticated: true
    }
  }

  return {
    address,
    namespace: required(environment, 'APPSEA_TEMPORAL_NAMESPACE'),
    tlsCa: requiredTlsCa(environment),
    apiKey: required(environment, 'APPSEA_TEMPORAL_API_KEY'),
    localUnauthenticated: false
  }
}

export interface ConnectedTemporalClient {
  client: WorkflowClient
  connection: Awaited<ReturnType<typeof Connection.connect>>
}

function decodeCa(value: string): Buffer {
  return value.includes('-----BEGIN') ? Buffer.from(value, 'utf8') : Buffer.from(value, 'base64')
}

export async function connectTemporalWorkflowClient(
  config: TemporalClientConfig = temporalClientConfigFromEnv()
): Promise<ConnectedTemporalClient> {
  const connection = await Connection.connect({
    address: config.address,
    ...(config.localUnauthenticated
      ? {}
      : {
          apiKey: config.apiKey,
          tls: { serverRootCACertificate: decodeCa(config.tlsCa ?? '') }
        })
  })
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
