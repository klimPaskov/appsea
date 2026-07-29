import { Pool, type PoolConfig } from 'pg'

export type DatabaseSslMode = 'disable' | 'verify-full'

export interface DatabaseConfig {
  connectionString: string
  sslMode: DatabaseSslMode
  applicationName: string
  maxConnections: number
  connectionTimeoutMs: number
  idleTimeoutMs: number
  statementTimeoutMs: number
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function validateConnectionString(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol')
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must include a host and database name')
  }
  if (parsed.hash) {
    throw new Error('DATABASE_URL must not contain a fragment')
  }
  const connectionStringSslParameters = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']
  if (connectionStringSslParameters.some((parameter) => parsed.searchParams.has(parameter))) {
    throw new Error('DATABASE_URL must not contain SSL parameters; use APPSEA_DATABASE_SSL_MODE')
  }
  if (parsed.search) {
    throw new Error('DATABASE_URL must not contain query parameters; use explicit AppSea settings')
  }
  return value
}

export function databaseConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  const connectionString = environment.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  const defaultSslMode: DatabaseSslMode =
    environment.NODE_ENV === 'production' ? 'verify-full' : 'disable'
  const sslMode = environment.APPSEA_DATABASE_SSL_MODE ?? defaultSslMode
  if (sslMode !== 'disable' && sslMode !== 'verify-full') {
    throw new Error('APPSEA_DATABASE_SSL_MODE must be disable or verify-full')
  }
  if (environment.NODE_ENV === 'production' && sslMode === 'disable') {
    throw new Error('Production database connections must verify TLS certificates')
  }

  return {
    connectionString: validateConnectionString(connectionString),
    sslMode,
    applicationName: environment.APPSEA_DATABASE_APPLICATION_NAME ?? 'appsea',
    maxConnections: positiveInteger(environment.APPSEA_DATABASE_POOL_MAX, 10, 'pool max'),
    connectionTimeoutMs: positiveInteger(
      environment.APPSEA_DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      'connection timeout'
    ),
    idleTimeoutMs: positiveInteger(
      environment.APPSEA_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      'idle timeout'
    ),
    statementTimeoutMs: positiveInteger(
      environment.APPSEA_DATABASE_STATEMENT_TIMEOUT_MS,
      30_000,
      'statement timeout'
    )
  }
}

export function createDatabasePool(config: DatabaseConfig): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs
  }

  if (config.sslMode === 'verify-full') {
    poolConfig.ssl = { rejectUnauthorized: true }
  }

  return new Pool(poolConfig)
}
