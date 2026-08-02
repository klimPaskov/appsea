import {
  sourceQuotaReconciliationAlertLimits,
  sourceQuotaReconciliationAlertInputSchema,
  sourceQuotaReconciliationAlertResultSchema,
  type SourceQuotaReconciliationAlertResult
} from '@appsea/contracts'
import type { PostgresSourceQuotaRepository } from '@appsea/db'

export interface SourceQuotaReconciliationAlertDependencies {
  /** Enumerates active workspaces through the appsea_service role. */
  workspaces: Pick<PostgresSourceQuotaRepository, 'listActiveWorkspaceIds'>
  /** Reads only the bounded open-case projection through appsea_maintenance. */
  cases: Pick<PostgresSourceQuotaRepository, 'listReconciliationCases'>
  /** Server-backed scheduler lease assertion. */
  assertLease: () => Promise<void>
}

function sortedUniqueWorkspaceIds(workspaceIds: readonly string[]): string[] {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right))
}

function caseAgeSeconds(observedAtMs: number, firstSeenAt: string): number {
  const firstSeenAtMs = Date.parse(firstSeenAt)
  const ageSeconds = Math.floor((observedAtMs - firstSeenAtMs) / 1_000)
  return Math.min(
    sourceQuotaReconciliationAlertLimits.maxAgeSeconds,
    Math.max(0, Number.isSafeInteger(ageSeconds) ? ageSeconds : 0)
  )
}

/**
 * Inspect the private reconciliation projection without resolving, refunding,
 * re-fetching, or exposing source identifiers. A truncated scan is never
 * reported as clear, so deployment alerting cannot mistake a bounded read for
 * proof that no old case exists.
 */
export async function runSourceQuotaReconciliationAlert(
  rawInput: unknown,
  dependencies: SourceQuotaReconciliationAlertDependencies
): Promise<SourceQuotaReconciliationAlertResult> {
  const input = sourceQuotaReconciliationAlertInputSchema.parse(rawInput)
  const observedAtMs = Date.parse(input.observedAt)

  await dependencies.assertLease()
  const workspaceIds = sortedUniqueWorkspaceIds(
    await dependencies.workspaces.listActiveWorkspaceIds()
  )
  const selectedWorkspaceIds = workspaceIds.slice(0, input.maxWorkspaces)
  let truncated = selectedWorkspaceIds.length < workspaceIds.length
  let openCases = 0
  let oldestOpenCaseAgeSeconds: number | null = null

  for (const workspaceId of selectedWorkspaceIds) {
    await dependencies.assertLease()
    const cases = await dependencies.cases.listReconciliationCases(workspaceId, {
      limit: input.maxCasesPerWorkspace
    })
    if (cases.length >= input.maxCasesPerWorkspace) truncated = true
    for (const reconciliationCase of cases) {
      openCases = Math.min(sourceQuotaReconciliationAlertLimits.maxOpenCases, openCases + 1)
      const ageSeconds = caseAgeSeconds(observedAtMs, reconciliationCase.firstSeenAt)
      oldestOpenCaseAgeSeconds =
        oldestOpenCaseAgeSeconds === null
          ? ageSeconds
          : Math.max(oldestOpenCaseAgeSeconds, ageSeconds)
    }
  }
  await dependencies.assertLease()

  const alerted =
    oldestOpenCaseAgeSeconds !== null && oldestOpenCaseAgeSeconds >= input.alertAfterSeconds
  const state = alerted ? 'alert' : truncated ? 'incomplete' : 'clear'
  return sourceQuotaReconciliationAlertResultSchema.parse({
    observedAt: input.observedAt,
    alertAfterSeconds: input.alertAfterSeconds,
    workspacesScanned: selectedWorkspaceIds.length,
    openCases,
    oldestOpenCaseAgeSeconds,
    alerted,
    truncated,
    state
  })
}
