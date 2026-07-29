import { describe, expect, it } from 'vitest'
import { temporalClientConfigFromEnv, TemporalConfigurationError } from './temporal'

describe('web Temporal client configuration', () => {
  it('defaults to loopback unauthenticated local mode outside production', () => {
    expect(temporalClientConfigFromEnv({ NODE_ENV: 'development' })).toEqual({
      address: '127.0.0.1:7233',
      namespace: 'default',
      localUnauthenticated: true
    })
  })

  it('fails closed for production loopback and incomplete remote credentials', () => {
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

  it('requires auth for remote endpoints and keeps the credentials out of validation errors', () => {
    expect(() =>
      temporalClientConfigFromEnv({
        NODE_ENV: 'test',
        APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233'
      })
    ).toThrow(/APPSEA_TEMPORAL_NAMESPACE/)
    expect(() =>
      temporalClientConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233',
        APPSEA_TEMPORAL_NAMESPACE: 'appsea',
        APPSEA_TEMPORAL_TLS_CA: 'not-a-certificate',
        APPSEA_TEMPORAL_API_KEY: 'secret-api-key'
      })
    ).toThrow(/APPSEA_TEMPORAL_TLS_CA/)
    const config = temporalClientConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_TEMPORAL_ADDRESS: 'temporal.example:7233',
      APPSEA_TEMPORAL_NAMESPACE: 'appsea',
      APPSEA_TEMPORAL_TLS_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      APPSEA_TEMPORAL_API_KEY: 'secret-api-key'
    })
    expect(config).toEqual({
      address: 'temporal.example:7233',
      namespace: 'appsea',
      tlsCa: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      apiKey: 'secret-api-key',
      localUnauthenticated: false
    })
  })
})
