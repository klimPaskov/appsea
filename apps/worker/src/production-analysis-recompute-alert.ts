import {
  productionAnalysisRecomputeAlertInputSchema,
  productionAnalysisRecomputeAlertLimits,
  productionAnalysisRecomputeAlertResultSchema,
  type ProductionAnalysisRecomputeAlertResult
} from '@appsea/contracts'
import type { PostgresProductionAnalysisRecomputeRepository } from '@appsea/db'

export interface ProductionAnalysisRecomputeAlertDependencies {
  /** Enumerates active workspace identifiers through the appsea_service role. */
  workspaces: Pick<PostgresProductionAnalysisRecomputeRepository, 'listActiveWorkspaceIds'>
  /** Reads only bounded state/timestamp observations through appsea_maintenance. */
  observations: Pick<PostgresProductionAnalysisRecomputeRepository, 'listAlertObservations'>
  /** Server-backed scheduler lease assertion. */
  assertLease: () => Promise<void>
}

function sortedUniqueWorkspaceIds(workspaceIds: readonly string[]): string[] {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right))
}

function ageSeconds(observedAtMs: number, requestedAt: string): number {
  const requestedAtMs = Date.parse(requestedAt)
  const age = Math.floor((observedAtMs - requestedAtMs) / 1_000)
  return Math.min(
    productionAnalysisRecomputeAlertLimits.maxAgeSeconds,
    Math.max(0, Number.isSafeInteger(age) ? age : 0)
  )
}

function updatedAgeSeconds(observedAtMs: number, updatedAt: string): number {
  const updatedAtMs = Date.parse(updatedAt)
  const age = Math.floor((observedAtMs - updatedAtMs) / 1_000)
  return Math.max(0, Number.isSafeInteger(age) ? age : 0)
}

/**
 * Inspect deletion/correction-triggered repair state without claiming,
 * dispatching, retrying, resolving, or exposing repair identifiers. A capped
 * scan remains incomplete unless an observed failure/block or aged job already
 * proves that an operator alert is needed.
 */
export async function runProductionAnalysisRecomputeAlert(
  rawInput: unknown,
  dependencies: ProductionAnalysisRecomputeAlertDependencies
): Promise<ProductionAnalysisRecomputeAlertResult> {
  const input = productionAnalysisRecomputeAlertInputSchema.parse(rawInput)
  const observedAtMs = Date.parse(input.observedAt)

  await dependencies.assertLease()
  const workspaceIds = sortedUniqueWorkspaceIds(
    await dependencies.workspaces.listActiveWorkspaceIds()
  )
  const selectedWorkspaceIds = workspaceIds.slice(0, input.maxWorkspaces)
  let truncated = selectedWorkspaceIds.length < workspaceIds.length
  let jobsObserved = 0
  let failedJobs = 0
  let blockedJobs = 0
  let staleJobs = 0
  let oldestOpenJobAgeSeconds: number | null = null

  for (const workspaceId of selectedWorkspaceIds) {
    await dependencies.assertLease()
    const observations = await dependencies.observations.listAlertObservations(
      workspaceId,
      input.maxJobsPerWorkspace
    )
    if (observations.length >= input.maxJobsPerWorkspace) truncated = true

    for (const observation of observations) {
      jobsObserved = Math.min(
        productionAnalysisRecomputeAlertLimits.maxObservedJobs,
        jobsObserved + 1
      )
      if (observation.state === 'failed') failedJobs += 1
      if (observation.state === 'blocked') blockedJobs += 1
      if (
        !['failed', 'blocked'].includes(observation.state) &&
        updatedAgeSeconds(observedAtMs, observation.updatedAt) >= input.alertAfterSeconds
      ) {
        staleJobs += 1
      }
      const jobAgeSeconds = ageSeconds(observedAtMs, observation.requestedAt)
      oldestOpenJobAgeSeconds =
        oldestOpenJobAgeSeconds === null
          ? jobAgeSeconds
          : Math.max(oldestOpenJobAgeSeconds, jobAgeSeconds)
    }
  }
  await dependencies.assertLease()

  const alerted =
    failedJobs > 0 ||
    blockedJobs > 0 ||
    (oldestOpenJobAgeSeconds !== null && oldestOpenJobAgeSeconds >= input.alertAfterSeconds)
  const state = alerted ? 'alert' : truncated ? 'incomplete' : 'clear'
  return productionAnalysisRecomputeAlertResultSchema.parse({
    observedAt: input.observedAt,
    alertAfterSeconds: input.alertAfterSeconds,
    workspacesScanned: selectedWorkspaceIds.length,
    jobsObserved,
    failedJobs,
    blockedJobs,
    staleJobs,
    oldestOpenJobAgeSeconds,
    alerted,
    truncated,
    state
  })
}
