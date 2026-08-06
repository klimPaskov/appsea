import { describe, expect, it } from 'vitest'
import {
  operationalAlertStatusEnabled,
  operationalAlertStatusEvent,
  operationalAlertStatusInputFromEnv,
  operationalAlertStatusTaskQueue
} from './operational-alert-status'

const result = {
  observedAt: '2026-08-06T00:00:00.000Z',
  pendingCount: 2,
  sendingCount: 1,
  exhaustedCount: 0,
  oldestOpenAgeSeconds: 301,
  truncated: false,
  state: 'alert' as const
}

describe('operational alert outbox status', () => {
  it('requires explicit production enablement but is available in local test runs', () => {
    expect(operationalAlertStatusEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(
      operationalAlertStatusEnabled({
        NODE_ENV: 'production',
        APPSEA_OPERATIONAL_ALERT_STATUS_ENABLED: 'true'
      })
    ).toBe(true)
    expect(operationalAlertStatusEnabled({ NODE_ENV: 'test' })).toBe(true)
  })

  it('parses bounded status settings from the environment', () => {
    expect(
      operationalAlertStatusInputFromEnv({
        NODE_ENV: 'test',
        APPSEA_OPERATIONAL_ALERT_STATUS_LIMIT: '25',
        APPSEA_OPERATIONAL_ALERT_STATUS_ALERT_AFTER_SECONDS: '90'
      })
    ).toEqual({ limit: 25, alertAfterSeconds: 90 })
    expect(() =>
      operationalAlertStatusInputFromEnv({
        NODE_ENV: 'test',
        APPSEA_OPERATIONAL_ALERT_STATUS_LIMIT: '0'
      })
    ).toThrow()
  })

  it('maps status states to fixed event names and task queues', () => {
    expect(operationalAlertStatusTaskQueue).toBe('appsea-operational-alert-status-v1')
    expect(operationalAlertStatusEvent(result)).toBe('operational_alert_outbox_alert')
    expect(operationalAlertStatusEvent({ ...result, state: 'incomplete' })).toBe(
      'operational_alert_outbox_incomplete'
    )
    expect(operationalAlertStatusEvent({ ...result, state: 'clear' })).toBe(
      'operational_alert_outbox_clear'
    )
  })
})
