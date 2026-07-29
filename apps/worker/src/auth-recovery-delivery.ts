import { randomBytes } from 'node:crypto'
import type { PasswordResetDeliveryRecord } from '@appsea/db'
import { decryptPasswordResetDelivery } from '@appsea/db'
import {
  postSignedDelivery,
  signedDeliveryConfigFromEnv,
  verifyDeliverySignature
} from './signed-delivery'

export class AuthRecoveryDeliveryConfigurationError extends Error {
  constructor() {
    super('Password recovery delivery is not configured')
    this.name = 'AuthRecoveryDeliveryConfigurationError'
  }
}

export class AuthRecoveryDeliveryError extends Error {
  constructor() {
    super('Password recovery delivery failed')
    this.name = 'AuthRecoveryDeliveryError'
  }
}

export interface PasswordResetDeliveryClient {
  send(record: PasswordResetDeliveryRecord): Promise<void>
}

export function passwordResetUrl(origin: URL | string, token: string): string {
  const url = new URL('/reset-password', origin)
  url.search = ''
  url.hash = `token=${token}`
  return url.toString()
}

function fixedToken(record: PasswordResetDeliveryRecord): string {
  try {
    const token = decryptPasswordResetDelivery(record)
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('invalid token')
    return token
  } catch {
    throw new AuthRecoveryDeliveryError()
  }
}

export function createPasswordResetDeliveryClient(
  environment: NodeJS.ProcessEnv = process.env
): PasswordResetDeliveryClient {
  const config = signedDeliveryConfigFromEnv(
    environment,
    () => new AuthRecoveryDeliveryConfigurationError()
  )
  return {
    async send(record): Promise<void> {
      const token = fixedToken(record)
      const issuedAt = new Date().toISOString()
      const nonce = randomBytes(16).toString('base64url')
      const body = JSON.stringify({
        type: 'password_reset',
        deliveryId: record.deliveryId,
        email: record.email,
        resetUrl: passwordResetUrl(config.origin, token),
        expiresAt: record.expiresAt,
        issuedAt,
        nonce
      })
      await postSignedDelivery(
        config,
        record.deliveryId,
        body,
        issuedAt,
        nonce,
        () => new AuthRecoveryDeliveryError()
      )
    }
  }
}

export { verifyDeliverySignature }
