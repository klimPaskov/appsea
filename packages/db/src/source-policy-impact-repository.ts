import { appseaIdentifierSchema, type MaintenanceSchedulerFence } from '@appsea/contracts'
import { withWorkspaceTransaction } from './transaction'
import type { Pool } from 'pg'

export interface SourcePolicyImpactResult {
  analysisRunsExpired: number
  opportunitiesInvalidated: number
  opportunitiesRepointed: number
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${label} exceeded its bounded policy-impact result`)
  }
  return parsed
}

/**
 * Applies the non-destructive source-policy decay projection for one private
 * workspace. The database function owns the truth table and pointer repair;
 * this repository owns only input validation, workspace fencing, and bounded
 * result mapping.
 */
export class PostgresSourcePolicyImpactRepository {
  constructor(private readonly pool: Pool) {}

  async expireImpactedOutputs(
    workspaceId: string,
    batchSize = 100,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<SourcePolicyImpactResult> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error('batchSize must be an integer between 1 and 1000')
    }

    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<{
          analysis_runs_expired: number | string
          opportunities_invalidated: number | string
          opportunities_repointed: number | string
        }>(
          `SELECT analysis_runs_expired, opportunities_invalidated, opportunities_repointed
             FROM appsea.expire_source_policy_impacted_outputs($1, $2)`,
          [parsedWorkspaceId, batchSize]
        )
        const row = result.rows[0]
        if (!row) {
          throw new Error('Source policy impact function returned no result')
        }
        return {
          analysisRunsExpired: boundedInteger(
            row.analysis_runs_expired,
            'analysisRunsExpired',
            batchSize
          ),
          opportunitiesInvalidated: boundedInteger(
            row.opportunities_invalidated,
            'opportunitiesInvalidated',
            batchSize
          ),
          opportunitiesRepointed: boundedInteger(
            row.opportunities_repointed,
            'opportunitiesRepointed',
            batchSize
          )
        }
      },
      { maintenanceFence }
    )
  }
}
