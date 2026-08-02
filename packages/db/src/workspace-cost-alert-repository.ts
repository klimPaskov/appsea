import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  workspaceCostAlertObservationSchema,
  type WorkspaceCostAlertObservation
} from '@appsea/contracts'
import { withWorkspaceTransaction } from './transaction'

interface WorkspaceCostAlertRow extends QueryResultRow {
  currency: string
  entry_count: string | number
  total_cost_micros: string | number
  estimated_cost_micros: string | number
  actual_cost_micros: string | number
}

function boundedCount(value: string | number): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
    throw new Error('Cost alert entry count is outside the supported bound')
  }
  return count
}

function boundedMicros(value: string | number, label: string): string {
  const text = String(value)
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(text)) {
    throw new Error(`${label} is outside the supported cost alert bound`)
  }
  return text
}

export class PostgresWorkspaceCostAlertRepository {
  constructor(private readonly pool: Pool) {}

  async listAlertObservations(
    workspaceId: string,
    periodStart: string,
    periodEnd: string,
    limit = 16
  ): Promise<WorkspaceCostAlertObservation[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const start = new Date(periodStart)
    const end = new Date(periodEnd)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new Error('Cost alert period must contain valid timestamps')
    }
    if (start >= end || end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1_000) {
      throw new Error('Cost alert period must be between one moment and 365 days')
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) {
      throw new Error('cost alert currency limit must be between 1 and 16')
    }
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<WorkspaceCostAlertRow>(
          `SELECT currency, entry_count, total_cost_micros,
                  estimated_cost_micros, actual_cost_micros
             FROM appsea.list_workspace_cost_alerts($1, $2, $3, $4)`,
          [parsedWorkspaceId, start.toISOString(), end.toISOString(), limit]
        )
        return result.rows.map((row) =>
          workspaceCostAlertObservationSchema.parse({
            currency: row.currency,
            entryCount: boundedCount(row.entry_count),
            totalCostMicros: boundedMicros(row.total_cost_micros, 'Cost alert total'),
            estimatedCostMicros: boundedMicros(row.estimated_cost_micros, 'Cost alert estimate'),
            actualCostMicros: boundedMicros(row.actual_cost_micros, 'Cost alert actual')
          })
        )
      },
      { readOnly: true }
    )
  }
}
