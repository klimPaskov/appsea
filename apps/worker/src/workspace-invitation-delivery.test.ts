import { createCipheriv } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceInvitationDeliveryRecord } from '@appsea/db'
import {
  WorkspaceInvitationDeliveryConfigurationError,
  createWorkspaceInvitationDeliveryClient,
  workspaceInvitationUrl
} from './workspace-invitation-delivery'
import { verifyDeliverySignature } from './signed-delivery'

function encryptedRecord(): WorkspaceInvitationDeliveryRecord {
  const key = Buffer.alloc(32, 9)
  const nonce = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update('a'.repeat(48), 'utf8'), cipher.final()])
  return {
    deliveryId: 'delivery:invite',
    invitationId: 'invite:test',
    workspaceId: 'workspace:one',
    email: 'user@example.com',
    tokenCiphertext: ciphertext.toString('base64url'),
    tokenNonce: nonce.toString('base64url'),
    tokenTag: cipher.getAuthTag().toString('base64url'),
    role: 'editor',
    expiresAt: '2099-07-24T00:30:00.000Z'
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('workspace invitation delivery boundary', () => {
  it('keeps invitation tokens in a fragment', () => {
    const url = workspaceInvitationUrl('https://appsea.example/', 'a'.repeat(48))
    expect(new URL(url).search).toBe('')
    expect(new URL(url).hash).toBe(`#token=${'a'.repeat(48)}`)
    expect(url).toContain('/invite#token=')
  })

  it('sends a signed, idempotent role-scoped delivery', async () => {
    const secret = Buffer.alloc(32, 5)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('APPSEA_PUBLIC_ORIGIN', 'http://localhost:3000')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_URL', 'http://gateway.test/send')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_SECRET', secret.toString('base64url'))
    vi.stubEnv('APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64url'))
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await createWorkspaceInvitationDeliveryClient().send(encryptedRecord())
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(endpoint)).toBe('http://gateway.test/send')
    expect(init.redirect).toBe('error')
    const body = String(init.body)
    const payload = JSON.parse(body) as { inviteUrl: string; nonce: string; issuedAt: string }
    expect(new URL(payload.inviteUrl).search).toBe('')
    expect(new URL(payload.inviteUrl).hash).toMatch(/^#token=/)
    const headers = new Headers(init.headers)
    expect(headers.get('x-appsea-idempotency-key')).toBe('delivery:invite')
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

  it('requires HTTPS for production delivery', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APPSEA_PUBLIC_ORIGIN', 'https://appsea.example/')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_URL', 'http://gateway.example/send')
    vi.stubEnv('APPSEA_AUTH_RECOVERY_DELIVERY_SECRET', Buffer.alloc(32, 5).toString('base64url'))
    expect(() => createWorkspaceInvitationDeliveryClient()).toThrow(
      WorkspaceInvitationDeliveryConfigurationError
    )
  })
})
