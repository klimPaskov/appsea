import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  productionWorkflowAdmissionDecisionSchema,
  type ProductionWorkflowAdmissionDecision as ProductionWorkflowAdmissionDecisionContract
} from '@appsea/contracts'
import { withAuthenticatedWorkspaceTransaction, withWorkspaceTransaction } from './transaction'

/**
 * Conservative defaults for the authenticated production collection ingress.
 * These are server-owned values; callers cannot raise them through a request
 * payload. Deployment can change them only through a reviewed migration/code
 * change that also updates the operational runbook.
 */
export const productionWorkflowAdmissionLimits = {
  maxStarts: 5,
  windowSeconds: 15 * 60,
  maxConcurrent: 2,
  reservationTtlSeconds: 5 * 60
} as const

export type ProductionWorkflowAdmissionDecision =
  ProductionWorkflowAdmissionDecisionContract['decision']

export interface ProductionWorkflowAdmissionInput {
  workspaceId: string
  userId: string
  idempotencyDigest: string
  inputHash: string
}

export interface ProductionWorkflowAdmissionResult {
  decision: Exclude<ProductionWorkflowAdmissionDecision, 'rate_limited' | 'concurrency_limited'>
  replayed: boolean
  retryAfterSeconds: 0
  reservationExpiresAt: string
}

interface AdmissionRow extends QueryResultRow {
  decision: ProductionWorkflowAdmissionDecision
  retry_after_seconds: number | string
  reservation_expires_at: Date | string
}

export class ProductionWorkflowAdmissionConflictError extends Error {
  constructor() {
    super('Production workflow admission conflicts with a previous request')
    this.name = 'ProductionWorkflowAdmissionConflictError'
  }
}

export class ProductionWorkflowRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Production workflow start rate limit exceeded')
    this.name = 'ProductionWorkflowRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class ProductionWorkflowConcurrencyLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Production workflow concurrency limit exceeded')
    this.name = 'ProductionWorkflowConcurrencyLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function validateDigest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isDatabaseError(error: unknown, code: string, phrase: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code &&
    'message' in error &&
    String((error as { message?: unknown }).message).includes(phrase)
  )
}

function mapAdmission(row: AdmissionRow): ProductionWorkflowAdmissionResult {
  const parsed = productionWorkflowAdmissionDecisionSchema.parse({
    decision: row.decision,
    retryAfterSeconds: Number(row.retry_after_seconds),
    reservationExpiresAt: iso(row.reservation_expires_at)
  })
  if (parsed.decision === 'rate_limited') {
    throw new ProductionWorkflowRateLimitError(parsed.retryAfterSeconds)
  }
  if (parsed.decision === 'concurrency_limited') {
    throw new ProductionWorkflowConcurrencyLimitError(parsed.retryAfterSeconds)
  }
  if (parsed.decision !== 'admitted' && parsed.decision !== 'replayed') {
    throw new Error('Production workflow admission returned an invalid decision')
  }
  return {
    decision: parsed.decision,
    replayed: parsed.decision === 'replayed',
    retryAfterSeconds: 0,
    reservationExpiresAt: parsed.reservationExpiresAt
  }
}

function validatedInput(input: ProductionWorkflowAdmissionInput): ProductionWorkflowAdmissionInput {
  return {
    workspaceId: appseaIdentifierSchema.parse(input.workspaceId),
    userId: appseaIdentifierSchema.parse(input.userId),
    idempotencyDigest: validateDigest(input.idempotencyDigest, 'idempotencyDigest'),
    inputHash: validateDigest(input.inputHash, 'inputHash')
  }
}

/** Consume an admission inside the workflow initialization transaction. */
export async function consumeProductionWorkflowAdmissionInTransaction(
  client: PoolClient,
  workspaceId: string,
  idempotencyDigest: string,
  inputHash: string
): Promise<boolean> {
  const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const parsedDigest = validateDigest(idempotencyDigest, 'idempotencyDigest')
  const parsedInputHash = validateDigest(inputHash, 'inputHash')
  try {
    const result = await client.query<{ consumed: boolean }>(
      `SELECT appsea.consume_production_collection_workflow_admission($1, $2, $3)
         AS consumed`,
      [parsedWorkspaceId, parsedDigest, parsedInputHash]
    )
    return Boolean(result.rows[0]?.consumed)
  } catch (error) {
    if (isDatabaseError(error, '23505', 'production workflow admission')) {
      throw new ProductionWorkflowAdmissionConflictError()
    }
    throw error
  }
}

export class PostgresProductionWorkflowAdmissionRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Atomically reserves one production workflow start after membership/RLS
   * authorization. A replay of the same digest never consumes another start
   * or concurrency slot; a new digest is rejected before Temporal is called.
   */
  async admitForUser(
    input: ProductionWorkflowAdmissionInput
  ): Promise<ProductionWorkflowAdmissionResult> {
    const parsed = validatedInput(input)
    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsed.userId,
        parsed.workspaceId,
        async (client) => {
          const result = await client.query<AdmissionRow>(
            `SELECT decision, retry_after_seconds, reservation_expires_at
               FROM appsea.admit_production_collection_workflow(
                 $1, $2, $3
               )`,
            [parsed.workspaceId, parsed.idempotencyDigest, parsed.inputHash]
          )
          const row = result.rows[0]
          if (!row) throw new Error('Production workflow admission returned no decision')
          return mapAdmission(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'production workflow')) {
        throw new ProductionWorkflowAdmissionConflictError()
      }
      throw error
    }
  }

  /** Mark the short-lived admission as consumed when the workflow projection initializes. */
  async consume(
    workspaceId: string,
    idempotencyDigest: string,
    inputHash: string
  ): Promise<boolean> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedDigest = validateDigest(idempotencyDigest, 'idempotencyDigest')
    const parsedInputHash = validateDigest(inputHash, 'inputHash')
    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsedWorkspaceId,
        async (client) => {
          return consumeProductionWorkflowAdmissionInTransaction(
            client,
            parsedWorkspaceId,
            parsedDigest,
            parsedInputHash
          )
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'production workflow admission')) {
        throw new ProductionWorkflowAdmissionConflictError()
      }
      throw error
    }
  }

  /** Remove terminal or expired admission rows in a bounded workspace batch. */
  async purge(workspaceId: string, before: string, batchSize = 1_000): Promise<number> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      throw new Error('batchSize must be an integer between 1 and 10000')
    }
    if (!Number.isFinite(Date.parse(before))) throw new Error('before must be a valid timestamp')
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{ purged_count: number | string }>(
          `SELECT appsea.purge_production_collection_workflow_admissions(
             $1, $2::timestamptz, $3
           ) AS purged_count`,
          [parsedWorkspaceId, before, batchSize]
        )
        return Number(result.rows[0]?.purged_count ?? 0)
      },
      { isolationLevel: 'READ COMMITTED' }
    )
  }
}
