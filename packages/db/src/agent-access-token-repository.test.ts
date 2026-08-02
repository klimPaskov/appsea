import type { Pool, PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { PostgresAgentAccessTokenRepository } from './agent-access-token-repository'

class FakeClient {
  readonly statements: Array<{ text: string; values: unknown[] }> = []

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.statements.push({ text, values })
    if (text.includes('FROM appsea.issue_agent_access_token')) {
      return {
        rows: [
          {
            token_id: 'agent-token:one',
            label: 'Build agent',
            scopes: ['opportunities:read', 'plans:read'],
            expires_at: '2026-09-01T00:00:00.000Z'
          }
        ]
      } as unknown as { rows: T[] }
    }
    if (text.includes('FROM appsea.list_agent_access_tokens')) {
      return {
        rows: [
          {
            token_id: 'agent-token:one',
            label: 'Build agent',
            scopes: ['opportunities:read'],
            created_at: '2026-08-01T00:00:00.000Z',
            expires_at: '2026-09-01T00:00:00.000Z',
            revoked_at: null,
            last_used_at: '2026-08-02T00:00:00.000Z'
          }
        ]
      } as unknown as { rows: T[] }
    }
    if (text.includes('authenticate_agent_access_token')) {
      return {
        rows: [
          {
            token_id: 'agent-token:one',
            workspace_id: 'workspace:one',
            user_id: 'user:owner',
            scopes: ['opportunities:read']
          }
        ]
      } as unknown as { rows: T[] }
    }
    if (text.includes('revoke_agent_access_token')) {
      return { rows: [{ revoked: true }] } as unknown as { rows: T[] }
    }
    if (
      text.includes('FROM appsea.workspace_memberships') ||
      text.includes('FROM appsea.workspaces')
    ) {
      return { rows: [{ membership: 1 }], rowCount: 1 } as unknown as { rows: T[] }
    }
    return { rows: [], rowCount: 0 } as unknown as { rows: T[] }
  }

  release(): void {}
}

function pool(client: FakeClient): Pool {
  return { connect: async () => client as unknown as PoolClient } as unknown as Pool
}

describe('agent access token repository', () => {
  it('creates a one-time token and never sends it to PostgreSQL', async () => {
    const client = new FakeClient()
    const repository = new PostgresAgentAccessTokenRepository(pool(client))
    const result = await repository.create('user:owner', 'workspace:one', {
      label: 'Build agent',
      scopes: ['plans:read', 'opportunities:read'],
      expiresInDays: 30
    })

    expect(result.token).toMatch(/^appsea_mcp_[A-Za-z0-9_-]+$/)
    expect(result.scopes).toEqual(['opportunities:read', 'plans:read'])
    const issue = client.statements.find((entry) => entry.text.includes('issue_agent_access_token'))
    expect(issue?.values).not.toContain(result.token)
    expect(String(issue?.values[3])).toHaveLength(64)
  })

  it('lists, authenticates, and revokes only bounded metadata', async () => {
    const client = new FakeClient()
    const repository = new PostgresAgentAccessTokenRepository(pool(client))
    await expect(repository.listForOwner('user:owner', 'workspace:one')).resolves.toMatchObject([
      { tokenId: 'agent-token:one', lastUsedAt: '2026-08-02T00:00:00.000Z' }
    ])
    await expect(repository.authenticate(`appsea_mcp_${'a'.repeat(48)}`)).resolves.toEqual({
      tokenId: 'agent-token:one',
      workspaceId: 'workspace:one',
      userId: 'user:owner',
      scopes: ['opportunities:read']
    })
    await expect(repository.authenticate('invalid')).resolves.toBeNull()
    await expect(repository.revoke('user:owner', 'workspace:one', 'agent-token:one')).resolves.toBe(
      true
    )
  })
})
