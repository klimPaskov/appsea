import type { Pool, PoolClient } from 'pg'
import { appseaIdentifierSchema } from '@appsea/contracts'

export interface WorkspaceTransactionOptions {
  isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'
  readOnly?: boolean
  maxSerializationRetries?: number
}

export class WorkspaceAuthorizationError extends Error {
  constructor() {
    super('User is not a member of the requested workspace')
    this.name = 'WorkspaceAuthorizationError'
  }
}

const isolationLevels = {
  'READ COMMITTED': 'READ COMMITTED',
  'REPEATABLE READ': 'REPEATABLE READ',
  SERIALIZABLE: 'SERIALIZABLE'
} as const

function retryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === '40001' || code === '40P01'
}

export async function withWorkspaceTransaction<T>(
  pool: Pool,
  workspaceId: string,
  operation: (client: PoolClient) => Promise<T>,
  options: WorkspaceTransactionOptions = {}
): Promise<T> {
  const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const requestedIsolationLevel: unknown = options.isolationLevel ?? 'READ COMMITTED'
  if (
    typeof requestedIsolationLevel !== 'string' ||
    !(requestedIsolationLevel in isolationLevels)
  ) {
    throw new Error('Unsupported transaction isolation level')
  }
  const isolationLevel = isolationLevels[requestedIsolationLevel as keyof typeof isolationLevels]
  const maxRetries = options.maxSerializationRetries ?? (options.readOnly === true ? 0 : 2)
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error('maxSerializationRetries must be an integer between 0 and 5')
  }

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect()
    try {
      await client.query(
        `BEGIN ISOLATION LEVEL ${isolationLevel}${options.readOnly === true ? ' READ ONLY' : ''}`
      )
      await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
        validatedWorkspaceId
      ])
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the transaction error; the connection is released below.
      }
      if (attempt < maxRetries && retryableTransactionError(error)) continue
      throw error
    } finally {
      client.release()
    }
  }
}

/**
 * Run a worker-owned workspace transaction with an explicit service principal.
 *
 * This is intentionally separate from user authentication: the database
 * credential authenticates the worker process, while the transaction-local
 * principal lets security-definer source gates reject direct or anonymous
 * inserts that do not come through the worker boundary.
 */
export async function withServiceWorkspaceTransaction<T>(
  pool: Pool,
  workspaceId: string,
  operation: (client: PoolClient) => Promise<T>,
  options: WorkspaceTransactionOptions = {}
): Promise<T> {
  const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  return withDatabaseTransaction(
    pool,
    async (client) => {
      await client.query("SELECT set_config('appsea.service_principal', $1, true)", [
        'appsea-worker'
      ])
      await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
        validatedWorkspaceId
      ])
      return operation(client)
    },
    options
  )
}

/** Run a transaction without a workspace GUC for global/authentication rows. */
export async function withDatabaseTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
  options: WorkspaceTransactionOptions = {}
): Promise<T> {
  const requestedIsolationLevel: unknown = options.isolationLevel ?? 'READ COMMITTED'
  if (
    typeof requestedIsolationLevel !== 'string' ||
    !(requestedIsolationLevel in isolationLevels)
  ) {
    throw new Error('Unsupported transaction isolation level')
  }
  const isolationLevel = isolationLevels[requestedIsolationLevel as keyof typeof isolationLevels]
  const maxRetries = options.maxSerializationRetries ?? (options.readOnly === true ? 0 : 2)
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error('maxSerializationRetries must be an integer between 0 and 5')
  }

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect()
    try {
      await client.query(
        `BEGIN ISOLATION LEVEL ${isolationLevel}${options.readOnly === true ? ' READ ONLY' : ''}`
      )
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the transaction error; the connection is released below.
      }
      if (attempt < maxRetries && retryableTransactionError(error)) continue
      throw error
    } finally {
      client.release()
    }
  }
}

/**
 * Authorize a user and establish the workspace RLS context in the same
 * transaction. The membership check runs before setting appsea.workspace_id;
 * pooled connections therefore cannot retain an authorized context after the
 * transaction ends.
 */
export async function withAuthenticatedWorkspaceTransaction<T>(
  pool: Pool,
  userId: string,
  workspaceId: string,
  operation: (client: PoolClient) => Promise<T>,
  options: WorkspaceTransactionOptions = {}
): Promise<T> {
  const validatedUserId = appseaIdentifierSchema.parse(userId)
  const validatedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  return withDatabaseTransaction(
    pool,
    async (client) => {
      await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [validatedUserId])
      const membership = await client.query(
        `SELECT 1
           FROM appsea.workspace_memberships membership
          WHERE membership.user_id = $1
            AND membership.workspace_id = $2
          FOR SHARE`,
        [validatedUserId, validatedWorkspaceId]
      )
      if (membership.rowCount !== 1) throw new WorkspaceAuthorizationError()
      await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
        validatedWorkspaceId
      ])
      const workspace = await client.query(
        `SELECT 1
           FROM appsea.workspaces
          WHERE workspace_id = $1 AND status = 'active'
          FOR SHARE`,
        [validatedWorkspaceId]
      )
      if (workspace.rowCount !== 1) throw new WorkspaceAuthorizationError()
      return operation(client)
    },
    options
  )
}
