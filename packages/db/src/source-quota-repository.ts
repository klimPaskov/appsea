import type { Pool, QueryResultRow } from 'pg'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { withDatabaseTransaction, withWorkspaceTransaction } from './transaction'

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
}
