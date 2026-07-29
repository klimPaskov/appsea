import { randomBytes } from 'node:crypto'
import type { WorkspaceInvitationDeliveryRecord } from '@appsea/db'
import { decryptPasswordResetDelivery } from '@appsea/db'
import {
  postSignedDelivery,
  signedDeliveryConfigFromEnv,
  type SignedDeliveryConfig
} from './signed-delivery'

export class WorkspaceInvitationDeliveryConfigurationError extends Error {
  constructor() {
    super('Workspace invitation delivery is not configured')
    this.name = 'WorkspaceInvitationDeliveryConfigurationError'
  }
}

export class WorkspaceInvitationDeliveryError extends Error {
  constructor() {
    super('Workspace invitation delivery failed')
    this.name = 'WorkspaceInvitationDeliveryError'
  }
}

export interface WorkspaceInvitationDeliveryClient {
  send(record: WorkspaceInvitationDeliveryRecord): Promise<void>
}

export function workspaceInvitationUrl(origin: URL | string, token: string): string {
  const url = new URL('/invite', origin)
  url.search = ''
  url.hash = `token=${token}`
  return url.toString()
}

function fixedToken(record: WorkspaceInvitationDeliveryRecord): string {
  try {
    const token = decryptPasswordResetDelivery(record)
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('invalid token')
    return token
  } catch {
    throw new WorkspaceInvitationDeliveryError()
  }
}

function configFromEnv(environment: NodeJS.ProcessEnv = process.env): SignedDeliveryConfig {
  return signedDeliveryConfigFromEnv(
    environment,
    () => new WorkspaceInvitationDeliveryConfigurationError()
  )
}

export function createWorkspaceInvitationDeliveryClient(
  environment: NodeJS.ProcessEnv = process.env
): WorkspaceInvitationDeliveryClient {
  const config = configFromEnv(environment)
  return {
    async send(record): Promise<void> {
      const token = fixedToken(record)
      const issuedAt = new Date().toISOString()
      const nonce = randomBytes(16).toString('base64url')
      const body = JSON.stringify({
        type: 'workspace_invitation',
        deliveryId: record.deliveryId,
        workspaceId: record.workspaceId,
        role: record.role,
        email: record.email,
        inviteUrl: workspaceInvitationUrl(config.origin, token),
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
        () => new WorkspaceInvitationDeliveryError()
      )
    }
  }
}
