import type { Pool, QueryResultRow } from 'pg'
import {
  operationalAlertOutboxClaimInputSchema,
  operationalAlertOutboxClaimSchema,
  operationalAlertOutboxCompleteInputSchema,
  operationalAlertOutboxEnqueueInputSchema,
  operationalAlertOutboxFailureInputSchema,
  operationalAlertOutboxPurgeInputSchema,
  operationalAlertOutboxStateSchema,
  type OperationalAlertOutboxClaim,
  type OperationalAlertOutboxClaimInput,
  type OperationalAlertOutboxCompleteInput,
  type OperationalAlertOutboxEnqueueInput,
  type OperationalAlertOutboxFailureInput,
  type OperationalAlertOutboxPurgeInput,
  type OperationalAlertOutboxState
} from '@appsea/contracts'
import { withDatabaseTransaction } from './transaction'

interface AlertClaimRow extends QueryResultRow {
  delivery_id: string
  payload: unknown
  attempt_count: number | string
  claim_id: string
  claimed_by: string
  claim_expires_at: Date | string
}

interface AlertFailureRow extends QueryResultRow {
  applied: boolean
  state: string | null
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapClaim(row: AlertClaimRow): OperationalAlertOutboxClaim {
  return operationalAlertOutboxClaimSchema.parse({
    deliveryId: row.delivery_id,
    payload: row.payload,
    attemptCount: Number(row.attempt_count),
    claimId: row.claim_id,
    claimedBy: row.claimed_by,
    claimExpiresAt: timestamp(row.claim_expires_at)
  })
}

/**
 * Maintenance-role-only persistence for signed operational alerts. The
 * repository deliberately exposes no table query: migration 0082 owns the
 * security-definer functions and the external provider remains outside the
 * database transaction.
 */
export class PostgresOperationalAlertOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: OperationalAlertOutboxEnqueueInput): Promise<{ enqueued: boolean }> {
    const parsed = operationalAlertOutboxEnqueueInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ enqueued: boolean }>(
        `SELECT enqueued
           FROM appsea.enqueue_operational_alert($1, $2::jsonb, $3, $4)`,
        [parsed.deliveryId, JSON.stringify(parsed.payload), parsed.payloadHash, parsed.availableAt]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Operational alert enqueue returned no decision')
      return { enqueued: Boolean(row.enqueued) }
    })
  }

  async claim(input: OperationalAlertOutboxClaimInput): Promise<OperationalAlertOutboxClaim[]> {
    const parsed = operationalAlertOutboxClaimInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<AlertClaimRow>(
        `SELECT delivery_id, payload, attempt_count, claim_id, claimed_by, claim_expires_at
           FROM appsea.claim_operational_alerts($1, $2::uuid, $3, $4)`,
        [parsed.ownerId, parsed.claimId, parsed.limit, parsed.claimTtlSeconds]
      )
      return result.rows.map(mapClaim)
    })
  }

  async complete(input: OperationalAlertOutboxCompleteInput): Promise<{ completed: boolean }> {
    const parsed = operationalAlertOutboxCompleteInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ completed: boolean }>(
        `SELECT completed
           FROM appsea.complete_operational_alert($1, $2, $3::uuid, $4)`,
        [parsed.deliveryId, parsed.ownerId, parsed.claimId, parsed.sentAt]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Operational alert completion returned no decision')
      return { completed: Boolean(row.completed) }
    })
  }

  async fail(
    input: OperationalAlertOutboxFailureInput
  ): Promise<{ applied: boolean; state: OperationalAlertOutboxState | null }> {
    const parsed = operationalAlertOutboxFailureInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<AlertFailureRow>(
        `SELECT applied, state
           FROM appsea.fail_operational_alert($1, $2, $3::uuid, $4, $5)`,
        [parsed.deliveryId, parsed.ownerId, parsed.claimId, parsed.failureCode, parsed.retryAt]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Operational alert failure returned no decision')
      return {
        applied: Boolean(row.applied),
        state: row.state === null ? null : operationalAlertOutboxStateSchema.parse(row.state)
      }
    })
  }

  async purge(input: OperationalAlertOutboxPurgeInput): Promise<number> {
    const parsed = operationalAlertOutboxPurgeInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ purged: number | string }>(
        `SELECT purged
           FROM appsea.purge_operational_alerts($1, $2)`,
        [parsed.before, parsed.limit]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Operational alert purge returned no count')
      return Number(row.purged)
    })
  }
}
