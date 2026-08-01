import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourceCollectionLeaseResultSchema,
  type SourceCollectionLeaseDecision,
  type SourceCollectionLeaseResult as SourceCollectionLeaseContractResult
} from '@appsea/contracts'
import { withWorkspaceTransaction } from './transaction'

export const sourceCollectionLeaseLimits = {
  reservationTtlSeconds: 30 * 60,
  maxPurgeBatchSize: 10_000
} as const

export interface SourceCollectionLeaseInput {
  workspaceId: string
  leaseId: string
  sourceId: string
  policyVersion: string
  inputHash: string
  observedAt: string
  expiresAt?: string
}

export interface SourceCollectionLeaseResult extends Omit<
  SourceCollectionLeaseContractResult,
  'decision'
> {
  decision: Exclude<SourceCollectionLeaseDecision, 'expired' | 'released' | 'revoked'>
  replayed: boolean
}

interface LeaseRow extends QueryResultRow {
  decision: SourceCollectionLeaseDecision
  observed_at: Date | string
  expires_at: Date | string
}

export class SourceCollectionLeaseConflictError extends Error {
  constructor(message = 'Source collection lease conflicts with a previous request') {
    super(message)
    this.name = 'SourceCollectionLeaseConflictError'
  }
}

export class SourceCollectionLeaseTerminalError extends Error {
  readonly state: Exclude<SourceCollectionLeaseDecision, 'acquired' | 'replayed'>

  constructor(state: Exclude<SourceCollectionLeaseDecision, 'acquired' | 'replayed'>) {
    super(`Source collection lease is terminal: ${state}`)
    this.name = 'SourceCollectionLeaseTerminalError'
    this.state = state
  }
}

export class SourceCollectionLeasePolicyDeniedError extends Error {
  constructor() {
    super('Source collection lease requires an approved, active source policy')
    this.name = 'SourceCollectionLeasePolicyDeniedError'
  }
}

function identifier(value: string, label: string): string {
  try {
    return appseaIdentifierSchema.parse(value)
  } catch {
    throw new Error(`${label} is not a persistence-safe identifier`)
  }
}

function policyVersion(value: string): string {
  if (value.length < 1 || value.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new Error('policyVersion is not persistence-safe')
  }
  return value
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return value
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`)
  return new Date(parsed).toISOString()
}

function leaseId(value: string): string {
  return identifier(value, 'leaseId')
}

function isDatabaseError(error: unknown, code: string, phrase?: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  if ((error as { code?: unknown }).code !== code) return false
  if (!phrase) return true
  return 'message' in error && String((error as { message?: unknown }).message).includes(phrase)
}

function mapLease(row: LeaseRow): SourceCollectionLeaseResult {
  const parsed = sourceCollectionLeaseResultSchema.parse({
    decision: row.decision,
    observedAt: timestamp(
      row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
      'observedAt'
    ),
    expiresAt: timestamp(
      row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      'expiresAt'
    )
  })
  if (parsed.decision !== 'acquired' && parsed.decision !== 'replayed') {
    throw new SourceCollectionLeaseTerminalError(parsed.decision)
  }
  return {
    decision: parsed.decision,
    observedAt: parsed.observedAt,
    expiresAt: parsed.expiresAt,
    replayed: parsed.decision === 'replayed'
  }
}

function validatedInput(input: SourceCollectionLeaseInput): Required<SourceCollectionLeaseInput> {
  const observedAt = timestamp(input.observedAt, 'observedAt')
  const expiresAt = timestamp(
    input.expiresAt ??
      new Date(
        Date.now() + sourceCollectionLeaseLimits.reservationTtlSeconds * 1_000
      ).toISOString(),
    'expiresAt'
  )
  if (Date.parse(expiresAt) <= Date.now()) throw new Error('expiresAt must be in the future')
  return {
    workspaceId: identifier(input.workspaceId, 'workspaceId'),
    leaseId: leaseId(input.leaseId),
    sourceId: identifier(input.sourceId, 'sourceId'),
    policyVersion: policyVersion(input.policyVersion),
    inputHash: digest(input.inputHash, 'inputHash'),
    observedAt,
    expiresAt
  }
}

export class PostgresSourceCollectionLeaseRepository {
  constructor(private readonly pool: Pool) {}

  /** Acquire once, or replay the existing lease and its immutable timestamp. */
  async acquire(input: SourceCollectionLeaseInput): Promise<SourceCollectionLeaseResult> {
    const parsed = validatedInput(input)
    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsed.workspaceId,
        async (client) => {
          const result = await client.query<LeaseRow>(
            `SELECT decision, observed_at, expires_at
               FROM appsea.acquire_source_collection_lease(
                 $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz
               )`,
            [
              parsed.workspaceId,
              parsed.leaseId,
              parsed.sourceId,
              parsed.policyVersion,
              parsed.inputHash,
              parsed.observedAt,
              parsed.expiresAt
            ]
          )
          const row = result.rows[0]
          if (!row) throw new Error('Source collection lease returned no decision')
          return mapLease(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'source collection lease')) {
        throw new SourceCollectionLeaseConflictError()
      }
      if (isDatabaseError(error, '42501', 'source collection lease')) {
        throw new SourceCollectionLeasePolicyDeniedError()
      }
      throw error
    }
  }

  /** Recheck policy state and lease expiry immediately before persistence. */
  async assertActive(
    workspaceId: string,
    leaseIdValue: string,
    inputHash: string
  ): Promise<boolean> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedLeaseId = leaseId(leaseIdValue)
    const parsedInputHash = digest(inputHash, 'inputHash')
    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsedWorkspaceId,
        async (client) => {
          const result = await client.query<{ active: boolean }>(
            `SELECT appsea.assert_source_collection_lease($1, $2, $3) AS active`,
            [parsedWorkspaceId, parsedLeaseId, parsedInputHash]
          )
          return Boolean(result.rows[0]?.active)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'source collection lease')) {
        throw new SourceCollectionLeaseConflictError()
      }
      throw error
    }
  }

  /** Release only after a trusted result has been persisted; terminal states are idempotent. */
  async release(workspaceId: string, leaseIdValue: string, inputHash: string): Promise<boolean> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedLeaseId = leaseId(leaseIdValue)
    const parsedInputHash = digest(inputHash, 'inputHash')
    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsedWorkspaceId,
        async (client) => {
          const result = await client.query<{ released: boolean }>(
            `SELECT appsea.release_source_collection_lease($1, $2, $3) AS released`,
            [parsedWorkspaceId, parsedLeaseId, parsedInputHash]
          )
          return Boolean(result.rows[0]?.released)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'source collection lease')) {
        throw new SourceCollectionLeaseConflictError()
      }
      throw error
    }
  }

  /** Purge terminal or expired leases in a bounded workspace batch. */
  async purge(workspaceId: string, before: string, batchSize = 1_000): Promise<number> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedBefore = timestamp(before, 'before')
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > sourceCollectionLeaseLimits.maxPurgeBatchSize
    ) {
      throw new Error('batchSize must be an integer between 1 and 10000')
    }
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ purged_count: number | string }>(
          `SELECT appsea.purge_source_collection_leases(
             $1, $2::timestamptz, $3
           ) AS purged_count`,
          [parsedWorkspaceId, parsedBefore, batchSize]
        )
        return Number(result.rows[0]?.purged_count ?? 0)
      },
      { isolationLevel: 'READ COMMITTED' }
    )
  }
}
