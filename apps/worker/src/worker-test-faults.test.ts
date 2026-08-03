import { describe, expect, it } from 'vitest'
import { workerPersistPauseMs } from './worker-test-faults'

describe('worker recovery drill fault injection', () => {
  it('is disabled when no drill setting is present', () => {
    expect(workerPersistPauseMs({ NODE_ENV: 'development' })).toBe(0)
  })

  it('accepts a bounded non-production pause', () => {
    expect(
      workerPersistPauseMs({
        NODE_ENV: 'test',
        APPSEA_TEST_WORKER_PERSIST_PAUSE_MS: '2500'
      })
    ).toBe(2500)
  })

  it('rejects malformed, unbounded, and production settings', () => {
    expect(() =>
      workerPersistPauseMs({ NODE_ENV: 'development', APPSEA_TEST_WORKER_PERSIST_PAUSE_MS: 'nope' })
    ).toThrow(/integer/)
    expect(() =>
      workerPersistPauseMs({ NODE_ENV: 'development', APPSEA_TEST_WORKER_PERSIST_PAUSE_MS: '99' })
    ).toThrow(/between/)
    expect(() =>
      workerPersistPauseMs({ NODE_ENV: 'production', APPSEA_TEST_WORKER_PERSIST_PAUSE_MS: '2500' })
    ).toThrow(/production/)
  })
})
