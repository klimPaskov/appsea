import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  productionWorkflowAdmissionDecisionSchema,
  type ProductionWorkflowAdmissionDecision as ProductionWorkflowAdmissionDecisionContract
} from '@appsea/contracts'
import { withAuthenticatedWorkspaceTransaction, withWorkspaceTransaction } from './transaction'

/** Server-owned limits for manually initiated production analysis. */
export const productionAnalysisAdmissionLimits = {
  maxStarts: 5,
  windowSeconds: 15 * 60,
  maxConcurrent: 2,
  reservationTtlSeconds: 5 * 60
} as const

export type ProductionAnalysisAdmissionDecision =
  ProductionWorkflowAdmissionDecisionContract['decision']

export interface ProductionAnalysisAdmissionInput {
  workspaceId: string
  userId: string
  idempotencyDigest: string
  inputHash: string
}

export interface ProductionAnalysisAdmissionResult {
  decision: Exclude<ProductionAnalysisAdmissionDecision, 'rate_limited' | 'concurrency_limited'>
  replayed: boolean
  retryAfterSeconds: 0
  reservationExpiresAt: string
}

interface AdmissionRow extends QueryResultRow {
  decision: ProductionAnalysisAdmissionDecision
  retry_after_seconds: number | string
  reservation_expires_at: Date | string
}

export class ProductionAnalysisAdmissionConflictError extends Error {
  constructor() {
    super('Production analysis admission conflicts with a previous request')
    this.name = 'ProductionAnalysisAdmissionConflictError'
  }
}

export class ProductionAnalysisAdmissionRequiredError extends Error {
  constructor() {
    super('Production analysis initialization requires an active admission reservation')
    this.name = 'ProductionAnalysisAdmissionRequiredError'
  }
}

export class ProductionAnalysisRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Production analysis start rate limit exceeded')
    this.name = 'ProductionAnalysisRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class ProductionAnalysisConcurrencyLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Production analysis concurrency limit exceeded')
    this.name = 'ProductionAnalysisConcurrencyLimitError'
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

function mapAdmission(row: AdmissionRow): ProductionAnalysisAdmissionResult {
  const parsed = productionWorkflowAdmissionDecisionSchema.parse({
    decision: row.decision,
    retryAfterSeconds: Number(row.retry_after_seconds),
    reservationExpiresAt: iso(row.reservation_expires_at)
  })
  if (parsed.decision === 'rate_limited') {
    throw new ProductionAnalysisRateLimitError(parsed.retryAfterSeconds)
  }
  if (parsed.decision === 'concurrency_limited') {
    throw new ProductionAnalysisConcurrencyLimitError(parsed.retryAfterSeconds)
  }
  if (parsed.decision !== 'admitted' && parsed.decision !== 'replayed') {
    throw new Error('Production analysis admission returned an invalid decision')
  }
  return {
    decision: parsed.decision,
    replayed: parsed.decision === 'replayed',
    retryAfterSeconds: 0,
    reservationExpiresAt: parsed.reservationExpiresAt
  }
}

function validatedInput(input: ProductionAnalysisAdmissionInput): ProductionAnalysisAdmissionInput {
  return {
    workspaceId: appseaIdentifierSchema.parse(input.workspaceId),
    userId: appseaIdentifierSchema.parse(input.userId),
    idempotencyDigest: validateDigest(input.idempotencyDigest, 'idempotencyDigest'),
    inputHash: validateDigest(input.inputHash, 'inputHash')
  }
}

export function assertProductionAnalysisAdmissionConsumed(consumed: boolean): void {
  if (!consumed) throw new ProductionAnalysisAdmissionRequiredError()
}

/** Consume a user admission inside the same transaction as analysis-run creation. */
export async function consumeProductionAnalysisAdmissionInTransaction(
  client: PoolClient,
  workspaceId: string,
  idempotencyDigest: string,
  inputHash: string,
  actorId: string
): Promise<boolean> {
  const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const parsedDigest = validateDigest(idempotencyDigest, 'idempotencyDigest')
  const parsedInputHash = validateDigest(inputHash, 'inputHash')
  const parsedActorId = appseaIdentifierSchema.parse(actorId)
  try {
    const result = await client.query<{ consumed: boolean }>(
      `SELECT appsea.consume_production_analysis_workflow_admission($1, $2, $3, $4)
         AS consumed`,
      [parsedWorkspaceId, parsedDigest, parsedInputHash, parsedActorId]
    )
    return Boolean(result.rows[0]?.consumed)
  } catch (error) {
    if (isDatabaseError(error, '23505', 'production analysis admission')) {
      throw new ProductionAnalysisAdmissionConflictError()
    }
    throw error
  }
}

/** Release a consumed user admission after terminal analysis persistence. */
export async function releaseProductionAnalysisAdmissionInTransaction(
  client: PoolClient,
  workspaceId: string,
  idempotencyDigest: string,
  inputHash: string,
  actorId: string
): Promise<boolean> {
  const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const parsedDigest = validateDigest(idempotencyDigest, 'idempotencyDigest')
  const parsedInputHash = validateDigest(inputHash, 'inputHash')
  const parsedActorId = appseaIdentifierSchema.parse(actorId)
  const result = await client.query<{ released: boolean }>(
    `SELECT appsea.release_production_analysis_workflow_admission($1, $2, $3, $4)
       AS released`,
    [parsedWorkspaceId, parsedDigest, parsedInputHash, parsedActorId]
  )
  return Boolean(result.rows[0]?.released)
}

export class PostgresProductionAnalysisAdmissionRepository {
  constructor(private readonly pool: Pool) {}

  /** Reserve one authenticated user start before Temporal is contacted. */
  async admitForUser(
    input: ProductionAnalysisAdmissionInput
  ): Promise<ProductionAnalysisAdmissionResult> {
    const parsed = validatedInput(input)
    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsed.userId,
        parsed.workspaceId,
        async (client) => {
          const result = await client.query<AdmissionRow>(
            `SELECT decision, retry_after_seconds, reservation_expires_at
               FROM appsea.admit_production_analysis_workflow($1, $2, $3)`,
            [parsed.workspaceId, parsed.idempotencyDigest, parsed.inputHash]
          )
          const row = result.rows[0]
          if (!row) throw new Error('Production analysis admission returned no decision')
          return mapAdmission(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isDatabaseError(error, '23505', 'production analysis admission')) {
        throw new ProductionAnalysisAdmissionConflictError()
      }
      throw error
    }
  }

  async consume(
    workspaceId: string,
    idempotencyDigest: string,
    inputHash: string,
    actorId: string
  ): Promise<boolean> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      (client) =>
        consumeProductionAnalysisAdmissionInTransaction(
          client,
          parsedWorkspaceId,
          idempotencyDigest,
          inputHash,
          actorId
        ),
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async release(
    workspaceId: string,
    idempotencyDigest: string,
    inputHash: string,
    actorId: string
  ): Promise<boolean> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      (client) =>
        releaseProductionAnalysisAdmissionInTransaction(
          client,
          parsedWorkspaceId,
          idempotencyDigest,
          inputHash,
          actorId
        ),
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async purge(workspaceId: string, before: string, limit: number): Promise<number> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('production analysis admission purge limit is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, parsedWorkspaceId, async (client) => {
      const result = await client.query<{ purged_count: number | string }>(
        `SELECT appsea.purge_production_analysis_workflow_admissions($1, $2::timestamptz, $3)
             AS purged_count`,
        [parsedWorkspaceId, before, limit]
      )
      return Number(result.rows[0]?.purged_count ?? 0)
    })
  }
}
