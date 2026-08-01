import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourceQuotaReconciliationCaseSchema,
  sourceQuotaReconciliationListQuerySchema,
  sourceQuotaReconciliationResolveInputSchema,
  type SourceQuotaReconciliationCase,
  type SourceQuotaReconciliationListQuery,
  type SourceQuotaReconciliationResolveInput
} from '@appsea/contracts'
import {
  withAuthenticatedWorkspaceTransaction,
  withDatabaseTransaction,
  withWorkspaceTransaction
} from './transaction'

export type {
  SourceQuotaReconciliationCase,
  SourceQuotaReconciliationListQuery,
  SourceQuotaReconciliationResolveInput
} from '@appsea/contracts'

export interface SourceQuotaReservationInput {
  workspaceId: string
  sourceId: string
  policyVersion: string
  runId: string
  idempotencyKey: string
  reservationId: string
  requestedRecords: number
  requestedCostMicros: number
  expiresAt: string
  occurredAt: string
}

export interface SourceQuotaReservation {
  reservationId: string
  status: 'reserved' | 'committed' | 'released' | 'expired'
  replayed: boolean
  requestedRecords: number
  requestedCostMicros: number
}

export interface SourceQuotaSettlementInput {
  workspaceId: string
  reservationId: string
  actualRecords: number
  actualCostMicros: number
  occurredAt: string
}

export interface SourceQuotaReleaseInput {
  workspaceId: string
  reservationId: string
  occurredAt: string
}

export interface SourceQuotaWorkspaceId {
  workspaceId: string
}

interface ReservationRow extends QueryResultRow {
  reservation_id: string
  status: SourceQuotaReservation['status']
  replayed: boolean
  requested_records: number
  requested_cost_micros: string | number
}

interface ReconciliationCaseRow extends QueryResultRow {
  workspace_id: string
  reservation_id: string
  source_id: string
  policy_version: string
  run_id: string
  requested_records: number | string
  requested_cost_micros: number | string
  actual_records: number | string | null
  actual_cost_micros: number | string | null
  state: string
  first_seen_at: Date | string
  last_seen_at: Date | string
  resolution_code: string | null
  linked_run_id: string | null
  resolution_actor_id: string | null
  resolved_at: Date | string | null
}

function validateIdentifier(value: string, label: string): string {
  try {
    return appseaIdentifierSchema.parse(value)
  } catch {
    throw new Error(`${label} is not a persistence-safe identifier`)
  }
}

function validateHash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return value
}

function validatePolicyVersion(value: string): string {
  if (value.length < 1 || value.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new Error('policyVersion is not persistence-safe')
  }
  return value
}

function validateReservationId(value: string): string {
  if (value.length < 3 || value.length > 240 || !/^[a-z][a-z0-9_:-]*$/.test(value)) {
    throw new Error('reservationId is not persistence-safe')
  }
  return value
}

function validateBoundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is outside the supported range`)
  }
  return value
}

function asReservation(row: ReservationRow): SourceQuotaReservation {
  return {
    reservationId: row.reservation_id,
    status: row.status,
    replayed: row.replayed,
    requestedRecords: row.requested_records,
    requestedCostMicros: Number(row.requested_cost_micros)
  }
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function asReconciliationCase(row: ReconciliationCaseRow): SourceQuotaReconciliationCase {
  return sourceQuotaReconciliationCaseSchema.parse({
    workspaceId: row.workspace_id,
    reservationId: row.reservation_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    runId: row.run_id,
    requestedRecords: Number(row.requested_records),
    requestedCostMicros: Number(row.requested_cost_micros),
    actualRecords: row.actual_records === null ? null : Number(row.actual_records),
    actualCostMicros: row.actual_cost_micros === null ? null : Number(row.actual_cost_micros),
    state: row.state,
    firstSeenAt: asIso(row.first_seen_at),
    lastSeenAt: asIso(row.last_seen_at),
    resolutionCode: row.resolution_code,
    linkedRunId: row.linked_run_id,
    resolutionActorId: row.resolution_actor_id,
    resolvedAt: row.resolved_at === null ? null : asIso(row.resolved_at)
  })
}

async function readReconciliationCases(
  client: PoolClient,
  workspaceId: string,
  limit: number
): Promise<SourceQuotaReconciliationCase[]> {
  const result = await client.query<ReconciliationCaseRow>(
    `SELECT workspace_id, reservation_id, source_id, policy_version, run_id,
            requested_records, requested_cost_micros, actual_records,
            actual_cost_micros, state, first_seen_at, last_seen_at,
            resolution_code, linked_run_id, resolution_actor_id, resolved_at
       FROM appsea.list_source_quota_reconciliation_cases($1, $2)`,
    [workspaceId, limit]
  )
  return result.rows.map(asReconciliationCase)
}

export class PostgresSourceQuotaRepository {
  constructor(private readonly pool: Pool) {}

  async reserve(input: SourceQuotaReservationInput): Promise<SourceQuotaReservation> {
    const workspaceId = validateIdentifier(input.workspaceId, 'workspaceId')
    const sourceId = validateIdentifier(input.sourceId, 'sourceId')
    const policyVersion = validatePolicyVersion(input.policyVersion)
    const runId = validateIdentifier(input.runId, 'runId')
    const idempotencyKey = validateHash(input.idempotencyKey, 'idempotencyKey')
    const reservationId = validateReservationId(input.reservationId)
    const requestedRecords = validateBoundedInteger(
      input.requestedRecords,
      'requestedRecords',
      5000
    )
    if (requestedRecords < 1) throw new Error('requestedRecords must be positive')
    const requestedCostMicros = validateBoundedInteger(
      input.requestedCostMicros,
      'requestedCostMicros',
      1_000_000_000_000
    )
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query<ReservationRow>(
          `SELECT reservation_id, status, replayed, requested_records, requested_cost_micros
             FROM appsea.reserve_source_quota(
               $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz
             )`,
          [
            workspaceId,
            reservationId,
            sourceId,
            policyVersion,
            runId,
            idempotencyKey,
            requestedRecords,
            requestedCostMicros,
            input.expiresAt,
            input.occurredAt
          ]
        )
        const row = result.rows[0]
        if (!row) throw new Error('Source quota reservation returned no state')
        return asReservation(row)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async commit(input: SourceQuotaSettlementInput): Promise<void> {
    const workspaceId = validateIdentifier(input.workspaceId, 'workspaceId')
    const reservationId = validateReservationId(input.reservationId)
    const actualRecords = validateBoundedInteger(input.actualRecords, 'actualRecords', 5000)
    const actualCostMicros = validateBoundedInteger(
      input.actualCostMicros,
      'actualCostMicros',
      1_000_000_000_000
    )
    await withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        await client.query(
          `SELECT appsea.commit_source_quota_reservation(
             $1, $2, $3, $4, $5::timestamptz
           )`,
          [workspaceId, reservationId, actualRecords, actualCostMicros, input.occurredAt]
        )
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async release(input: SourceQuotaReleaseInput): Promise<void> {
    const workspaceId = validateIdentifier(input.workspaceId, 'workspaceId')
    const reservationId = validateReservationId(input.reservationId)
    await withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        await client.query(
          `SELECT appsea.release_source_quota_reservation($1, $2, $3::timestamptz)`,
          [workspaceId, reservationId, input.occurredAt]
        )
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  async listActiveWorkspaceIds(): Promise<string[]> {
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SourceQuotaWorkspaceId>(
          `SELECT workspace_id
             FROM appsea.list_active_workspaces_for_maintenance()`
        )
        return result.rows.map((row) => validateIdentifier(row.workspaceId, 'workspaceId'))
      },
      { readOnly: true }
    )
  }

  async expireStale(workspaceId: string, before: string, batchSize = 1000): Promise<number> {
    const validatedWorkspaceId = validateIdentifier(workspaceId, 'workspaceId')
    validateBoundedInteger(batchSize, 'batchSize', 10_000)
    if (batchSize < 1) throw new Error('batchSize must be positive')
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, async (client) => {
      const result = await client.query<{ expired_count: number | string }>(
        `SELECT appsea.expire_source_quota_reservations(
           $1, $2::timestamptz, $3
         ) AS expired_count`,
        [validatedWorkspaceId, before, batchSize]
      )
      return Number(result.rows[0]?.expired_count ?? 0)
    })
  }

  async purgeSettled(workspaceId: string, before: string, batchSize = 1000): Promise<number> {
    const validatedWorkspaceId = validateIdentifier(workspaceId, 'workspaceId')
    validateBoundedInteger(batchSize, 'batchSize', 10_000)
    if (batchSize < 1) throw new Error('batchSize must be positive')
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, async (client) => {
      const result = await client.query<{ purged_count: number | string }>(
        `SELECT appsea.purge_source_quota_reservations(
           $1, $2::timestamptz, $3
         ) AS purged_count`,
        [validatedWorkspaceId, before, batchSize]
      )
      return Number(result.rows[0]?.purged_count ?? 0)
    })
  }

  /**
   * Discover committed source quota reservations that have no completed
   * production result.  Discovery writes only the bounded reconciliation case
   * projection; it never refunds quota or authorizes another source request.
   */
  async listReconciliationCasesForUser(
    userId: string,
    workspaceId: string,
    query: SourceQuotaReconciliationListQuery = { limit: 50 }
  ): Promise<SourceQuotaReconciliationCase[]> {
    const validatedWorkspaceId = validateIdentifier(workspaceId, 'workspaceId')
    const parsedQuery = sourceQuotaReconciliationListQuerySchema.parse(query)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      validatedWorkspaceId,
      (client) => readReconciliationCases(client, validatedWorkspaceId, parsedQuery.limit)
    )
  }

  /** List cases from the dedicated maintenance role without user membership. */
  async listReconciliationCases(
    workspaceId: string,
    query: SourceQuotaReconciliationListQuery = { limit: 50 }
  ): Promise<SourceQuotaReconciliationCase[]> {
    const validatedWorkspaceId = validateIdentifier(workspaceId, 'workspaceId')
    const parsedQuery = sourceQuotaReconciliationListQuerySchema.parse(query)
    return withWorkspaceTransaction(this.pool, validatedWorkspaceId, (client) =>
      readReconciliationCases(client, validatedWorkspaceId, parsedQuery.limit)
    )
  }

  /**
   * Resolve a case only through the dedicated maintenance database role.  A
   * linked result must be the exact completed production run recorded on the
   * case; voiding records that no result exists without changing quota state.
   */
  async resolveReconciliationCase(
    input: SourceQuotaReconciliationResolveInput
  ): Promise<SourceQuotaReconciliationCase> {
    const parsed = sourceQuotaReconciliationResolveInputSchema.parse(input)
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<ReconciliationCaseRow>(
          `SELECT workspace_id, reservation_id, source_id, policy_version, run_id,
                  requested_records, requested_cost_micros, actual_records,
                  actual_cost_micros, state, first_seen_at, last_seen_at,
                  resolution_code, linked_run_id, resolution_actor_id, resolved_at
             FROM appsea.resolve_source_quota_reconciliation_case($1, $2, $3, $4, $5)`,
          [
            parsed.workspaceId,
            parsed.reservationId,
            parsed.resolutionCode,
            parsed.linkedRunId,
            parsed.actorId
          ]
        )
        const row = result.rows[0]
        if (!row) throw new Error('Source quota reconciliation did not return a case')
        return asReconciliationCase(row)
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }
}
