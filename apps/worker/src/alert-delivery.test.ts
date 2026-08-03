import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { operationalAlertPayloadSchema } from '@appsea/contracts'
import {
  deliverOperationalAlert,
  enqueueAndDeliverOperationalAlert,
  isOperationalAlertEvent,
  operationalAlertConfigFromEnv,
  operationalAlertDeliveryId
} from './alert-delivery'
import type { WorkerEventPayload } from './observability'

const secret = Buffer.alloc(32, 7).toString('base64url')

function payload(overrides: Partial<WorkerEventPayload> = {}): WorkerEventPayload {
  return {
    schemaVersion: 1,
    service: 'appsea-worker',
    observedAt: '2026-08-03T12:00:00.000Z',
    event: 'workspace_cost_alert',
    taskQueue: 'appsea-workspace-cost-alerts-v1',
    state: 'alert',
    ...overrides
  }
}

describe('operational alert delivery', () => {
  it('keeps routing opt-in and validates the signed endpoint configuration', () => {
    expect(operationalAlertConfigFromEnv({ NODE_ENV: 'development' })).toBeNull()
    expect(() =>
      operationalAlertConfigFromEnv({ NODE_ENV: 'production', APPSEA_ALERT_ROUTING_ENABLED: 'yes' })
    ).toThrow()
    expect(() =>
      operationalAlertConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_ALERT_ROUTING_ENABLED: 'true',
        APPSEA_ALERT_ROUTING_URL: 'http://localhost/alerts',
        APPSEA_ALERT_ROUTING_SECRET: secret
      })
    ).toThrow()
  })

  it('signs a bounded payload and retries transient provider failures', async () => {
    const requests: RequestInit[] = []
    const responses = [503, 204]
    const fetchImpl = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push(init)
      return new Response(null, { status: responses.shift() ?? 204 })
    }
    const config = operationalAlertConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_ALERT_ROUTING_ENABLED: 'true',
      APPSEA_ALERT_ROUTING_URL: 'https://alerts.internal/appsea',
      APPSEA_ALERT_ROUTING_SECRET: secret
    })
    if (!config) throw new Error('expected alert config')

    await expect(
      deliverOperationalAlert(payload(), {
        config,
        fetchImpl,
        now: () => new Date('2026-08-03T12:01:02.000Z')
      })
    ).resolves.toBe('sent')
    expect(requests).toHaveLength(2)
    const firstHeaders = new Headers(requests[0]?.headers)
    const secondHeaders = new Headers(requests[1]?.headers)
    expect(firstHeaders.get('x-appsea-alert-id')).toBe(secondHeaders.get('x-appsea-alert-id'))
    expect(firstHeaders.get('x-appsea-idempotency-key')).toBe(firstHeaders.get('x-appsea-alert-id'))
    expect(firstHeaders.get('x-appsea-signature')).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(requests[0]?.redirect).toBe('error')
    const body = String(requests[0]?.body)
    expect(JSON.parse(body)).toMatchObject({
      schemaVersion: 1,
      kind: 'appsea.operational_alert',
      event: payload()
    })
    const expected = createHmac('sha256', Buffer.from(secret, 'base64url'))
      .update(
        `${firstHeaders.get('x-appsea-request-timestamp')}.${firstHeaders.get('x-appsea-request-nonce')}.${body}`
      )
      .digest('hex')
    expect(firstHeaders.get('x-appsea-signature')).toBe(`sha256=${expected}`)
  })

  it('does not send clear events and fails closed after bounded retries', async () => {
    expect(
      isOperationalAlertEvent(payload({ event: 'workspace_cost_clear', state: 'clear' }))
    ).toBe(false)
    expect(isOperationalAlertEvent(payload({ event: 'workspace_cost_alert_incomplete' }))).toBe(
      true
    )
    const config = operationalAlertConfigFromEnv({
      NODE_ENV: 'development',
      APPSEA_ALERT_ROUTING_ENABLED: 'true',
      APPSEA_ALERT_ROUTING_URL: 'http://127.0.0.1:8787/alerts',
      APPSEA_ALERT_ROUTING_SECRET: secret
    })
    if (!config) throw new Error('expected alert config')
    await expect(
      deliverOperationalAlert(payload(), {
        config,
        fetchImpl: async () => new Response(null, { status: 500 }),
        maxAttempts: 2
      })
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('persists before delivery and completes the same claim idempotently', async () => {
    const config = operationalAlertConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_ALERT_ROUTING_ENABLED: 'true',
      APPSEA_ALERT_ROUTING_URL: 'https://alerts.internal/appsea',
      APPSEA_ALERT_ROUTING_SECRET: secret
    })
    if (!config) throw new Error('expected alert config')
    const expectedDeliveryId = operationalAlertDeliveryId(payload())
    const storedPayload = operationalAlertPayloadSchema.parse(payload())
    const outbox = {
      enqueue: vi.fn(async () => ({ enqueued: true })),
      claim: vi.fn(async ({ claimId }: { claimId: string }) => [
        {
          deliveryId: expectedDeliveryId,
          payload: storedPayload,
          attemptCount: 1,
          claimId,
          claimedBy: 'worker:alerts:one',
          claimExpiresAt: '2026-08-03T12:05:00.000Z'
        }
      ]),
      complete: vi.fn(async () => ({ completed: true })),
      fail: vi.fn(async () => ({ applied: true, state: 'pending' as const }))
    }
    const requests: RequestInit[] = []
    await expect(
      enqueueAndDeliverOperationalAlert(payload(), {
        outbox,
        ownerId: 'worker:alerts:one',
        config,
        fetchImpl: async (_input, init = {}) => {
          requests.push(init)
          return new Response(null, { status: 204 })
        },
        now: () => new Date('2026-08-03T12:01:02.000Z')
      })
    ).resolves.toBe('sent')
    expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(outbox.claim).toHaveBeenCalledTimes(1)
    expect(outbox.complete).toHaveBeenCalledTimes(1)
    expect(outbox.fail).not.toHaveBeenCalled()
    expect(new Headers(requests[0]?.headers).get('x-appsea-alert-id')).toBe(expectedDeliveryId)
  })
})
