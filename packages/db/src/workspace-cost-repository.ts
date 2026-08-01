import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  workspaceCostSummaryQuerySchema,
  workspaceCostSummaryReadModelSchema,
  type WorkspaceCostSummaryQuery,
  type WorkspaceCostSummaryReadModel
} from '@appsea/contracts'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

const defaultPeriodMs = 30 * 24 * 60 * 60 * 1_000
const maximumPeriodMs = 365 * 24 * 60 * 60 * 1_000
const maximumCostMicros = 999_999_999_999_999_999n

export class WorkspaceCostSummaryQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceCostSummaryQueryError'
  }
}

interface ServerClockRow extends QueryResultRow {
  now: Date | string
}

interface CostLedgerGroupRow extends QueryResultRow {
  currency: string
  cost_type: string
  entry_count: string | number
  total_cost_micros: string
  estimated_cost_micros: string
  actual_cost_micros: string
}

interface CostTypeAccumulator {
  costType: string
  entryCount: number
  totalCostMicros: bigint
  estimatedCostMicros: bigint
  actualCostMicros: bigint
}

interface CurrencyAccumulator {
  currency: string
  entryCount: number
  totalCostMicros: bigint
  estimatedCostMicros: bigint
  actualCostMicros: bigint
  byCostType: CostTypeAccumulator[]
}

function asIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Database returned an invalid server clock')
  return date.toISOString()
}

function instantFromIso(value: string): Date {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Cost summary contains an invalid time')
  return date
}

function boundedCount(value: string | number, label: string): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
    throw new Error(`${label} is outside the supported cost summary bound`)
  }
  return count
}

function boundedMicros(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(value)) {
    throw new Error(`${label} is outside the supported cost summary bound`)
  }
  const micros = BigInt(value)
  if (micros > maximumCostMicros) {
    throw new Error(`${label} is outside the supported cost summary bound`)
  }
  return micros
}

function addMicros(left: bigint, right: bigint, label: string): bigint {
  const total = left + right
  if (total > maximumCostMicros) {
    throw new Error(`${label} is outside the supported cost summary bound`)
  }
  return total
}

function addCount(left: number, right: number): number {
  const total = left + right
  if (!Number.isSafeInteger(total) || total > 1_000_000) {
    throw new Error('Cost summary entry count is outside the supported bound')
  }
  return total
}

function resolvePeriod(
  query: WorkspaceCostSummaryQuery,
  asOf: Date
): { periodStart: Date; periodEnd: Date } {
  const periodEnd = query.to ? instantFromIso(query.to) : asOf
  if (periodEnd.getTime() > asOf.getTime()) {
    throw new WorkspaceCostSummaryQueryError('Cost summary end must not be in the future')
  }
  const periodStart = query.from
    ? instantFromIso(query.from)
    : new Date(periodEnd.getTime() - defaultPeriodMs)
  const duration = periodEnd.getTime() - periodStart.getTime()
  if (duration <= 0 || duration > maximumPeriodMs) {
    throw new WorkspaceCostSummaryQueryError(
      'Cost summary period must be between one moment and 365 days'
    )
  }
  return { periodStart, periodEnd }
}

function assertQueryPeriodShape(query: WorkspaceCostSummaryQuery): void {
  if (!query.from || !query.to) return
  const periodStart = instantFromIso(query.from)
  const periodEnd = instantFromIso(query.to)
  const duration = periodEnd.getTime() - periodStart.getTime()
  if (duration <= 0 || duration > maximumPeriodMs) {
    throw new WorkspaceCostSummaryQueryError(
      'Cost summary period must be between one moment and 365 days'
    )
  }
}

function mapSummary(
  workspaceId: string,
  asOf: Date,
  periodStart: Date,
  periodEnd: Date,
  rows: CostLedgerGroupRow[]
): WorkspaceCostSummaryReadModel {
  const currencies = new Map<string, CurrencyAccumulator>()

  for (const row of rows) {
    const entryCount = boundedCount(row.entry_count, 'Cost summary entry count')
    const totalCostMicros = boundedMicros(row.total_cost_micros, 'Cost summary total')
    const estimatedCostMicros = boundedMicros(row.estimated_cost_micros, 'Cost summary estimate')
    const actualCostMicros = boundedMicros(row.actual_cost_micros, 'Cost summary actual')
    let currency = currencies.get(row.currency)
    if (!currency) {
      currency = {
        currency: row.currency,
        entryCount: 0,
        totalCostMicros: 0n,
        estimatedCostMicros: 0n,
        actualCostMicros: 0n,
        byCostType: []
      }
      currencies.set(row.currency, currency)
    }
    currency.entryCount = addCount(currency.entryCount, entryCount)
    currency.totalCostMicros = addMicros(
      currency.totalCostMicros,
      totalCostMicros,
      'Cost summary total'
    )
    currency.estimatedCostMicros = addMicros(
      currency.estimatedCostMicros,
      estimatedCostMicros,
      'Cost summary estimate'
    )
    currency.actualCostMicros = addMicros(
      currency.actualCostMicros,
      actualCostMicros,
      'Cost summary actual'
    )
    currency.byCostType.push({
      costType: row.cost_type,
      entryCount,
      totalCostMicros,
      estimatedCostMicros,
      actualCostMicros
    })
  }

  const parsed = workspaceCostSummaryReadModelSchema.parse({
    workspaceId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    asOf: asOf.toISOString(),
    entryCount: [...currencies.values()].reduce(
      (total, currency) => addCount(total, currency.entryCount),
      0
    ),
    currencies: [...currencies.values()].map((currency) => ({
      currency: currency.currency,
      entryCount: currency.entryCount,
      totalCostMicros: currency.totalCostMicros.toString(),
      estimatedCostMicros: currency.estimatedCostMicros.toString(),
      actualCostMicros: currency.actualCostMicros.toString(),
      byCostType: currency.byCostType.map((costType) => ({
        costType: costType.costType,
        entryCount: costType.entryCount,
        totalCostMicros: costType.totalCostMicros.toString(),
        estimatedCostMicros: costType.estimatedCostMicros.toString(),
        actualCostMicros: costType.actualCostMicros.toString()
      }))
    }))
  })
  return parsed
}

export class PostgresWorkspaceCostRepository {
  constructor(private readonly pool: Pool) {}

  async readForUser(
    userId: string,
    workspaceId: string,
    query: WorkspaceCostSummaryQuery = {}
  ): Promise<WorkspaceCostSummaryReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedQuery = workspaceCostSummaryQuerySchema.parse(query)
    assertQueryPeriodShape(parsedQuery)

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const clock = await client.query<ServerClockRow>('SELECT clock_timestamp() AS now')
        const asOf = instantFromIso(asIsoString(clock.rows[0]?.now ?? ''))
        const { periodStart, periodEnd } = resolvePeriod(parsedQuery, asOf)
        const result = await client.query<CostLedgerGroupRow>(
          `SELECT currency,
                  cost_type,
                  COUNT(*)::text AS entry_count,
                  COALESCE(SUM(ROUND(amount * 1000000)), 0)::text AS total_cost_micros,
                  COALESCE(SUM(CASE WHEN estimate THEN ROUND(amount * 1000000) ELSE 0 END), 0)::text
                    AS estimated_cost_micros,
                  COALESCE(SUM(CASE WHEN NOT estimate THEN ROUND(amount * 1000000) ELSE 0 END), 0)::text
                    AS actual_cost_micros
             FROM appsea.cost_ledger_entries
            WHERE recorded_at >= $1 AND recorded_at < $2
            GROUP BY currency, cost_type
            ORDER BY currency, cost_type`,
          [periodStart.toISOString(), periodEnd.toISOString()]
        )
        return mapSummary(parsedWorkspaceId, asOf, periodStart, periodEnd, result.rows)
      },
      { readOnly: true }
    )
  }
}
