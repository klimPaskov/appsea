import { describe, expect, it, vi } from 'vitest'
import {
  alertMaintenanceCommands,
  alertMaintenanceLoopFailureBackoffSecondsFromEnv,
  alertMaintenanceLoopIntervalSecondsFromEnv,
  runAlertMaintenanceLoop,
  runAlertMaintenancePass
} from './alert-maintenance-loop'

describe('alert maintenance loop', () => {
  it('runs every bounded child in order and continues after an inspector failure', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const runCommand = vi.fn(async (command: (typeof alertMaintenanceCommands)[number]) => {
      calls.push(command.name)
      if (command.name === 'source:health:alert') throw new Error('simulated failure')
    })

    await expect(runAlertMaintenancePass(controller.signal, runCommand)).rejects.toThrow(
      'alert maintenance command failed'
    )
    expect(calls).toEqual(alertMaintenanceCommands.map((command) => command.name))
    expect(runCommand).toHaveBeenCalledTimes(alertMaintenanceCommands.length)
  })

  it('retries a failed pass with bounded backoff and stops cleanly', async () => {
    const controller = new AbortController()
    const events: Array<Record<string, unknown>> = []
    const delays: number[] = []
    let passCount = 0
    const sleep = vi.fn(async (milliseconds: number) => {
      delays.push(milliseconds)
      if (delays.length === 2) controller.abort()
    })

    const result = await runAlertMaintenanceLoop({
      taskQueue: 'appsea-operational-alert-maintenance-v1',
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
        event: 'alerts_loop_started',
        taskQueue: 'appsea-operational-alert-maintenance-v1',
        state: 'running'
      },
      {
        event: 'alerts_loop_pass_failed',
        taskQueue: 'appsea-operational-alert-maintenance-v1',
        attempt: 1,
        failureCode: 'APPSEA_ALERTS_LOOP_PASS_FAILED'
      },
      {
        event: 'alerts_loop_stopped',
        taskQueue: 'appsea-operational-alert-maintenance-v1',
        state: 'stopped',
        maintenancePasses: 1,
        maintenanceFailures: 1
      }
    ])
  })

  it('does not start a pass after shutdown was requested', async () => {
    const controller = new AbortController()
    controller.abort()
    const runPass = vi.fn(async () => undefined)
    const result = await runAlertMaintenanceLoop({
      taskQueue: 'appsea-operational-alert-maintenance-v1',
      intervalMs: 1_000,
      failureBackoffMs: 1_000,
      signal: controller.signal,
      runPass
    })

    expect(runPass).not.toHaveBeenCalled()
    expect(result).toEqual({ passes: 0, failures: 0 })
  })

  it('validates alert-loop environment bounds', () => {
    expect(
      alertMaintenanceLoopIntervalSecondsFromEnv({ APPSEA_ALERTS_INTERVAL_SECONDS: '60' })
    ).toBe(60)
    expect(
      alertMaintenanceLoopFailureBackoffSecondsFromEnv({
        APPSEA_ALERTS_FAILURE_BACKOFF_SECONDS: '45'
      })
    ).toBe(45)
    expect(() =>
      alertMaintenanceLoopIntervalSecondsFromEnv({ APPSEA_ALERTS_INTERVAL_SECONDS: '9' })
    ).toThrow(/between 10 and 86400/)
    expect(() =>
      alertMaintenanceLoopFailureBackoffSecondsFromEnv({
        APPSEA_ALERTS_FAILURE_BACKOFF_SECONDS: '3601'
      })
    ).toThrow(/between 10 and 3600/)
  })
})
