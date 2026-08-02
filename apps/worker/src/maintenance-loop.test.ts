import { describe, expect, it, vi } from 'vitest'
import {
  maintenanceLoopFailureBackoffSecondsFromEnv,
  maintenanceLoopIntervalSecondsFromEnv,
  runMaintenanceLoop
} from './maintenance-loop'

describe('maintenance loop', () => {
  it('retries a failed pass with bounded backoff and stops cleanly', async () => {
    const controller = new AbortController()
    const events: Array<Record<string, unknown>> = []
    const delays: number[] = []
    let passCount = 0
    const sleep = vi.fn(async (milliseconds: number) => {
      delays.push(milliseconds)
      if (delays.length === 2) controller.abort()
    })

    const result = await runMaintenanceLoop({
      taskQueue: 'appsea-source-maintenance-v1',
      intervalMs: 1_000,
      failureBackoffMs: 2_000,
      signal: controller.signal,
      sleep,
      emit: (event) => events.push(event as unknown as Record<string, unknown>),
      runPass: async () => {
        passCount += 1
        if (passCount === 1) throw new Error('simulated failure')
      }
    })

    expect(result).toEqual({ passes: 1, failures: 1 })
    expect(delays).toEqual([2_000, 1_000])
    expect(events).toEqual([
      {
        event: 'maintenance_loop_started',
        taskQueue: 'appsea-source-maintenance-v1',
        state: 'running'
      },
      {
        event: 'maintenance_loop_pass_failed',
        taskQueue: 'appsea-source-maintenance-v1',
        attempt: 1,
        failureCode: 'APPSEA_MAINTENANCE_LOOP_PASS_FAILED'
      },
      {
        event: 'maintenance_loop_stopped',
        taskQueue: 'appsea-source-maintenance-v1',
        state: 'stopped',
        maintenancePasses: 1,
        maintenanceFailures: 1
      }
    ])
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does not start a pass after shutdown was requested', async () => {
    const controller = new AbortController()
    controller.abort()
    const runPass = vi.fn(async () => undefined)
    const result = await runMaintenanceLoop({
      taskQueue: 'appsea-source-maintenance-v1',
      intervalMs: 1_000,
      failureBackoffMs: 1_000,
      signal: controller.signal,
      runPass
    })

    expect(runPass).not.toHaveBeenCalled()
    expect(result).toEqual({ passes: 0, failures: 0 })
  })

  it('validates loop environment bounds', () => {
    expect(
      maintenanceLoopIntervalSecondsFromEnv({ APPSEA_MAINTENANCE_INTERVAL_SECONDS: '60' })
    ).toBe(60)
    expect(
      maintenanceLoopFailureBackoffSecondsFromEnv({
        APPSEA_MAINTENANCE_FAILURE_BACKOFF_SECONDS: '45'
      })
    ).toBe(45)
    expect(() =>
      maintenanceLoopIntervalSecondsFromEnv({ APPSEA_MAINTENANCE_INTERVAL_SECONDS: '9' })
    ).toThrow(/between 10 and 86400/)
    expect(() =>
      maintenanceLoopFailureBackoffSecondsFromEnv({
        APPSEA_MAINTENANCE_FAILURE_BACKOFF_SECONDS: '3601'
      })
    ).toThrow(/between 10 and 3600/)
  })
})
