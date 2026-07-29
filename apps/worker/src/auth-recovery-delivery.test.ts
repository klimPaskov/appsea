import { createCipheriv } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PasswordResetDeliveryRecord } from '@appsea/db'
import {
  AuthRecoveryDeliveryConfigurationError,
  createPasswordResetDeliveryClient,
  passwordResetUrl,
  verifyDeliverySignature
} from './auth-recovery-delivery'

function encryptedRecord(): PasswordResetDeliveryRecord {
  const key = Buffer.alloc(32, 9)
  const nonce = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update('a'.repeat(48), 'utf8'), cipher.final()])
  return {
    deliveryId: 'delivery:test',
    email: 'user@example.com',
    tokenCiphertext: ciphertext.toString('base64url'),
    tokenNonce: nonce.toString('base64url'),
    tokenTag: cipher.getAuthTag().toString('base64url'),
    expiresAt: '2026-07-24T00:30:00.000Z'
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('password recovery delivery boundary', () => {
  it('keeps the reset token in a fragment, never a query string', () => {
    const url = passwordResetUrl('https://appsea.example/', 'a'.repeat(48))
    expect(new URL(url).search).toBe('')
    expect(new URL(url).hash).toBe(`#token=${'a'.repeat(48)}`)
    expect(url).toContain('/reset-password#token=')
  })

  it('sends an HMAC-signed idempotent delivery with redirect blocking', async () => {
    const secret = Buffer.alloc(32, 5)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('APPSEA_PUBLIC_ORIGIN', 'http://localhost:3000')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_URL', 'http://gateway.test/send')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_SECRET', secret.toString('base64url'))
    vi.stubEnv('APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64url'))
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await createPasswordResetDeliveryClient().send(encryptedRecord())
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(endpoint)).toBe('http://gateway.test/send')
    expect(init.redirect).toBe('error')
    const body = String(init.body)
    const payload = JSON.parse(body) as { resetUrl: string; nonce: string; issuedAt: string }
    expect(new URL(payload.resetUrl).search).toBe('')
    expect(new URL(payload.resetUrl).hash).toMatch(/^#token=/)
    const headers = new Headers(init.headers)
    expect(headers.get('x-appsea-idempotency-key')).toBe('delivery:test')
    expect(
      verifyDeliverySignature(
        body,
        payload.issuedAt,
        payload.nonce,
        headers.get('x-appsea-signature') ?? '',
        secret
      )
    ).toBe(true)
  })

  it('fails closed for an HTTP provider in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APPSEA_PUBLIC_ORIGIN', 'https://appsea.example/')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_URL', 'http://gateway.example/send')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_SECRET', Buffer.alloc(32, 5).toString('base64url'))
    expect(() => createPasswordResetDeliveryClient()).toThrow(
      AuthRecoveryDeliveryConfigurationError
    )
  })
})
