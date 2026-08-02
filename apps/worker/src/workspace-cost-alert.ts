import {
  workspaceCostAlertInputSchema,
  workspaceCostAlertLimits,
  workspaceCostAlertResultSchema,
  type WorkspaceCostAlertResult
} from '@appsea/contracts'
import type {
  PostgresSourceQuotaRepository,
  PostgresWorkspaceCostAlertRepository
} from '@appsea/db'

export interface WorkspaceCostAlertDependencies {
  /** Enumerates active workspace identifiers through the appsea_service role. */
  workspaces: Pick<PostgresSourceQuotaRepository, 'listActiveWorkspaceIds'>
  /** Reads only bounded currency aggregates through appsea_maintenance. */
  costs: Pick<PostgresWorkspaceCostAlertRepository, 'listAlertObservations'>
  /** Server-backed scheduler lease assertion. */
  assertLease: () => Promise<void>
}

function sortedUniqueWorkspaceIds(workspaceIds: readonly string[]): string[] {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right))
}

function boundedSum(left: bigint, right: string): bigint {
  const maximum = 999_999_999_999_999_999n
  const sum = left + BigInt(right)
  return sum > maximum ? maximum : sum
}

function periodFor(observedAt: string, periodSeconds: number): { start: string; end: string } {
  const end = new Date(observedAt)
  const start = new Date(end.getTime() - periodSeconds * 1_000)
  if (!Number.isFinite(end.getTime()) || !Number.isFinite(start.getTime())) {
    throw new Error('Cost alert period could not be derived from observedAt')
  }
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Inspect bounded workspace ledger aggregates without blocking admissions or
 * converting currencies. Unsupported currencies keep an otherwise quiet scan
 * incomplete so a deployment cannot mistake incomparable totals for a clear
 * cost boundary.
 */
export async function runWorkspaceCostAlert(
  rawInput: unknown,
  dependencies: WorkspaceCostAlertDependencies
): Promise<WorkspaceCostAlertResult> {
  const input = workspaceCostAlertInputSchema.parse(rawInput)
  const period = periodFor(input.observedAt, input.periodSeconds)
  const actualThreshold = BigInt(input.actualThresholdMicros)
  const estimatedThreshold = BigInt(input.estimatedThresholdMicros)

  await dependencies.assertLease()
  const workspaceIds = sortedUniqueWorkspaceIds(
    await dependencies.workspaces.listActiveWorkspaceIds()
  )
  const selectedWorkspaceIds = workspaceIds.slice(0, input.maxWorkspaces)
  let truncated = selectedWorkspaceIds.length < workspaceIds.length
  let rowsObserved = 0
  let entriesObserved = 0
  let targetCurrencyRows = 0
  let unsupportedCurrencyRows = 0
  let actualTargetCostMicros = 0n
  let estimatedTargetCostMicros = 0n
  let workspacesOverActualThreshold = 0
  let workspacesOverEstimatedThreshold = 0

  for (const workspaceId of selectedWorkspaceIds) {
    await dependencies.assertLease()
    const observations = await dependencies.costs.listAlertObservations(
      workspaceId,
      period.start,
      period.end,
      input.maxCurrenciesPerWorkspace
    )
    if (observations.length >= input.maxCurrenciesPerWorkspace) truncated = true

    let actualWorkspaceAlert = false
    let estimatedWorkspaceAlert = false
    for (const observation of observations) {
      rowsObserved = Math.min(workspaceCostAlertLimits.maxObservedRows, rowsObserved + 1)
      entriesObserved = Math.min(
        workspaceCostAlertLimits.maxObservedEntries,
        entriesObserved + observation.entryCount
      )
      if (observation.currency !== input.thresholdCurrency) {
        unsupportedCurrencyRows = Math.min(
          workspaceCostAlertLimits.maxObservedRows,
          unsupportedCurrencyRows + 1
        )
        continue
      }
      targetCurrencyRows += 1
      actualTargetCostMicros = boundedSum(actualTargetCostMicros, observation.actualCostMicros)
      estimatedTargetCostMicros = boundedSum(
        estimatedTargetCostMicros,
        observation.estimatedCostMicros
      )
      if (BigInt(observation.actualCostMicros) > actualThreshold) actualWorkspaceAlert = true
      if (BigInt(observation.estimatedCostMicros) > estimatedThreshold)
        estimatedWorkspaceAlert = true
    }
    if (actualWorkspaceAlert) workspacesOverActualThreshold += 1
    if (estimatedWorkspaceAlert) workspacesOverEstimatedThreshold += 1
  }
  await dependencies.assertLease()

  const alerted = workspacesOverActualThreshold > 0 || workspacesOverEstimatedThreshold > 0
  const incomplete = truncated || unsupportedCurrencyRows > 0
  const state = alerted ? 'alert' : incomplete ? 'incomplete' : 'clear'
  return workspaceCostAlertResultSchema.parse({
    observedAt: input.observedAt,
    periodStart: period.start,
    periodEnd: period.end,
    periodSeconds: input.periodSeconds,
    thresholdCurrency: input.thresholdCurrency,
    actualThresholdMicros: input.actualThresholdMicros,
    estimatedThresholdMicros: input.estimatedThresholdMicros,
    workspacesScanned: selectedWorkspaceIds.length,
    rowsObserved,
    entriesObserved,
    targetCurrencyRows,
    unsupportedCurrencyRows,
    actualTargetCostMicros: actualTargetCostMicros.toString(),
    estimatedTargetCostMicros: estimatedTargetCostMicros.toString(),
    workspacesOverActualThreshold,
    workspacesOverEstimatedThreshold,
    alerted,
    truncated,
    state
  })
}
