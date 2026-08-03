import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isIP } from 'node:net'
import { workspaceCostAlertLimits } from '@appsea/contracts'
import { databaseConfigFromEnv, mfaEncryptionConfigFromEnv } from '@appsea/db'
import { objectStoreFromEnv } from '@appsea/object-store'
import { temporalClientConfigFromEnv } from '@appsea/workflows'
import {
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv
} from './maintenance-scheduler'
import { requiredDeliveryUrl, signedDeliveryConfigFromEnv } from './signed-delivery'
import { operationalAlertConfigFromEnv } from './alert-delivery'

export type ProductionPreflightCheckStatus = 'ok' | 'failed'

export interface ProductionPreflightCheck {
  name: string
  status: ProductionPreflightCheckStatus
  failureCode?: string
}

export interface ProductionPreflightReport {
  status: 'ready' | 'not_ready'
  checks: readonly ProductionPreflightCheck[]
}

export class ProductionPreflightConfigurationError extends Error {
  constructor() {
    super('Production deployment configuration is invalid')
    this.name = 'ProductionPreflightConfigurationError'
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function mappedIpv4FromIpv6(hostname: string): string | null {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (isIP(normalized) !== 6) return null
  const sections = normalized.split('::')
  if (sections.length > 2) return null
  const left = sections[0] === '' ? [] : sections[0]!.split(':')
  const right = sections.length === 2 && sections[1] !== '' ? sections[1]!.split(':') : []
  if (
    [...left, ...right].some((section) => !/^[0-9a-f]{1,4}$/i.test(section) || section.length === 0)
  ) {
    return null
  }
  const missing = 8 - left.length - right.length
  if (missing < 0 || (sections.length === 2 && missing < 1)) return null
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((word) =>
    Number.parseInt(word, 16)
  )
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
  const compatible = words.slice(0, 6).every((word) => word === 0)
  if (words.length !== 8 || (!mapped && !compatible)) {
    return null
  }
  return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join('.')
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (isLoopbackHost(normalized)) return true
  const mappedIpv4 = mappedIpv4FromIpv6(normalized)
  if (mappedIpv4) return isPrivateHost(mappedIpv4)
  const octets = normalized.split('.').map((part) => Number(part))
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
      octets[0]! >= 224
    )
  }
  return (
    isIP(normalized) === 6 &&
    (normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('fec') ||
      normalized.startsWith('ff'))
  )
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new ProductionPreflightConfigurationError()
  return value
}

function databaseUsername(environment: NodeJS.ProcessEnv, name: string, expected: string): void {
  const raw = requiredEnvironmentValue(environment, name)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ProductionPreflightConfigurationError()
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new ProductionPreflightConfigurationError()
  }
  let username: string
  try {
    username = decodeURIComponent(parsed.username)
  } catch {
    throw new ProductionPreflightConfigurationError()
  }
  if (username !== expected || isLoopbackHost(parsed.hostname)) {
    throw new ProductionPreflightConfigurationError()
  }
}

function strictBoolean(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = environment[name]?.trim()
  if (value === undefined || value === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ProductionPreflightConfigurationError()
}

function assertProductionOrigin(environment: NodeJS.ProcessEnv): void {
  const origin = requiredDeliveryUrl(
    requiredEnvironmentValue(environment, 'APPSEA_PUBLIC_ORIGIN'),
    'origin',
    true,
    () => new ProductionPreflightConfigurationError()
  )
  if (isPrivateHost(origin.hostname)) throw new ProductionPreflightConfigurationError()
}

function assertProductionDelivery(environment: NodeJS.ProcessEnv): void {
  const recoveryEnabled = strictBoolean(environment, 'APPSEA_AUTH_RECOVERY_ENABLED')
  const invitationsEnabled = strictBoolean(environment, 'APPSEA_AUTH_INVITATIONS_ENABLED')
  if (!recoveryEnabled && !invitationsEnabled) return

  const encryptionKey = requiredEnvironmentValue(environment, 'APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY')
  if (!/^[A-Za-z0-9_-]{43}$/.test(encryptionKey)) {
    throw new ProductionPreflightConfigurationError()
  }
  const delivery = signedDeliveryConfigFromEnv(
    environment,
    () => new ProductionPreflightConfigurationError()
  )
  if (isPrivateHost(delivery.endpoint.hostname)) {
    throw new ProductionPreflightConfigurationError()
  }
}

function assertProductionMfa(environment: NodeJS.ProcessEnv): void {
  try {
    const config = mfaEncryptionConfigFromEnv(environment)
    if (!environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY?.trim()) {
      throw new ProductionPreflightConfigurationError()
    }
    if (config.previous && config.previous.version >= config.current.version) {
      throw new ProductionPreflightConfigurationError()
    }
  } catch {
    throw new ProductionPreflightConfigurationError()
  }
}

function assertProductionOidc(environment: NodeJS.ProcessEnv): void {
  if (!strictBoolean(environment, 'APPSEA_AUTH_OIDC_ENABLED')) return
  if (environment.APPSEA_AUTH_OIDC_REVIEWED?.trim() !== 'true') {
    throw new ProductionPreflightConfigurationError()
  }
  if (environment.APPSEA_AUTH_OIDC_ACCOUNT_LINKING?.trim() !== 'explicit') {
    throw new ProductionPreflightConfigurationError()
  }
  for (const name of [
    'APPSEA_AUTH_OIDC_ISSUER',
    'APPSEA_AUTH_OIDC_REDIRECT_URI',
    'APPSEA_AUTH_OIDC_CLIENT_ID',
    'APPSEA_AUTH_OIDC_CLIENT_SECRET'
  ]) {
    requiredEnvironmentValue(environment, name)
  }
  const issuer = requiredEnvironmentValue(environment, 'APPSEA_AUTH_OIDC_ISSUER')
  const redirectUri = requiredEnvironmentValue(environment, 'APPSEA_AUTH_OIDC_REDIRECT_URI')
  let issuerUrl: URL
  let redirectUrl: URL
  let publicOrigin: URL
  try {
    issuerUrl = new URL(issuer)
    redirectUrl = new URL(redirectUri)
    publicOrigin = requiredDeliveryUrl(
      requiredEnvironmentValue(environment, 'APPSEA_PUBLIC_ORIGIN'),
      'origin',
      true,
      () => new ProductionPreflightConfigurationError()
    )
  } catch {
    throw new ProductionPreflightConfigurationError()
  }
  if (
    issuerUrl.protocol !== 'https:' ||
    redirectUrl.protocol !== 'https:' ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    redirectUrl.username ||
    redirectUrl.password ||
    isPrivateHost(issuerUrl.hostname) ||
    isPrivateHost(redirectUrl.hostname) ||
    redirectUrl.pathname !== '/api/auth/oidc/callback' ||
    redirectUrl.search ||
    redirectUrl.hash ||
    redirectUrl.origin !== publicOrigin.origin
  ) {
    throw new ProductionPreflightConfigurationError()
  }
  if (requiredEnvironmentValue(environment, 'APPSEA_AUTH_OIDC_CLIENT_ID').length > 512) {
    throw new ProductionPreflightConfigurationError()
  }
  const configuredOrigins = environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS?.trim() ?? ''
  const endpointOrigins = configuredOrigins === '' ? [] : configuredOrigins.split(',')
  if (endpointOrigins.length > 8) throw new ProductionPreflightConfigurationError()
  for (const origin of endpointOrigins) {
    if (!origin || origin.length > 512) throw new ProductionPreflightConfigurationError()
    let parsed: URL
    try {
      parsed = new URL(origin.trim())
    } catch {
      throw new ProductionPreflightConfigurationError()
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname !== '/' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      isPrivateHost(parsed.hostname)
    ) {
      throw new ProductionPreflightConfigurationError()
    }
  }
  const clientSecret = requiredEnvironmentValue(environment, 'APPSEA_AUTH_OIDC_CLIENT_SECRET')
  if (clientSecret.length > 2_048) throw new ProductionPreflightConfigurationError()
}

function assertProductionObjectStore(environment: NodeJS.ProcessEnv): void {
  const endpoint = requiredEnvironmentValue(environment, 'APPSEA_OBJECT_STORE_ENDPOINT')
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new ProductionPreflightConfigurationError()
  }
  if (isLoopbackHost(parsed.hostname)) throw new ProductionPreflightConfigurationError()
  objectStoreFromEnv(environment)
}

function assertProductionDatabase(environment: NodeJS.ProcessEnv): void {
  databaseConfigFromEnv(environment)
  databaseUsername(environment, 'DATABASE_URL', 'appsea_service')
  databaseUsername(environment, 'APPSEA_MAINTENANCE_DATABASE_URL', 'appsea_maintenance')
  databaseUsername(environment, 'APPSEA_MIGRATION_DATABASE_URL', 'appsea_migrator')
  if (environment.APPSEA_DATABASE_MIGRATION_ROLE?.trim() !== 'appsea_owner') {
    throw new ProductionPreflightConfigurationError()
  }
  databaseConfigFromEnv({
    ...environment,
    DATABASE_URL: requiredEnvironmentValue(environment, 'APPSEA_MIGRATION_DATABASE_URL')
  })
}

function assertProductionMaintenance(environment: NodeJS.ProcessEnv): void {
  maintenanceDatabaseConfigFromEnv(environment)
  maintenanceSchedulerOwnerIdFromEnv(environment)
  maintenanceSchedulerLeaseSecondsFromEnv(environment)
  maintenanceSchedulerMetricsRetentionDaysFromEnv(environment)
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(environment)
}

function assertProductionTemporal(environment: NodeJS.ProcessEnv): void {
  const config = temporalClientConfigFromEnv(environment)
  if (config.localUnauthenticated || isLoopbackHost(new URL(`http://${config.address}`).hostname)) {
    throw new ProductionPreflightConfigurationError()
  }
}

function assertProductionProxy(environment: NodeJS.ProcessEnv): void {
  const secret = environment.APPSEA_TRUSTED_PROXY_SECRET?.trim()
  if (secret === undefined || secret === '') return
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, 'base64url').length !== 32) {
    throw new ProductionPreflightConfigurationError()
  }
}

function assertProductionCostAlert(environment: NodeJS.ProcessEnv): void {
  const currency = requiredEnvironmentValue(environment, 'APPSEA_COST_ALERT_CURRENCY')
  if (!/^[A-Z]{3}$/.test(currency)) throw new ProductionPreflightConfigurationError()
  for (const name of [
    'APPSEA_COST_ALERT_ACTUAL_THRESHOLD_MICROS',
    'APPSEA_COST_ALERT_ESTIMATED_THRESHOLD_MICROS'
  ]) {
    const value = requiredEnvironmentValue(environment, name)
    if (!/^(?:0|[1-9][0-9]{0,17})$/.test(value)) {
      throw new ProductionPreflightConfigurationError()
    }
  }
  const periodSeconds = environment.APPSEA_COST_ALERT_PERIOD_SECONDS?.trim()
  if (periodSeconds !== undefined && periodSeconds !== '') {
    const parsed = Number(periodSeconds)
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > workspaceCostAlertLimits.maxPeriodSeconds
    ) {
      throw new ProductionPreflightConfigurationError()
    }
  }
}

function assertProductionAlertRouting(environment: NodeJS.ProcessEnv): void {
  const config = operationalAlertConfigFromEnv(
    environment,
    () => new ProductionPreflightConfigurationError()
  )
  if (!config) throw new ProductionPreflightConfigurationError()
}

function check(name: string, failureCode: string, run: () => void): ProductionPreflightCheck {
  try {
    run()
    return { name, status: 'ok' }
  } catch {
    return { name, status: 'failed', failureCode }
  }
}

/**
 * Validate all production process boundaries without opening a network
 * connection or printing a secret. This is a deployment gate, not a health
 * check: the web readiness route still verifies live dependencies.
 */
export function validateProductionEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ProductionPreflightReport {
  const checks = [
    check('nodeEnvironment', 'APPSEA_PREFLIGHT_NODE_ENV', () => {
      if (environment.NODE_ENV !== 'production') throw new ProductionPreflightConfigurationError()
    }),
    check('databaseAndRoleSeparation', 'APPSEA_PREFLIGHT_DATABASE', () =>
      assertProductionDatabase(environment)
    ),
    check('maintenanceScheduler', 'APPSEA_PREFLIGHT_MAINTENANCE', () =>
      assertProductionMaintenance(environment)
    ),
    check('temporal', 'APPSEA_PREFLIGHT_TEMPORAL', () => assertProductionTemporal(environment)),
    check('objectStore', 'APPSEA_PREFLIGHT_OBJECT_STORE', () =>
      assertProductionObjectStore(environment)
    ),
    check('publicOrigin', 'APPSEA_PREFLIGHT_PUBLIC_ORIGIN', () =>
      assertProductionOrigin(environment)
    ),
    check('authDelivery', 'APPSEA_PREFLIGHT_AUTH_DELIVERY', () =>
      assertProductionDelivery(environment)
    ),
    check('authMfa', 'APPSEA_PREFLIGHT_AUTH_MFA', () => assertProductionMfa(environment)),
    check('authIdentity', 'APPSEA_PREFLIGHT_AUTH_IDENTITY', () =>
      assertProductionOidc(environment)
    ),
    check('trustedProxy', 'APPSEA_PREFLIGHT_TRUSTED_PROXY', () =>
      assertProductionProxy(environment)
    ),
    check('costAlert', 'APPSEA_PREFLIGHT_COST_ALERT', () => assertProductionCostAlert(environment)),
    check('alertRouting', 'APPSEA_PREFLIGHT_ALERT_ROUTING', () =>
      assertProductionAlertRouting(environment)
    )
  ]
  return {
    status: checks.every((entry) => entry.status === 'ok') ? 'ready' : 'not_ready',
    checks
  }
}

function invokedDirectly(): boolean {
  const modulePath = fileURLToPath(import.meta.url)
  return process.argv.slice(1).some((argument) => {
    try {
      return path.resolve(argument) === modulePath
    } catch {
      return false
    }
  })
}

if (invokedDirectly()) {
  const report = validateProductionEnvironment()
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== 'ready') process.exitCode = 1
}
