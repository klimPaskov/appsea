import { describe, expect, it, vi } from 'vitest'
import { GET as getLiveHealth } from '../app/api/health/live/route'
import { evaluateReadiness, livenessPayload } from './health'

describe('web health contracts', () => {
  it('returns a minimal liveness payload without dependency details', () => {
    expect(livenessPayload('2026-08-01T00:00:00.000Z')).toEqual({
      service: 'appsea-web',
      status: 'ok',
      observedAt: '2026-08-01T00:00:00.000Z'
    })
  })

  it('serves the dependency-free liveness route with no-store headers', async () => {
    const response = getLiveHealth()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      service: 'appsea-web',
      status: 'ok'
    })
  })

  it('runs readiness checks concurrently and reports only bounded states', async () => {
    const calls: string[] = []
    const report = await evaluateReadiness(
      [
        {
          name: 'database',
          run: async () => {
            calls.push('database')
          }
        },
        {
          name: 'temporal',
          run: async () => {
            calls.push('temporal')
          }
        },
        {
          name: 'objectStore',
          run: () => {
            calls.push('objectStore')
          }
        }
      ],
      100
    )
    expect(report).toEqual({
      status: 'ready',
      checks: { database: 'ok', temporal: 'ok', objectStore: 'ok' }
    })
    expect(calls.sort()).toEqual(['database', 'objectStore', 'temporal'])
  })

  it('fails closed on a rejected or timed-out dependency without exposing the error', async () => {
    const secret = 'postgres://user:password@database.example/appsea'
    const report = await evaluateReadiness(
      [
        { name: 'database', run: () => Promise.reject(new Error(secret)) },
        { name: 'temporal', run: () => new Promise<void>(() => undefined) },
        { name: 'objectStore', run: () => undefined }
      ],
      100
    )
    expect(report.status).toBe('not_ready')
    expect(report.checks).toEqual({ database: 'failed', temporal: 'failed', objectStore: 'ok' })
    expect(JSON.stringify(report)).not.toContain('password')
    expect(() => evaluateReadiness([], 99)).rejects.toThrow(/between 100 and 30000/)
  })

  it('does not treat a late completion as a second result', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn(() => new Promise<void>(() => undefined))
      const pending = evaluateReadiness([{ name: 'database', run }], 100)
      await vi.advanceTimersByTimeAsync(100)
      await expect(pending).resolves.toEqual({
        status: 'not_ready',
        checks: { database: 'failed' }
      })
      expect(run).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
