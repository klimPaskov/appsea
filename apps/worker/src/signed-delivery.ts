import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedDeliveryConfig {
  origin: URL
  endpoint: URL
  secret: Buffer
}

export function requiredDeliveryUrl(
  value: string | undefined,
  name: 'origin' | 'endpoint',
  production: boolean,
  configurationError: () => Error
): URL {
  if (!value) throw configurationError()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw configurationError()
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (production && parsed.protocol !== 'https:')
  ) {
    throw configurationError()
  }
  if (name === 'origin' && parsed.pathname !== '/') throw configurationError()
  return parsed
}

export function signedDeliveryConfigFromEnv(
  environment: NodeJS.ProcessEnv,
  configurationError: () => Error
): SignedDeliveryConfig {
  const production = environment.NODE_ENV === 'production'
  const origin = requiredDeliveryUrl(
    environment.APPSEA_PUBLIC_ORIGIN,
    'origin',
    production,
    configurationError
  )
  const endpoint = requiredDeliveryUrl(
    environment.APPSEA_AUTH_RECOVERY_DELIVERY_URL,
    'endpoint',
    production,
    configurationError
  )
  const encodedSecret = environment.APPSEA_AUTH_RECOVERY_DELIVERY_SECRET ?? ''
  if (!/^[A-Za-z0-9_-]{43,}$/.test(encodedSecret)) throw configurationError()
  const secret = Buffer.from(encodedSecret, 'base64url')
  if (secret.length < 32) throw configurationError()
  return { origin, endpoint, secret }
}

export async function postSignedDelivery(
  config: SignedDeliveryConfig,
  deliveryId: string,
  body: string,
  issuedAt: string,
  nonce: string,
  deliveryError: () => Error
): Promise<void> {
  const signature = createHmac('sha256', config.secret)
    .update(`${issuedAt}.${nonce}.${body}`)
    .digest('hex')
  let response: Response
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-appsea-delivery-version': '1',
        'x-appsea-delivery-id': deliveryId,
        'x-appsea-idempotency-key': deliveryId,
        'x-appsea-request-timestamp': issuedAt,
        'x-appsea-request-nonce': nonce,
        'x-appsea-signature': `sha256=${signature}`
      },
      body
    })
  } catch {
    throw deliveryError()
  }
  if (!response.ok) throw deliveryError()
}

export function verifyDeliverySignature(
  body: string,
  issuedAt: string,
  nonce: string,
  signature: string,
  secret: Buffer
): boolean {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const expected = createHmac('sha256', secret).update(`${issuedAt}.${nonce}.${body}`).digest()
  const provided = Buffer.from(signature.slice('sha256='.length), 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
