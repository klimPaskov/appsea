import { randomBytes } from 'node:crypto'
import type { Pool, QueryResultRow } from 'pg'
import {
  agentAccessAdmissionResultSchema,
  agentAccessTokenAuthenticationSchema,
  agentAccessTokenCreateInputSchema,
  agentAccessTokenCreateResultSchema,
  agentAccessTokenReadModelSchema,
  agentAccessTokenSchema,
  appseaIdentifierSchema,
  type AgentAccessTokenAuthentication,
  type AgentAccessAdmissionResult,
  type AgentAccessTokenCreateInput,
  type AgentAccessTokenCreateResult,
  type AgentAccessTokenReadModel
} from '@appsea/contracts'
import { sha256 } from './hash'
import { withAuthenticatedWorkspaceTransaction, withDatabaseTransaction } from './transaction'

interface CreatedTokenRow extends QueryResultRow {
  token_id: string
  label: string
  scopes: string[]
  expires_at: Date | string
}

interface TokenRow extends QueryResultRow {
  token_id: string
  label: string
  scopes: string[]
  created_at: Date | string
  expires_at: Date | string
  revoked_at: Date | string | null
  last_used_at: Date | string | null
}

interface AuthenticatedTokenRow extends QueryResultRow {
  token_id: string
  workspace_id: string
  user_id: string
  scopes: string[]
}

interface AdmissionRow extends QueryResultRow {
  admitted: boolean
  reason: string
  retry_after_seconds: number
  admission_id: string | null
}

export const agentAccessAdmissionLimits = {
  requestsPerWindow: 60,
  windowSeconds: 60,
  maxConcurrent: 4,
  leaseSeconds: 30
} as const

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function rawToken(): string {
  return `appsea_mcp_${randomBytes(48).toString('base64url')}`
}

function mapCreated(row: CreatedTokenRow, token: string): AgentAccessTokenCreateResult {
  return agentAccessTokenCreateResultSchema.parse({
    tokenId: row.token_id,
    label: row.label,
    scopes: row.scopes,
    expiresAt: iso(row.expires_at),
    token
  })
}

function mapToken(row: TokenRow): AgentAccessTokenReadModel {
  return agentAccessTokenReadModelSchema.parse({
    tokenId: row.token_id,
    label: row.label,
    scopes: row.scopes,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    lastUsedAt: row.last_used_at === null ? null : iso(row.last_used_at)
  })
}

export class PostgresAgentAccessTokenRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    userId: string,
    workspaceId: string,
    input: AgentAccessTokenCreateInput
  ): Promise<AgentAccessTokenCreateResult> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInput = agentAccessTokenCreateInputSchema.parse(input)
    const token = agentAccessTokenSchema.parse(rawToken())
    const tokenId = `agent-token:${randomBytes(12).toString('hex')}`
    const expiresAt = new Date(Date.now() + parsedInput.expiresInDays * 24 * 60 * 60 * 1_000)

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<CreatedTokenRow>(
          `SELECT token_id, label, scopes, expires_at
             FROM appsea.issue_agent_access_token($1, $2, $3, $4, $5, $6::text[], $7::timestamptz)`,
          [
            parsedWorkspaceId,
            parsedUserId,
            tokenId,
            sha256(token),
            parsedInput.label,
            [...parsedInput.scopes].sort(),
            expiresAt.toISOString()
          ]
        )
        const row = result.rows[0]
        if (!row) throw new Error('Agent access token was not created')
        return mapCreated(row, token)
      },
      { isolationLevel: 'SERIALIZABLE', maxSerializationRetries: 0 }
    )
  }

  async listForOwner(userId: string, workspaceId: string): Promise<AgentAccessTokenReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<TokenRow>(
          `SELECT token_id, label, scopes, created_at, expires_at, revoked_at, last_used_at
             FROM appsea.list_agent_access_tokens($1, $2)`,
          [parsedWorkspaceId, parsedUserId]
        )
        return result.rows.map(mapToken)
      },
      { readOnly: true }
    )
  }

  async revoke(userId: string, workspaceId: string, tokenId: string): Promise<boolean> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedTokenId = appseaIdentifierSchema.parse(tokenId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ revoked: boolean }>(
          `SELECT appsea.revoke_agent_access_token($1, $2, $3) AS revoked`,
          [parsedWorkspaceId, parsedUserId, parsedTokenId]
        )
        return result.rows[0]?.revoked === true
      },
      { isolationLevel: 'SERIALIZABLE', maxSerializationRetries: 0 }
    )
  }

  /** Authenticate a raw MCP bearer and return only its scoped identity. */
  async authenticate(token: string): Promise<AgentAccessTokenAuthentication | null> {
    const parsedToken = agentAccessTokenSchema.safeParse(token)
    if (!parsedToken.success) return null
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<AuthenticatedTokenRow>(
        `SELECT token_id, workspace_id, user_id, scopes
             FROM appsea.authenticate_agent_access_token($1)`,
        [sha256(parsedToken.data)]
      )
      const row = result.rows[0]
      if (!row) return null
      return agentAccessTokenAuthenticationSchema.parse({
        tokenId: row.token_id,
        workspaceId: row.workspace_id,
        userId: row.user_id,
        scopes: row.scopes
      })
    })
  }

  async admitRequest(
    authentication: AgentAccessTokenAuthentication
  ): Promise<AgentAccessAdmissionResult> {
    const parsedAuthentication = agentAccessTokenAuthenticationSchema.parse(authentication)
    const admissionId = `mcp-admission:${randomBytes(24).toString('hex')}`
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<AdmissionRow>(
        `SELECT admitted, reason, retry_after_seconds, admission_id
           FROM appsea.admit_agent_access_request($1, $2, $3, $4)`,
        [
          parsedAuthentication.tokenId,
          parsedAuthentication.workspaceId,
          parsedAuthentication.userId,
          admissionId
        ]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Agent access request admission returned no decision')
      return agentAccessAdmissionResultSchema.parse({
        admitted: row.admitted,
        reason: row.reason,
        retryAfterSeconds: row.retry_after_seconds,
        admissionId: row.admission_id
      })
    })
  }

  async releaseRequest(
    authentication: AgentAccessTokenAuthentication,
    admissionId: string
  ): Promise<boolean> {
    const parsedAuthentication = agentAccessTokenAuthenticationSchema.parse(authentication)
    const parsedAdmissionId = appseaIdentifierSchema.parse(admissionId)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ released: boolean }>(
        `SELECT appsea.release_agent_access_request($1, $2, $3, $4) AS released`,
        [
          parsedAuthentication.tokenId,
          parsedAuthentication.workspaceId,
          parsedAuthentication.userId,
          parsedAdmissionId
        ]
      )
      return result.rows[0]?.released === true
    })
  }
}
