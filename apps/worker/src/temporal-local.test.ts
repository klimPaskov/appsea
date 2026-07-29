import { describe, expect, it } from 'vitest'
import { localTemporalAddressFromEnv } from './temporal-local'

describe('local Temporal connection boundary', () => {
  it('defaults to the loopback development server', () => {
    expect(localTemporalAddressFromEnv({ NODE_ENV: 'development' })).toBe('127.0.0.1:7233')
  })

  it.each(['temporal.example.com:7233', '0.0.0.0:7233', '127.0.0.1:99999'])(
    'rejects unsafe local address %s',
    (address) => {
      expect(() =>
        localTemporalAddressFromEnv({ NODE_ENV: 'development', APPSEA_TEMPORAL_ADDRESS: address })
      ).toThrow()
    }
  )

  it('refuses production until TLS and authorization are implemented', () => {
    expect(() =>
      localTemporalAddressFromEnv({
        NODE_ENV: 'production',
        APPSEA_TEMPORAL_ADDRESS: '127.0.0.1:7233'
      })
    ).toThrow(/Production Temporal TLS/)
  })
})
