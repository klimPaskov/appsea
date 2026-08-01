import type { Pool, QueryResultRow } from 'pg'
import {
  maintenanceSchedulerNameSchema,
  maintenanceSchedulerRunMetricSchema,
  maintenanceSchedulerRunPurgeInputSchema,
  maintenanceSchedulerRunReadModelSchema,
  type MaintenanceSchedulerRunMetric,
  type MaintenanceSchedulerRunPurgeInput,
  type MaintenanceSchedulerRunReadModel
} from '@appsea/contracts'
import { withDatabaseTransaction } from './transaction'

interface RunMetricRow extends QueryResultRow {
  recorded?: boolean
  purged?: number | string
  run_id: string
  scheduler_name: string
  owner_id: string
  state: string
  started_at: Date | string
  finished_at: Date | string
  duration_ms: number
  failure_code: string | null
  counters: unknown
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapRunMetric(row: RunMetricRow): MaintenanceSchedulerRunReadModel {
  return maintenanceSchedulerRunReadModelSchema.parse({
    runId: row.run_id,
    schedulerName: row.scheduler_name,
    ownerId: row.owner_id,
    state: row.state,
    startedAt: timestamp(row.started_at),
    finishedAt: timestamp(row.finished_at),
    durationMs: Number(row.duration_ms),
    failureCode: row.failure_code,
    counters: row.counters
  })
}

/**
 * Narrow persistence boundary for secret-free maintenance scheduler
 * telemetry. The database role may call only the migration-owned functions;
 * it cannot read or mutate the backing table directly.
 */
export class PostgresMaintenanceSchedulerRunRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: MaintenanceSchedulerRunMetric): Promise<{ recorded: boolean }> {
    const parsed = maintenanceSchedulerRunMetricSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ recorded: boolean }>(
        `SELECT recorded
           FROM appsea.record_maintenance_scheduler_run(
             $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
           )`,
        [
          parsed.runId,
          parsed.schedulerName,
          parsed.ownerId,
          parsed.state,
          parsed.startedAt,
          parsed.finishedAt,
          parsed.durationMs,
          parsed.failureCode,
          JSON.stringify(parsed.counters)
        ]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Maintenance scheduler run metric returned no decision')
      return { recorded: Boolean(row.recorded) }
    })
  }

  async purge(input: MaintenanceSchedulerRunPurgeInput): Promise<number> {
    const parsed = maintenanceSchedulerRunPurgeInputSchema.parse(input)
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<{ purged: number | string }>(
        `SELECT purged
           FROM appsea.purge_maintenance_scheduler_runs($1, $2)`,
        [parsed.before, parsed.limit]
      )
      const row = result.rows[0]
      if (!row) throw new Error('Maintenance scheduler run purge returned no count')
      return Number(row.purged)
    })
  }

  async listRecent(
    schedulerNameValue?: string,
    limit = 50
  ): Promise<MaintenanceSchedulerRunReadModel[]> {
    const schedulerName =
      schedulerNameValue === undefined
        ? null
        : maintenanceSchedulerNameSchema.parse(schedulerNameValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Maintenance scheduler run list limit must be between 1 and 100')
    }
    return withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<RunMetricRow>(
        `SELECT run_id, scheduler_name, owner_id, state, started_at, finished_at,
                duration_ms, failure_code, counters
           FROM appsea.list_maintenance_scheduler_runs($1, $2)`,
        [schedulerName, limit]
      )
      return result.rows.map(mapRunMetric)
    })
  }
}
