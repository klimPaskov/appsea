import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  operationalAlertPayloadSchema,
  type OperationalAlertOutboxClaim,
  type OperationalAlertOutboxCompleteInput,
  type OperationalAlertOutboxEnqueueInput,
  type OperationalAlertOutboxFailureInput
} from '@appsea/contracts'
import { requiredDeliveryUrl } from './signed-delivery'
import type { WorkerEventPayload } from './observability'

export interface OperationalAlertConfig {
  endpoint: URL
  secret: Buffer
}

export interface OperationalAlertDeliveryOptions {
  config?: OperationalAlertConfig | null
  environment?: NodeJS.ProcessEnv
  fetchImpl?: typeof globalThis.fetch
  now?: () => Date
  maxAttempts?: number
}

export interface OperationalAlertOutboxStore {
  enqueue(input: OperationalAlertOutboxEnqueueInput): Promise<{ enqueued: boolean }>
  claim(input: {
    ownerId: string
    claimId: string
    limit: number
    claimTtlSeconds: number
  }): Promise<OperationalAlertOutboxClaim[]>
  complete(input: OperationalAlertOutboxCompleteInput): Promise<{ completed: boolean }>
  fail(input: OperationalAlertOutboxFailureInput): Promise<{
    applied: boolean
    state: 'pending' | 'sending' | 'sent' | 'exhausted' | null
  }>
}

export class OperationalAlertDeliveryError extends Error {
  constructor(readonly code: 'configuration' | 'unavailable') {
    super('Operational alert delivery failed')
    this.name = 'OperationalAlertDeliveryError'
  }
}

function configurationError(): OperationalAlertDeliveryError {
  return new OperationalAlertDeliveryError('configuration')
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function enabled(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.APPSEA_ALERT_ROUTING_ENABLED?.trim() ?? 'false'
  if (value === 'true') return true
  if (value === 'false' || value === '') return false
  throw configurationError()
}

/**
 * Read the separately operated incident endpoint without contacting it. The
 * switch is deliberately opt-in so local fixture runs never send alerts.
 */
export function operationalAlertConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
  errorFactory: () => Error = configurationError
): OperationalAlertConfig | null {
  if (!enabled(environment)) return null
  const production = environment.NODE_ENV === 'production'
  const endpoint = requiredDeliveryUrl(
    environment.APPSEA_ALERT_ROUTING_URL,
    'endpoint',
    production,
    errorFactory
  )
  if (production && isLoopbackHost(endpoint.hostname)) throw errorFactory()
  const encodedSecret = environment.APPSEA_ALERT_ROUTING_SECRET ?? ''
  if (!/^[A-Za-z0-9_-]{43,}$/.test(encodedSecret)) throw errorFactory()
  const secret = Buffer.from(encodedSecret, 'base64url')
  if (secret.length < 32) throw errorFactory()
  return { endpoint, secret }
}

function stablePayload(payload: WorkerEventPayload): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'observedAt'))
}

function deliveryBucket(payload: WorkerEventPayload): number {
  const observedAt = Date.parse(payload.observedAt)
  return Number.isFinite(observedAt) ? Math.floor(observedAt / 300_000) : 0
}

export function operationalAlertDeliveryId(payload: WorkerEventPayload): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ bucket: deliveryBucket(payload), payload: stablePayload(payload) }))
    .digest('hex')
  return `alert:${digest.slice(0, 32)}`
}

export function operationalAlertPayloadHash(payload: WorkerEventPayload): string {
  return createHash('sha256')
    .update(JSON.stringify({ bucket: deliveryBucket(payload), payload: stablePayload(payload) }))
    .digest('hex')
}

function validDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new OperationalAlertDeliveryError('configuration')
  return value.toISOString()
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/**
 * Deliver one bounded, secret-free worker event. The idempotency key remains
 * stable across immediate retries and the scheduler can safely retry the
 * command after a provider outage.
 */
export async function deliverOperationalAlert(
  payload: WorkerEventPayload,
  options: OperationalAlertDeliveryOptions = {}
): Promise<'disabled' | 'sent'> {
  const environment = options.environment ?? process.env
  const config =
    options.config === undefined
      ? operationalAlertConfigFromEnv(environment, configurationError)
      : options.config
  if (!config) return 'disabled'
  const maxAttempts = options.maxAttempts ?? 3
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new OperationalAlertDeliveryError('configuration')
  }
  const now = validDate((options.now ?? (() => new Date()))())
  const id = operationalAlertDeliveryId(payload)
  const body = JSON.stringify({
    schemaVersion: 1,
    kind: 'appsea.operational_alert',
    deliveryId: id,
    observedAt: payload.observedAt,
    event: payload
  })
  const nonce = randomUUID()
  const signature = createHmac('sha256', config.secret)
    .update(`${now}.${nonce}.${body}`)
    .digest('hex')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-appsea-alert-version': '1',
          'x-appsea-alert-id': id,
          'x-appsea-idempotency-key': id,
          'x-appsea-request-timestamp': now,
          'x-appsea-request-nonce': nonce,
          'x-appsea-signature': `sha256=${signature}`
        },
        body
      })
      if (response.ok) return 'sent'
      if (!retryableStatus(response.status) || attempt === maxAttempts) break
    } catch {
      if (attempt === maxAttempts) break
    }
  }
  throw new OperationalAlertDeliveryError('unavailable')
}

export interface DurableOperationalAlertDeliveryOptions extends OperationalAlertDeliveryOptions {
  outbox: OperationalAlertOutboxStore
  ownerId: string
  claimTtlSeconds?: number
}

/**
 * Persist an alert before attempting delivery. If the process or provider
 * fails, the claim remains retryable and the same idempotency key is reused.
 * The caller may surface the delivery error so its scheduler records failure;
 * the outbox is the durable retry evidence.
 */
export async function enqueueAndDeliverOperationalAlert(
  payload: WorkerEventPayload,
  options: DurableOperationalAlertDeliveryOptions
): Promise<'disabled' | 'sent' | 'queued'> {
  const environment = options.environment ?? process.env
  const config =
    options.config === undefined
      ? operationalAlertConfigFromEnv(environment, configurationError)
      : options.config
  if (!config) return 'disabled'

  const parsedPayload = operationalAlertPayloadSchema.parse(payload)
  const deliveryId = operationalAlertDeliveryId(payload)
  await options.outbox.enqueue({
    deliveryId,
    payload: parsedPayload,
    payloadHash: operationalAlertPayloadHash(payload),
    availableAt: validDate((options.now ?? (() => new Date()))())
  })

  const claimId = randomUUID()
  const claims = await options.outbox.claim({
    ownerId: options.ownerId,
    claimId,
    limit: 1,
    claimTtlSeconds: options.claimTtlSeconds ?? 300
  })
  const claim = claims.find((candidate) => candidate.deliveryId === deliveryId)
  if (!claim) return 'queued'

  try {
    await deliverOperationalAlert(claim.payload, { ...options, config })
    const completed = await options.outbox.complete({
      deliveryId: claim.deliveryId,
      ownerId: claim.claimedBy,
      claimId: claim.claimId,
      sentAt: new Date().toISOString()
    })
    if (!completed.completed) throw new OperationalAlertDeliveryError('unavailable')
    return 'sent'
  } catch (error) {
    const attemptDelayMs = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, claim.attemptCount - 1))
    const failureCode =
      error instanceof OperationalAlertDeliveryError && error.code === 'configuration'
        ? 'APPSEA_ALERT_DELIVERY_CONFIGURATION'
        : 'APPSEA_ALERT_DELIVERY_FAILED'
    await options.outbox.fail({
      deliveryId: claim.deliveryId,
      ownerId: claim.claimedBy,
      claimId: claim.claimId,
      failureCode,
      retryAt: new Date(Date.now() + attemptDelayMs).toISOString()
    })
    throw error
  }
}

export function isOperationalAlertEvent(payload: WorkerEventPayload): boolean {
  return (
    payload.event.endsWith('_alert') ||
    payload.event.endsWith('_incomplete') ||
    payload.event.endsWith('_failed')
  )
}
