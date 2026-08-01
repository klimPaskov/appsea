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

/**
 * Validate the endpoint shared by the web gateway and the durable worker.
 * Loopback is intentionally development/test-only and cannot carry remote
 * credentials; every non-loopback endpoint requires a namespace, API key, and
 * pinned CA certificate.
 */
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

function decodeCa(value: string): Buffer {
  return value.includes('-----BEGIN') ? Buffer.from(value, 'utf8') : Buffer.from(value, 'base64')
}

/** Build the identical authenticated options for Temporal clients and workers. */
export function temporalConnectionOptions(config: TemporalClientConfig): {
  address: string
  apiKey?: string
  tls?: { serverRootCACertificate: Buffer }
} {
  if (config.localUnauthenticated) return { address: config.address }
  if (!config.apiKey || !config.tlsCa) {
    throw new TemporalConfigurationError(
      'Authenticated Temporal connections require an API key and pinned CA'
    )
  }
  return {
    address: config.address,
    apiKey: config.apiKey,
    tls: { serverRootCACertificate: decodeCa(config.tlsCa) }
  }
}
