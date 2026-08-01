import { describe, expect, it } from 'vitest'
import {
  temporalClientConfigFromEnv,
  temporalConnectionOptions,
  TemporalConfigurationError
} from './temporal-config'

describe('shared Temporal endpoint configuration', () => {
  it('defaults to loopback unauthenticated local mode outside production', () => {
    expect(temporalClientConfigFromEnv({ NODE_ENV: 'development' })).toEqual({
      address: '127.0.0.1:7233',
      namespace: 'default',
      localUnauthenticated: true
    })
    expect(
      temporalConnectionOptions(
        temporalClientConfigFromEnv({ NODE_ENV: 'development', APPSEA_TEMPORAL_NAMESPACE: 'local' })
      )
    ).toEqual({ address: '127.0.0.1:7233' })
  })

  it('rejects production loopback and incomplete remote credentials', () => {
    expect(() => temporalClientConfigFromEnv({ NODE_ENV: 'production' })).toThrow(
      TemporalConfigurationError
    )
    expect(() =>
      temporalClientConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233',
        APPSEA_TEMPORAL_NAMESPACE: 'appsea'
      })
    ).toThrow(/APPSEA_TEMPORAL_TLS_CA/)
  })

  it('requires TLS, namespace, and API key for remote endpoints', () => {
    expect(() =>
      temporalClientConfigFromEnv({
        NODE_ENV: 'test',
        APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233'
      })
    ).toThrow(/APPSEA_TEMPORAL_NAMESPACE/)
    const config = temporalClientConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233',
      APPSEA_TEMPORAL_NAMESPACE: 'appsea',
      APPSEA_TEMPORAL_TLS_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      APPSEA_TEMPORAL_API_KEY: 'secret-api-key'
    })
    const options = temporalConnectionOptions(config)
    expect(options.address).toBe('temporal.example:7233')
    expect(options.apiKey).toBe('secret-api-key')
    expect(options.tls?.serverRootCACertificate.toString('utf8')).toContain('BEGIN CERTIFICATE')
  })

  it('never accepts credentials with loopback or omits required authenticated fields', () => {
    expect(() =>
      temporalClientConfigFromEnv({
        NODE_ENV: 'development',
        APPSEA_TEMPORAL_API_KEY: 'secret-api-key'
      })
    ).toThrow(/Loopback Temporal/)
    expect(() =>
      temporalConnectionOptions({
        address: 'temporal.example:7233',
        namespace: 'appsea',
        localUnauthenticated: false
      })
    ).toThrow(/API key and pinned CA/)
  })
})
