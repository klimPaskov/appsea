import { promisify } from 'node:util'
import { scrypt as scryptCallback } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { InMemoryObjectStore } from '@appsea/object-store'
import {
  generateOpportunityReport,
  storeOpportunityReport,
  storePlanPackage
} from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'
import {
  AuthSessionConflictError,
  AuthSessionNotFoundError,
  AuthenticationError,
  AuthPasswordResetError,
  PostgresAuthRepository,
  WorkspaceMembershipConflictError,
  WorkspaceMembershipManagementError,
  WorkspaceAuthorizationError,
  WorkspacePlanNotApprovedError,
  WorkspacePurgeRequestNotReadyError,
  WorkspacePurgeRequestPermissionError
} from './auth-repository'
import type { AuthAccountDeletionBlockedError } from './auth-repository'
import { sha256 } from './hash'

const scrypt = promisify(scryptCallback) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

async function storedPassword(password: string): Promise<string> {
  const salt = Buffer.alloc(16, 7)
  const digest = await scrypt(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024
  })
  return `scrypt$16384$8$1$${salt.toString('hex')}$${digest.toString('hex')}`
}

function fakePool(options: { session?: boolean; expired?: boolean } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.users')) {
        return {
          rows: [
            {
              user_id: 'user:one',
              email: 'user@example.com',
              display_name: 'Example User',
              password_hash: await storedPassword('correct horse battery staple'),
              created_at: '2026-07-24T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('FROM appsea.auth_sessions')) {
        if (options.session === false || options.expired) return { rows: [], rowCount: 0 }
        return {
          rows: [
            {
              session_id: 'session:one',
              user_id: 'user:one',
              email: 'user@example.com',
              display_name: 'Example User',
              user_created_at: '2026-07-24T00:00:00.000Z',
              expires_at: '2026-08-24T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('INSERT INTO appsea.auth_rate_limits')) {
        return { rows: [{ attempt_count: 1 }], rowCount: 1 }
      }
      if (text.includes('SELECT workspace_id, role')) {
        return { rows: [{ workspace_id: 'workspace:one', role: 'owner' }], rowCount: 1 }
      }
      if (text.includes('SELECT role')) return { rows: [{ role: 'owner' }], rowCount: 1 }
      if (text.includes('FROM appsea.workspace_memberships') && text.includes('FOR SHARE')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces')) {
        return {
          rows: [
            {
              workspace_id: 'workspace:one',
              slug: 'private-workspace',
              display_name: 'Private workspace',
              visibility: 'private',
              fixture_only: false,
              role: 'owner'
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  const pool = {
    connect: async () => client
  } as unknown as Pool
  return { pool, statements }
}

function objectBackedReportPool(reference: { uri: string; contentHash: string }): Pool {
  const client = {
    query: async (text: string) => {
      if (text.startsWith('BEGIN') || text === 'COMMIT') return { rows: [], rowCount: 0 }
      if (text.includes('set_config')) return { rows: [], rowCount: 0 }
      if (text.includes('FROM appsea.workspace_memberships')) {
        return { rows: [{ user_id: 'user:one', role: 'owner' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces'))
        return { rows: [{ workspace_id: 'workspace:one' }], rowCount: 1 }
      if (text.includes('FROM appsea.report_versions')) {
        return {
          rows: [
            {
              report_id: 'report:production',
              version: 'production-report-v1',
              structured_report: { objectRef: reference.uri },
              structured_object_ref: reference.uri,
              analysis_report_object_ref: {
                version: 1,
                uri: reference.uri,
                workspaceId: 'workspace:one',
                kind: 'report-json',
                contentHash: reference.contentHash,
                byteLength: 1,
                contentType: 'application/json; charset=utf-8',
                createdAt: '2026-07-24T00:00:00.000Z',
                retentionUntil: null,
                deletionState: 'active',
                deletedAt: null,
                deletionReason: null
              },
              generated_at: '2026-07-24T00:00:00.000Z',
              approval_state: 'approved',
              manifest_hash: reference.contentHash,
              deletion_state: 'active',
              synthetic: false
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return { connect: async () => client } as unknown as Pool
}

function objectBackedPlanPool(
  reference: { uri: string; contentHash: string },
  approvalState: 'unreviewed' | 'reviewed' | 'approved' = 'approved'
): Pool {
  const client = {
    query: async (text: string) => {
      if (text.startsWith('BEGIN') || text === 'COMMIT') return { rows: [], rowCount: 0 }
      if (text.includes('set_config')) return { rows: [], rowCount: 0 }
      if (text.includes('FROM appsea.workspace_memberships')) {
        return { rows: [{ user_id: 'user:one', role: 'owner' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces'))
        return { rows: [{ workspace_id: 'workspace:one' }], rowCount: 1 }
      if (text.includes('FROM appsea.plan_package_versions')) {
        return {
          rows: [
            {
              plan_package_id: 'plan:production',
              report_id: null,
              version: 'production-plan-v1',
              fixture_files: null,
              package_object_ref: reference.uri,
              analysis_plan_object_ref: {
                version: 1,
                uri: reference.uri,
                workspaceId: 'workspace:one',
                kind: 'plan-package',
                contentHash: reference.contentHash,
                byteLength: 1,
                contentType: 'application/json',
                createdAt: '2026-07-24T00:00:00.000Z',
                retentionUntil: null,
                deletionState: 'active',
                deletedAt: null,
                deletionReason: null
              },
              generated_at: '2026-07-24T00:00:00.000Z',
              readiness_state: 'ready',
              approval_state: approvalState,
              synthetic: false,
              deletion_state: 'active',
              manifest_hash: reference.contentHash,
              opportunity_slug: 'private-opportunity'
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return { connect: async () => client } as unknown as Pool
}

function membershipAdminPool(
  options: {
    actorRole?: 'owner' | 'editor' | 'viewer'
    targetRole?: 'owner' | 'editor' | 'viewer'
    targetUserId?: string
    includeTarget?: boolean
    additionalOwner?: boolean
  } = {}
): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  let actorRole = options.actorRole ?? 'owner'
  let targetRole = options.targetRole ?? 'editor'
  const targetUserId = options.targetUserId ?? 'user:member'
  const includeTarget = options.includeTarget ?? true
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FOR SHARE')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
      if (text.includes('ANY($2::text[])')) {
        const rows = [{ user_id: 'user:owner', role: actorRole }]
        if (includeTarget && targetUserId !== 'user:owner') {
          rows.push({ user_id: targetUserId, role: targetRole })
        }
        if (options.additionalOwner) rows.push({ user_id: 'user:other-owner', role: 'owner' })
        return { rows, rowCount: rows.length }
      }
      if (text.includes('JOIN appsea.users')) {
        const userId = String(values[1] ?? targetUserId)
        const role = userId === 'user:owner' ? actorRole : targetRole
        return {
          rows: [
            {
              user_id: userId,
              email: `${userId.replace(':', '-')}@example.com`,
              display_name: userId === 'user:owner' ? 'Owner' : 'Member',
              role,
              created_at: '2026-07-24T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('UPDATE appsea.workspace_memberships')) {
        const nextRole = String(values[2]) as 'owner' | 'editor' | 'viewer'
        if (String(values[1]) === 'user:owner') actorRole = nextRole
        else targetRole = nextRole
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspace_memberships') && text.includes('user_id = $2')) {
        return { rows: [{ user_id: 'user:owner', role: actorRole }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function stepUpPool(options: { validPassword?: boolean; recent?: boolean } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('SELECT session.session_id, user.password_hash')) {
        return {
          rows: [
            {
              session_id: 'session:one',
              password_hash: await storedPassword(
                options.validPassword === false
                  ? 'a different password'
                  : 'correct horse battery staple'
              )
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('last_reauthenticated_at >')) {
        return {
          rows: options.recent === false ? [] : [{ '?column?': 1 }],
          rowCount: options.recent === false ? 0 : 1
        }
      }
      return { rows: [], rowCount: 1 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function passwordResetPool(): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  let tokenValid = true
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('SELECT *') && text.includes('issue_password_reset')) {
        return {
          rows: [{ issued: true, reset_token_expires_at: '2026-07-24T00:30:00.000Z' }],
          rowCount: 1
        }
      }
      if (text.includes('password_reset_token_is_active')) {
        return { rows: [{ active: tokenValid }], rowCount: 1 }
      }
      if (text.includes('consume_password_reset')) {
        const consumed = tokenValid
        tokenValid = false
        return { rows: [{ consumed }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function workspaceInvitationPool(): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('SELECT role')) return { rows: [{ role: 'owner' }], rowCount: 1 }
      if (text.includes('FROM appsea.workspace_memberships') && text.includes('FOR SHARE')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      if (text.includes('issue_workspace_invitation')) return { rows: [], rowCount: 1 }
      if (text.includes('SELECT invitation_id, email, role, state')) {
        return {
          rows: [
            {
              invitation_id: String(values[1] ?? 'invite:one'),
              email: 'member@example.com',
              role: 'viewer',
              state: 'pending',
              created_at: '2026-07-24T00:00:00.000Z',
              expires_at: '2026-07-27T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('accept_workspace_invitation')) {
        return {
          rows: [{ accepted: true, workspace_id: 'workspace:one', role: 'viewer' }],
          rowCount: 1
        }
      }
      if (text.includes('claim_workspace_invitation_deliveries')) {
        return {
          rows: [
            {
              delivery_id: 'delivery:one',
              invitation_id: 'invite:one',
              workspace_id: 'workspace:one',
              email: 'member@example.com',
              token_ciphertext: 'cipher',
              token_nonce: 'nonce',
              token_tag: 'tag',
              role: 'viewer',
              expires_at: '2026-07-27T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function sessionLifecyclePool(options: { current?: boolean; target?: boolean } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('WITH current_session')) {
        return {
          rows: [
            {
              session_id: 'session:current',
              created_at: '2026-07-23T00:00:00.000Z',
              last_seen_at: '2026-07-24T00:00:00.000Z',
              expires_at: '2026-08-23T00:00:00.000Z',
              is_current: true
            },
            {
              session_id: 'session:other',
              created_at: '2026-07-22T00:00:00.000Z',
              last_seen_at: '2026-07-23T00:00:00.000Z',
              expires_at: '2026-08-22T00:00:00.000Z',
              is_current: false
            }
          ],
          rowCount: 2
        }
      }
      if (text.includes('SELECT session_id, user_id') && text.includes('FOR SHARE')) {
        return options.current === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ session_id: 'session:current', user_id: 'user:one' }], rowCount: 1 }
      }
      if (text.includes('UPDATE appsea.auth_sessions')) {
        return options.target === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ session_id: values[0] }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function accountClosurePool(options: { blockingWorkspaceIds?: string[] } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.close_user_account')) {
        const blockingWorkspaceIds = options.blockingWorkspaceIds ?? []
        return {
          rows: [
            {
              closed: blockingWorkspaceIds.length === 0,
              blocking_workspace_ids: blockingWorkspaceIds
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function workspaceArchivePool(options: { blocked?: boolean; forbidden?: boolean } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.archive_workspace')) {
        if (options.forbidden)
          throw Object.assign(new Error('workspace archival requires an owner'), { code: '42501' })
        return {
          rows: [
            options.blocked
              ? {
                  workspace_id: 'workspace:one',
                  state: 'blocked',
                  archived_at: null,
                  active_work_count: 2,
                  replayed: false
                }
              : {
                  workspace_id: 'workspace:one',
                  state: 'archived',
                  archived_at: '2026-08-02T20:00:00.000Z',
                  active_work_count: 0,
                  replayed: false
                }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function workspacePurgeReadinessPool(options: { owner?: boolean } = {}): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.workspace_memberships')) {
        return options.owner === false
          ? { rows: [{ role: 'editor' }], rowCount: 1 }
          : { rows: [{ role: 'owner' }], rowCount: 1 }
      }
      if (text.includes('FROM appsea.workspaces workspace')) {
        return {
          rows: [
            {
              workspace_id: 'workspace:one',
              status: 'archived',
              archived_at: '2026-08-02T20:00:00.000Z',
              checked_at: '2026-08-02T20:01:00.000Z',
              active_work_count: 0,
              raw_source_object_reference_count: 0,
              analysis_object_reference_count: 0,
              report_object_reference_count: 0,
              plan_object_reference_count: 0
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

function workspacePurgeRequestPool(
  options: { owner?: boolean; blocked?: boolean; canceled?: boolean } = {}
): {
  pool: Pool
  statements: Array<{ text: string; values: unknown[] }>
} {
  const statements: Array<{ text: string; values: unknown[] }> = []
  const readiness = {
    workspaceId: 'workspace:one',
    state: options.blocked ? 'blocked' : 'database_ready',
    archivedAt: options.blocked ? null : '2026-08-02T20:00:00.000Z',
    activeWorkCount: options.blocked ? 1 : 0,
    rawSourceObjectReferenceCount: 0,
    analysisObjectReferenceCount: 0,
    reportObjectReferenceCount: 0,
    planObjectReferenceCount: 0,
    blockers: options.blocked ? ['workspace_not_archived', 'active_work'] : [],
    externalRequirements: [
      'cloud_object_store_purge',
      'export_retention_purge',
      'backup_deletion_verification'
    ],
    checkedAt: '2026-08-02T20:01:00.000Z'
  }
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values })
      if (text.includes('FROM appsea.request_workspace_purge')) {
        if (options.owner === false)
          throw Object.assign(new Error('workspace purge request requires an owner'), {
            code: '42501'
          })
        return {
          rows: [
            options.blocked
              ? {
                  workspace_id: 'workspace:one',
                  request_id: null,
                  state: 'blocked',
                  requested_at: null,
                  canceled_at: null,
                  readiness_snapshot: readiness,
                  replayed: false
                }
              : {
                  workspace_id: 'workspace:one',
                  request_id: `workspace-purge:${'a'.repeat(32)}`,
                  state: options.canceled ? 'canceled' : 'awaiting_external_controls',
                  requested_at: '2026-08-02T20:02:00.000Z',
                  canceled_at: options.canceled ? '2026-08-02T20:03:00.000Z' : null,
                  readiness_snapshot: readiness,
                  replayed: false
                }
          ],
          rowCount: 1
        }
      }
      if (text.includes('FROM appsea.cancel_workspace_purge')) {
        if (options.owner === false)
          throw Object.assign(new Error('workspace purge cancellation requires an owner'), {
            code: '42501'
          })
        return {
          rows: [
            {
              workspace_id: 'workspace:one',
              request_id: `workspace-purge:${'a'.repeat(32)}`,
              state: 'canceled',
              requested_at: '2026-08-02T20:02:00.000Z',
              canceled_at: '2026-08-02T20:03:00.000Z',
              readiness_snapshot: readiness,
              replayed: false
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('FROM appsea.workspace_purge_requests')) {
        return {
          rows: [
            {
              workspace_id: 'workspace:one',
              request_id: `workspace-purge:${'a'.repeat(32)}`,
              state: options.canceled ? 'canceled' : 'awaiting_external_controls',
              requested_at: '2026-08-02T20:02:00.000Z',
              canceled_at: options.canceled ? '2026-08-02T20:03:00.000Z' : null,
              readiness_snapshot: readiness,
              replayed: false
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('FROM appsea.workspace_memberships')) {
        return options.owner === false
          ? { rows: [{ role: 'editor' }], rowCount: 1 }
          : { rows: [{ role: 'owner' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements
  }
}

describe('PostgresAuthRepository', () => {
  it('reads an active session and only stores token hashes in SQL parameters', async () => {
    const token = 'a'.repeat(48)
    const { pool, statements } = fakePool()
    const session = await new PostgresAuthRepository(pool).readSession(token)

    expect(session?.user.email).toBe('user@example.com')
    expect(session?.workspaces[0]?.role).toBe('owner')
    expect(
      statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.auth_user_id'") && entry.values[0] === 'user:one'
      )
    ).toBe(true)
    const sessionLookup = statements.find((entry) =>
      entry.text.includes('FROM appsea.auth_sessions')
    )
    expect(sessionLookup?.values).toEqual([sha256(token)])
    expect(JSON.stringify(statements)).not.toContain(token)
  })

  it('rejects invalid and expired session tokens without querying private rows', async () => {
    const invalid = fakePool()
    await expect(
      new PostgresAuthRepository(invalid.pool).readSession('too-short')
    ).resolves.toBeNull()
    expect(invalid.statements).toHaveLength(0)

    const expired = fakePool({ expired: true })
    await expect(
      new PostgresAuthRepository(expired.pool).readSession('b'.repeat(48))
    ).resolves.toBeNull()
  })

  it('verifies a password before creating a session', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresAuthRepository(pool)
    const result = await repository.signIn({
      email: 'user@example.com',
      password: 'correct horse battery staple'
    })

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const insert = statements.find((entry) =>
      entry.text.includes('INSERT INTO appsea.auth_sessions')
    )
    expect(insert?.text).toContain('last_reauthenticated_at')
    expect(insert?.values?.[2]).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(statements)).not.toContain('correct horse battery staple')
  })

  it('uses hashed durable keys for authentication throttling', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresAuthRepository(pool)
    await expect(repository.consumeAuthRateLimit('login:email:user@example.com', 12)).resolves.toBe(
      true
    )
    const statement = statements.find((entry) =>
      entry.text.includes('INSERT INTO appsea.auth_rate_limits')
    )
    expect(statement?.values[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(statements)).not.toContain('user@example.com')
  })

  it('requires the account password for a bounded session step-up window', async () => {
    const { pool, statements } = stepUpPool()
    const repository = new PostgresAuthRepository(pool)
    await repository.reauthenticateSession('a'.repeat(48), {
      password: 'correct horse battery staple'
    })
    await expect(repository.hasRecentReauthentication('a'.repeat(48))).resolves.toBe(true)
    expect(statements.some((entry) => entry.text.includes('last_reauthenticated_at ='))).toBe(true)
    expect(JSON.stringify(statements)).not.toContain('correct horse battery staple')

    const invalid = new PostgresAuthRepository(stepUpPool({ validPassword: false }).pool)
    await expect(
      invalid.reauthenticateSession('b'.repeat(48), {
        password: 'correct horse battery staple'
      })
    ).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('creates hashed single-use reset tokens and revokes sessions on consumption', async () => {
    const { pool, statements } = passwordResetPool()
    const repository = new PostgresAuthRepository(pool)
    const delivery = await repository.requestPasswordReset({ email: 'user@example.com' })
    expect(delivery.issued).toBe(true)
    expect(delivery.expiresAt).toMatch(/Z$/)
    const issue = statements.find((entry) => entry.text.includes('issue_password_reset'))
    expect(issue?.values[2]).toMatch(/^[a-f0-9]{64}$/)
    expect(String(issue?.values[5])).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(String(issue?.values[6])).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(String(issue?.values[7])).toMatch(/^[A-Za-z0-9_-]+$/)

    await repository.resetPassword({
      token: 'a'.repeat(48),
      password: 'new sufficiently long password'
    })
    expect(statements.some((entry) => entry.text.includes('password_reset_token_is_active'))).toBe(
      true
    )
    expect(statements.some((entry) => entry.text.includes('consume_password_reset'))).toBe(true)
    expect(JSON.stringify(statements)).not.toContain('new sufficiently long password')

    await expect(
      repository.resetPassword({ token: 'a'.repeat(48), password: 'another long password' })
    ).rejects.toBeInstanceOf(AuthPasswordResetError)
  })

  it('keeps workspace invitation creation and acceptance token-free at the repository boundary', async () => {
    const { pool, statements } = workspaceInvitationPool()
    const repository = new PostgresAuthRepository(pool)
    const issued = await repository.createWorkspaceInvitation('user:owner', 'workspace:one', {
      email: 'member@example.com',
      role: 'viewer'
    })
    expect(issued.invitation).toMatchObject({ email: 'member@example.com', role: 'viewer' })
    const issue = statements.find((entry) => entry.text.includes('issue_workspace_invitation'))
    expect(issue?.values[6]).toMatch(/^[a-f0-9]{64}$/)
    expect(String(issue?.values[7])).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(String(issue?.values[8])).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(String(issue?.values[9])).toMatch(/^[A-Za-z0-9_-]+$/)

    const accepted = await repository.acceptWorkspaceInvitation('user:member', {
      token: 'a'.repeat(48)
    })
    expect(accepted).toEqual({ accepted: true, workspaceId: 'workspace:one', role: 'viewer' })
    const acceptance = statements.find((entry) =>
      entry.text.includes('accept_workspace_invitation')
    )
    expect(acceptance?.values[0]).toBe(sha256('a'.repeat(48)))
    expect(JSON.stringify(statements)).not.toContain('a'.repeat(48))

    const deliveries = await repository.claimWorkspaceInvitationDeliveries()
    expect(deliveries[0]).toMatchObject({ deliveryId: 'delivery:one', role: 'viewer' })
    await expect(
      repository.failWorkspaceInvitationDelivery('delivery:one', 'NOT_FIXED')
    ).rejects.toThrow('Workspace invitation delivery failure is invalid')
  })

  it('lists active sessions without returning token material', async () => {
    const token = 'c'.repeat(48)
    const { pool, statements } = sessionLifecyclePool()
    const sessions = await new PostgresAuthRepository(pool).listActiveSessions(token)

    expect(sessions).toEqual([
      {
        id: 'session:current',
        createdAt: '2026-07-23T00:00:00.000Z',
        lastSeenAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-08-23T00:00:00.000Z',
        current: true
      },
      {
        id: 'session:other',
        createdAt: '2026-07-22T00:00:00.000Z',
        lastSeenAt: '2026-07-23T00:00:00.000Z',
        expiresAt: '2026-08-22T00:00:00.000Z',
        current: false
      }
    ])
    const lookup = statements.find((entry) => entry.text.includes('WITH current_session'))
    expect(lookup?.values).toEqual([sha256(token)])
    expect(JSON.stringify(sessions)).not.toContain(token)
    expect(JSON.stringify(statements)).not.toContain(token)
  })

  it('revokes another active session only after resolving the current user', async () => {
    const repository = new PostgresAuthRepository(sessionLifecyclePool().pool)
    await expect(
      repository.revokeSessionById('d'.repeat(48), 'session:other')
    ).resolves.toBeUndefined()

    const conflictRepository = new PostgresAuthRepository(sessionLifecyclePool().pool)
    await expect(
      conflictRepository.revokeSessionById('d'.repeat(48), 'session:current')
    ).rejects.toBeInstanceOf(AuthSessionConflictError)

    const missingTargetRepository = new PostgresAuthRepository(
      sessionLifecyclePool({ target: false }).pool
    )
    await expect(
      missingTargetRepository.revokeSessionById('d'.repeat(48), 'session:missing')
    ).rejects.toBeInstanceOf(AuthSessionNotFoundError)

    const missingCurrentRepository = new PostgresAuthRepository(
      sessionLifecyclePool({ current: false }).pool
    )
    await expect(
      missingCurrentRepository.revokeSessionById('d'.repeat(48), 'session:other')
    ).rejects.toBeInstanceOf(AuthSessionNotFoundError)
  })

  it('closes an account only through the database boundary and blocks workspace owners', async () => {
    const clear = accountClosurePool()
    const repository = new PostgresAuthRepository(clear.pool)
    await expect(
      repository.closeAccount('user:member', { confirmation: 'DELETE MY ACCOUNT' })
    ).resolves.toEqual({ closed: true, blockingWorkspaceIds: [] })
    expect(
      clear.statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.auth_user_id'") &&
          entry.values[0] === 'user:member'
      )
    ).toBe(true)
    expect(clear.statements.some((entry) => entry.text.includes('close_user_account'))).toBe(true)

    const blocked = new PostgresAuthRepository(
      accountClosurePool({ blockingWorkspaceIds: ['workspace:owned'] }).pool
    )
    await expect(
      blocked.closeAccount('user:owner', { confirmation: 'DELETE MY ACCOUNT' })
    ).rejects.toMatchObject({
      name: 'AuthAccountDeletionBlockedError',
      workspaceIds: ['workspace:owned']
    } satisfies Partial<AuthAccountDeletionBlockedError>)
  })

  it('archives through the owner-only database function and exposes active-work blockers', async () => {
    const archived = workspaceArchivePool()
    const repository = new PostgresAuthRepository(archived.pool)
    await expect(
      repository.archiveWorkspace('user:owner', 'workspace:one', {
        confirmation: 'ARCHIVE WORKSPACE'
      })
    ).resolves.toEqual({
      workspaceId: 'workspace:one',
      state: 'archived',
      archivedAt: '2026-08-02T20:00:00.000Z',
      activeWorkCount: 0,
      replayed: false
    })
    expect(archived.statements.some((entry) => entry.text.includes('archive_workspace'))).toBe(true)
    expect(
      archived.statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.auth_user_id'") &&
          entry.values[0] === 'user:owner'
      )
    ).toBe(true)
    expect(
      archived.statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.workspace_id'") &&
          entry.values[0] === 'workspace:one'
      )
    ).toBe(true)

    await expect(
      new PostgresAuthRepository(workspaceArchivePool({ blocked: true }).pool).archiveWorkspace(
        'user:owner',
        'workspace:one',
        { confirmation: 'ARCHIVE WORKSPACE' }
      )
    ).resolves.toMatchObject({ state: 'blocked', activeWorkCount: 2, archivedAt: null })

    await expect(
      new PostgresAuthRepository(workspaceArchivePool({ forbidden: true }).pool).archiveWorkspace(
        'user:editor',
        'workspace:one',
        { confirmation: 'ARCHIVE WORKSPACE' }
      )
    ).rejects.toMatchObject({ name: 'WorkspaceArchivePermissionError' })
  })

  it('reads purge readiness through an owner-only, read-only metadata boundary', async () => {
    const inspected = workspacePurgeReadinessPool()
    const repository = new PostgresAuthRepository(inspected.pool)
    await expect(
      repository.readWorkspacePurgeReadiness('user:owner', 'workspace:one')
    ).resolves.toEqual({
      workspaceId: 'workspace:one',
      state: 'database_ready',
      archivedAt: '2026-08-02T20:00:00.000Z',
      activeWorkCount: 0,
      rawSourceObjectReferenceCount: 0,
      analysisObjectReferenceCount: 0,
      reportObjectReferenceCount: 0,
      planObjectReferenceCount: 0,
      blockers: [],
      externalRequirements: [
        'cloud_object_store_purge',
        'export_retention_purge',
        'backup_deletion_verification'
      ],
      checkedAt: '2026-08-02T20:01:00.000Z'
    })
    expect(
      inspected.statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.auth_user_id'") &&
          entry.values[0] === 'user:owner'
      )
    ).toBe(true)
    expect(
      inspected.statements.some(
        (entry) =>
          entry.text.includes("set_config('appsea.workspace_id'") &&
          entry.values[0] === 'workspace:one'
      )
    ).toBe(true)
    await expect(
      new PostgresAuthRepository(
        workspacePurgeReadinessPool({ owner: false }).pool
      ).readWorkspacePurgeReadiness('user:editor', 'workspace:one')
    ).rejects.toBeInstanceOf(WorkspaceAuthorizationError)
  })

  it('records an owner-confirmed purge intent only after the database gate', async () => {
    const requested = workspacePurgeRequestPool()
    const repository = new PostgresAuthRepository(requested.pool)
    await expect(
      repository.requestWorkspacePurge('user:owner', 'workspace:one', {
        confirmation: 'REQUEST WORKSPACE PURGE'
      })
    ).resolves.toMatchObject({
      requestId: `workspace-purge:${'a'.repeat(32)}`,
      state: 'awaiting_external_controls',
      readiness: { state: 'database_ready' }
    })
    expect(
      requested.statements.some((entry) => entry.text.includes('request_workspace_purge'))
    ).toBe(true)

    const blocked = new PostgresAuthRepository(workspacePurgeRequestPool({ blocked: true }).pool)
    await expect(
      blocked.requestWorkspacePurge('user:owner', 'workspace:one', {
        confirmation: 'REQUEST WORKSPACE PURGE'
      })
    ).rejects.toBeInstanceOf(WorkspacePurgeRequestNotReadyError)

    const forbidden = new PostgresAuthRepository(workspacePurgeRequestPool({ owner: false }).pool)
    await expect(
      forbidden.requestWorkspacePurge('user:editor', 'workspace:one', {
        confirmation: 'REQUEST WORKSPACE PURGE'
      })
    ).rejects.toBeInstanceOf(WorkspacePurgeRequestPermissionError)
  })

  it('reads and cancels purge intents through the owner boundary', async () => {
    const inspected = workspacePurgeRequestPool()
    const repository = new PostgresAuthRepository(inspected.pool)
    await expect(
      repository.readWorkspacePurgeRequest('user:owner', 'workspace:one')
    ).resolves.toMatchObject({ state: 'awaiting_external_controls' })
    await expect(
      repository.cancelWorkspacePurge('user:owner', 'workspace:one', {
        requestId: `workspace-purge:${'a'.repeat(32)}`,
        confirmation: 'CANCEL WORKSPACE PURGE'
      })
    ).resolves.toMatchObject({ state: 'canceled' })
    expect(
      inspected.statements.some((entry) => entry.text.includes('cancel_workspace_purge'))
    ).toBe(true)
  })

  it('lists members for owners and records role/removal changes durably', async () => {
    const { pool, statements } = membershipAdminPool()
    const repository = new PostgresAuthRepository(pool)
    const members = await repository.listWorkspaceMembers('user:owner', 'workspace:one')
    expect(members[0]).toMatchObject({ userId: 'user:member', role: 'editor' })

    const updated = await repository.updateWorkspaceMemberRole(
      'user:owner',
      'workspace:one',
      'user:member',
      { role: 'viewer' }
    )
    expect(updated.role).toBe('viewer')
    await repository.removeWorkspaceMember('user:owner', 'workspace:one', 'user:member')
    expect(
      statements.some((entry) => entry.text.includes('UPDATE appsea.workspace_memberships'))
    ).toBe(true)
    expect(
      statements.some((entry) => entry.text.includes('DELETE FROM appsea.workspace_memberships'))
    ).toBe(true)
  })

  it('rejects non-owner administration and protects the last owner', async () => {
    const nonOwner = membershipAdminPool({ actorRole: 'editor' })
    const repository = new PostgresAuthRepository(nonOwner.pool)
    await expect(
      repository.updateWorkspaceMemberRole('user:owner', 'workspace:one', 'user:member', {
        role: 'viewer'
      })
    ).rejects.toBeInstanceOf(WorkspaceMembershipManagementError)

    const soleOwner = membershipAdminPool({
      targetUserId: 'user:owner',
      targetRole: 'owner',
      includeTarget: false
    })
    const soleOwnerRepository = new PostgresAuthRepository(soleOwner.pool)
    await expect(
      soleOwnerRepository.updateWorkspaceMemberRole('user:owner', 'workspace:one', 'user:owner', {
        role: 'viewer'
      })
    ).rejects.toBeInstanceOf(WorkspaceMembershipConflictError)

    const coOwner = membershipAdminPool({
      targetUserId: 'user:owner',
      targetRole: 'owner',
      includeTarget: false,
      additionalOwner: true
    })
    const coOwnerRepository = new PostgresAuthRepository(coOwner.pool)
    await expect(
      coOwnerRepository.updateWorkspaceMemberRole('user:owner', 'workspace:one', 'user:owner', {
        role: 'viewer'
      })
    ).resolves.toMatchObject({ userId: 'user:owner', role: 'viewer' })
  })

  it('hydrates object-backed production reports before approved export', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-24T00:00:00.000Z')
    const fixtureReport = generateOpportunityReport(artifact, '2026-07-24T00:00:00.000Z')
    const report = { ...fixtureReport, synthetic: false as const, testOnly: false, transport: null }
    const objectStore = new InMemoryObjectStore()
    const stored = await storeOpportunityReport(objectStore, {
      workspaceId: 'workspace:one',
      createdAt: '2026-07-24T00:00:00.000Z',
      report
    })
    const exported = await new PostgresAuthRepository(
      objectBackedReportPool(stored),
      objectStore
    ).exportWorkspaceReport('user:one', 'workspace:one', 'report:production')
    expect(exported.report.structuredReport).toEqual(report)
    expect(exported.report.approvalState).toBe('approved')
  })

  it('hydrates object-backed production plans before approved export', async () => {
    const objectStore = new InMemoryObjectStore()
    const stored = await storePlanPackage(objectStore, {
      workspaceId: 'workspace:one',
      createdAt: '2026-07-24T00:00:00.000Z',
      planPackage: {
        opportunitySlug: 'private-opportunity',
        generatedAt: '2026-07-24T00:00:00.000Z',
        files: [{ path: 'README.md', content: 'Reviewed plan' }]
      }
    })
    const exported = await new PostgresAuthRepository(
      objectBackedPlanPool(stored),
      objectStore
    ).exportWorkspacePlan('user:one', 'workspace:one', 'plan:production')
    expect(exported.plan.files).toEqual([{ path: 'README.md', content: 'Reviewed plan' }])
    expect(exported.plan.approvalState).toBe('approved')
  })

  it('blocks plan export until owner approval', async () => {
    const objectStore = new InMemoryObjectStore()
    const stored = await storePlanPackage(objectStore, {
      workspaceId: 'workspace:one',
      createdAt: '2026-07-24T00:00:00.000Z',
      planPackage: {
        opportunitySlug: 'private-opportunity',
        generatedAt: '2026-07-24T00:00:00.000Z',
        files: [{ path: 'README.md', content: 'Reviewed plan' }]
      }
    })
    await expect(
      new PostgresAuthRepository(
        objectBackedPlanPool(stored, 'reviewed'),
        objectStore
      ).exportWorkspacePlan('user:one', 'workspace:one', 'plan:production')
    ).rejects.toBeInstanceOf(WorkspacePlanNotApprovedError)
  })
})
