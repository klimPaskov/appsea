import type { Pool, QueryResultRow } from 'pg'
import {
  maintenanceSchedulerLeaseResultSchema,
  maintenanceSchedulerLeaseTokenSchema,
  maintenanceSchedulerNameSchema,
  maintenanceSchedulerOwnerIdSchema,
  maintenanceSchedulerReleaseResultSchema,
  maintenanceSchedulerRenewResultSchema,
  type MaintenanceSchedulerLeaseResult,
  type MaintenanceSchedulerLeaseToken,
  type MaintenanceSchedulerName,
  type MaintenanceSchedulerOwnerId,
  type MaintenanceSchedulerReleaseResult,
  type MaintenanceSchedulerRenewResult
} from '@appsea/contracts'
import { withDatabaseTransaction } from './transaction'

export const maintenanceSchedulerLeaseLimits = {
  minLeaseSeconds: 30,
  maxLeaseSeconds: 3_600,
  defaultLeaseSeconds: 900
} as const

interface LeaseRow extends QueryResultRow {
  acquired?: boolean
  lease_until?: Date | string | null
  lease_token?: string | null
  renewed?: boolean
  released?: boolean
}

function timestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function schedulerName(value: string): MaintenanceSchedulerName {
  return maintenanceSchedulerNameSchema.parse(value)
}

function ownerId(value: string): MaintenanceSchedulerOwnerId {
  return maintenanceSchedulerOwnerIdSchema.parse(value)
}

function leaseToken(value: string): MaintenanceSchedulerLeaseToken {
  return maintenanceSchedulerLeaseTokenSchema.parse(value)
}

function leaseSeconds(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < maintenanceSchedulerLeaseLimits.minLeaseSeconds ||
    value > maintenanceSchedulerLeaseLimits.maxLeaseSeconds
  ) {
    throw new Error('leaseSeconds must be an integer between 30 and 3600')
  }
  return value
}

export class PostgresMaintenanceSchedulerLeaseRepository {
  constructor(private readonly pool: Pool) {}

  async acquire(
    schedulerNameValue: string,
    ownerIdValue: string,
    leaseTokenValue: string,
    leaseSecondsValue: number = maintenanceSchedulerLeaseLimits.defaultLeaseSeconds
  ): Promise<MaintenanceSchedulerLeaseResult> {
    const validatedSchedulerName = schedulerName(schedulerNameValue)
    const validatedOwnerId = ownerId(ownerIdValue)
    const validatedLeaseToken = leaseToken(leaseTokenValue)
    const validatedLeaseSeconds = leaseSeconds(leaseSecondsValue)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<LeaseRow>(
        `SELECT acquired, lease_until, lease_token
           FROM appsea.acquire_maintenance_scheduler_lease($1, $2, $3, $4)`,
        [validatedSchedulerName, validatedOwnerId, validatedLeaseToken, validatedLeaseSeconds]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Maintenance scheduler lease returned no decision')
      return maintenanceSchedulerLeaseResultSchema.parse({
        acquired: Boolean(row.acquired),
        leaseUntil: timestamp(row.lease_until),
        leaseToken: row.lease_token ?? null
      })
    })
  }

  async renew(
    schedulerNameValue: string,
    ownerIdValue: string,
    leaseTokenValue: string,
    leaseSecondsValue: number = maintenanceSchedulerLeaseLimits.defaultLeaseSeconds
  ): Promise<MaintenanceSchedulerRenewResult> {
    const validatedSchedulerName = schedulerName(schedulerNameValue)
    const validatedOwnerId = ownerId(ownerIdValue)
    const validatedLeaseToken = leaseToken(leaseTokenValue)
    const validatedLeaseSeconds = leaseSeconds(leaseSecondsValue)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<LeaseRow>(
        `SELECT renewed, lease_until
           FROM appsea.renew_maintenance_scheduler_lease($1, $2, $3, $4)`,
        [validatedSchedulerName, validatedOwnerId, validatedLeaseToken, validatedLeaseSeconds]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Maintenance scheduler lease returned no renewal state')
      return maintenanceSchedulerRenewResultSchema.parse({
        renewed: Boolean(row.renewed),
        leaseUntil: timestamp(row.lease_until)
      })
    })
  }

  async release(
    schedulerNameValue: string,
    ownerIdValue: string,
    leaseTokenValue: string
  ): Promise<MaintenanceSchedulerReleaseResult> {
    const validatedSchedulerName = schedulerName(schedulerNameValue)
    const validatedOwnerId = ownerId(ownerIdValue)
    const validatedLeaseToken = leaseToken(leaseTokenValue)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<LeaseRow>(
        `SELECT released
           FROM appsea.release_maintenance_scheduler_lease($1, $2, $3)`,
        [validatedSchedulerName, validatedOwnerId, validatedLeaseToken]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Maintenance scheduler lease returned no release state')
      return maintenanceSchedulerReleaseResultSchema.parse({ released: Boolean(row.released) })
    })
  }
}
