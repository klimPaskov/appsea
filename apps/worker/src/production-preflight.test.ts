import { describe, expect, it } from 'vitest'
import {
  validateProductionEnvironment,
  type ProductionPreflightReport
} from './production-preflight'

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://appsea_service:db-secret@postgres.internal/appsea',
    APPSEA_MAINTENANCE_DATABASE_URL:
      'postgres://appsea_maintenance:maintenance-secret@postgres.internal/appsea',
    APPSEA_MIGRATION_DATABASE_URL:
      'postgres://appsea_migrator:migration-secret@postgres.internal/appsea',
    APPSEA_DATABASE_MIGRATION_ROLE: 'appsea_owner',
    APPSEA_DATABASE_SSL_MODE: 'verify-full',
    APPSEA_TEMPORAL_ADDRESS: 'temporal.internal:7233',
    APPSEA_TEMPORAL_NAMESPACE: 'appsea-production',
    APPSEA_TEMPORAL_API_KEY: 'temporal-secret',
    APPSEA_TEMPORAL_TLS_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    APPSEA_OBJECT_STORE_ENDPOINT: 'https://objects.internal',
    APPSEA_OBJECT_STORE_BUCKET: 'appsea-production',
    APPSEA_OBJECT_STORE_REGION: 'us-east-1',
    APPSEA_OBJECT_STORE_ACCESS_KEY_ID: 'object-access',
    APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY: 'object-secret',
    APPSEA_PUBLIC_ORIGIN: 'https://appsea.example',
    APPSEA_AUTH_RECOVERY_ENABLED: 'false',
    APPSEA_AUTH_INVITATIONS_ENABLED: 'false',
    APPSEA_AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64url'),
    APPSEA_ALERT_ROUTING_ENABLED: 'true',
    APPSEA_ALERT_ROUTING_URL: 'https://alerts.internal/appsea',
    APPSEA_ALERT_ROUTING_SECRET: Buffer.alloc(32, 9).toString('base64url'),
    APPSEA_SCHEDULER_OWNER_ID: 'scheduler:production:one',
    APPSEA_COST_ALERT_CURRENCY: 'USD',
    APPSEA_COST_ALERT_ACTUAL_THRESHOLD_MICROS: '1000000',
    APPSEA_COST_ALERT_ESTIMATED_THRESHOLD_MICROS: '2000000'
  }
}

function check(report: ProductionPreflightReport, name: string) {
  const result = report.checks.find((entry) => entry.name === name)
  if (!result) throw new Error(`Missing check ${name}`)
  return result
}

describe('production deployment configuration preflight', () => {
  it('accepts complete role-separated production settings without contacting dependencies', () => {
    const report = validateProductionEnvironment(baseEnvironment())
    expect(report.status).toBe('ready')
    expect(report.checks.every((entry) => entry.status === 'ok')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('db-secret')
    expect(JSON.stringify(report)).not.toContain('temporal-secret')
  })

  it('requires delivery and encryption settings when an auth delivery switch is enabled', () => {
    const environment = baseEnvironment()
    environment.APPSEA_AUTH_RECOVERY_ENABLED = 'true'
    const failed = validateProductionEnvironment(environment)
    expect(failed.status).toBe('not_ready')
    expect(check(failed, 'authDelivery')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_DELIVERY'
    })

    environment.APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
    environment.APPSEA_PUBLIC_ORIGIN = 'https://appsea.example'
    environment.APPSEA_AUTH_RECOVERY_DELIVERY_URL = 'https://delivery.internal/send'
    environment.APPSEA_AUTH_RECOVERY_DELIVERY_SECRET = Buffer.alloc(32, 8).toString('base64url')
    const ready = validateProductionEnvironment(environment)
    expect(ready.status).toBe('ready')
  })

  it('requires a separate 32-byte MFA encryption key', () => {
    const environment = baseEnvironment()
    delete environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY
    const missing = validateProductionEnvironment(environment)
    expect(check(missing, 'authMfa')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_MFA'
    })

    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY = 'not-a-key'
    const malformed = validateProductionEnvironment(environment)
    expect(check(malformed, 'authMfa')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_MFA'
    })

    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64url')
    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION = '2'
    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS = Buffer.alloc(32, 5).toString('base64url')
    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION = '1'
    expect(validateProductionEnvironment(environment).status).toBe('ready')

    delete environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION
    expect(check(validateProductionEnvironment(environment), 'authMfa')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_MFA'
    })
  })

  it('keeps OIDC disabled by default and requires an explicit reviewed deployment when enabled', () => {
    const disabled = validateProductionEnvironment(baseEnvironment())
    expect(check(disabled, 'authIdentity')).toMatchObject({ status: 'ok' })

    const environment = baseEnvironment()
    environment.APPSEA_AUTH_OIDC_ENABLED = 'true'
    environment.APPSEA_AUTH_OIDC_ISSUER = 'https://issuer.example'
    environment.APPSEA_AUTH_OIDC_REDIRECT_URI = 'https://appsea.example/api/auth/oidc/callback'
    environment.APPSEA_AUTH_OIDC_CLIENT_ID = 'appsea'
    environment.APPSEA_AUTH_OIDC_CLIENT_SECRET = 'oidc-secret'
    const unreviewed = validateProductionEnvironment(environment)
    expect(check(unreviewed, 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })

    environment.APPSEA_AUTH_OIDC_REVIEWED = 'true'
    environment.APPSEA_AUTH_OIDC_ACCOUNT_LINKING = 'explicit'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'ok'
    })

    environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS = 'https://oauth.example'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'ok'
    })

    environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS = 'https://127.0.0.1'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })

    environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS = 'https://localhost...'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })

    delete environment.APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS
    environment.APPSEA_AUTH_OIDC_ISSUER = 'https://169.254.169.254'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })

    for (const issuer of [
      'https://[::ffff:192.168.1.1]',
      'https://[::ffff:10.0.0.1]',
      'https://[::]',
      'https://[ff02::1]',
      'https://[::192.168.1.1]',
      'https://[fec0::1]'
    ]) {
      environment.APPSEA_AUTH_OIDC_ISSUER = issuer
      expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
        status: 'failed',
        failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
      })
    }

    environment.APPSEA_AUTH_OIDC_ISSUER = 'https://issuer.example'
    environment.APPSEA_AUTH_OIDC_REDIRECT_URI = 'http://localhost:3000/api/auth/oidc/callback'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })

    environment.APPSEA_AUTH_OIDC_REDIRECT_URI = 'https://another.example/api/auth/oidc/callback'
    expect(check(validateProductionEnvironment(environment), 'authIdentity')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_AUTH_IDENTITY'
    })
  })

  it('rejects local database roles, loopback endpoints, and insecure production mode', () => {
    const environment = baseEnvironment()
    environment.DATABASE_URL = 'postgres://appsea_service:db-secret@127.0.0.1:5433/appsea'
    environment.APPSEA_TEMPORAL_ADDRESS = '127.0.0.1:7233'
    environment.APPSEA_OBJECT_STORE_ENDPOINT = 'http://127.0.0.1:9000'
    environment.APPSEA_PUBLIC_ORIGIN = 'http://localhost:3000'
    const report = validateProductionEnvironment(environment)

    expect(report.status).toBe('not_ready')
    expect(check(report, 'databaseAndRoleSeparation').status).toBe('failed')
    expect(check(report, 'temporal').status).toBe('failed')
    expect(check(report, 'objectStore').status).toBe('failed')
    expect(check(report, 'publicOrigin').status).toBe('failed')
  })

  it('rejects role confusion, invalid flags, and malformed trusted proxy secrets', () => {
    const environment = baseEnvironment()
    environment.APPSEA_DATABASE_MIGRATION_ROLE = 'appsea_service'
    environment.APPSEA_AUTH_INVITATIONS_ENABLED = 'yes'
    environment.APPSEA_TRUSTED_PROXY_SECRET = 'too-short'
    const report = validateProductionEnvironment(environment)

    expect(report.status).toBe('not_ready')
    expect(check(report, 'databaseAndRoleSeparation').status).toBe('failed')
    expect(check(report, 'authDelivery').status).toBe('failed')
    expect(check(report, 'trustedProxy').status).toBe('failed')
  })

  it('requires exact cost alert thresholds and a comparison currency', () => {
    const environment = baseEnvironment()
    delete environment.APPSEA_COST_ALERT_CURRENCY
    const missing = validateProductionEnvironment(environment)
    expect(check(missing, 'costAlert')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_COST_ALERT'
    })

    environment.APPSEA_COST_ALERT_CURRENCY = 'usd'
    environment.APPSEA_COST_ALERT_ACTUAL_THRESHOLD_MICROS = '1.2'
    const malformed = validateProductionEnvironment(environment)
    expect(check(malformed, 'costAlert')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_COST_ALERT'
    })
  })

  it('requires an HTTPS operational alert route in production', () => {
    const environment = baseEnvironment()
    delete environment.APPSEA_ALERT_ROUTING_URL
    const missing = validateProductionEnvironment(environment)
    expect(check(missing, 'alertRouting')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_ALERT_ROUTING'
    })

    environment.APPSEA_ALERT_ROUTING_URL = 'http://alerts.internal/appsea'
    const insecure = validateProductionEnvironment(environment)
    expect(check(insecure, 'alertRouting')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_ALERT_ROUTING'
    })
  })

  it('requires production mode even when the rest of the environment is valid', () => {
    const environment = baseEnvironment()
    environment.NODE_ENV = 'development'
    const report = validateProductionEnvironment(environment)
    expect(report.status).toBe('not_ready')
    expect(check(report, 'nodeEnvironment')).toMatchObject({
      status: 'failed',
      failureCode: 'APPSEA_PREFLIGHT_NODE_ENV'
    })
  })
})
