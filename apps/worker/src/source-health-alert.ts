import {
  appseaIdentifierSchema,
  sourceHealthAlertInputSchema,
  sourceHealthAlertLimits,
  sourceHealthAlertObservationSchema,
  sourceHealthAlertResultSchema,
  type SourceHealthAlertObservation,
  type SourceHealthAlertResult
} from '@appsea/contracts'

export interface SourceHealthAlertDependencies {
  /** Enumerates active workspaces through the appsea_service role. */
  workspaces: {
    listActiveWorkspaceIds(): Promise<readonly string[]>
  }
  /** Reads only bounded scalar source-health observations through maintenance SQL. */
  observations: {
    listSourceHealthAlertObservations(
      workspaceId: string,
      limit: number
    ): Promise<readonly SourceHealthAlertObservation[]>
  }
  /** Server-backed scheduler lease assertion. */
  assertLease: () => Promise<void>
}

function sortedUniqueWorkspaceIds(workspaceIds: readonly string[]): string[] {
  return [
    ...new Set(workspaceIds.map((workspaceId) => appseaIdentifierSchema.parse(workspaceId)))
  ].sort((left, right) => left.localeCompare(right))
}

function ageSeconds(observedAtMs: number, attemptAt: string | null): number {
  if (attemptAt === null) return 0
  const attemptAtMs = Date.parse(attemptAt)
  if (!Number.isFinite(attemptAtMs)) return 0
  return Math.min(
    sourceHealthAlertLimits.maxAgeSeconds,
    Math.max(0, Math.floor((observedAtMs - attemptAtMs) / 1_000))
  )
}

function increment(value: number): number {
  return Math.min(sourceHealthAlertLimits.maxObservedSources, value + 1)
}

/**
 * Inspect reviewed source health without fetching, activating, retrying, or
 * changing source state. A capped scan stays incomplete unless a source
 * already proves an alert, so operators cannot mistake partial coverage for a
 * clean deployment signal.
 */
export async function runSourceHealthAlert(
  rawInput: unknown,
  dependencies: SourceHealthAlertDependencies
): Promise<SourceHealthAlertResult> {
  const input = sourceHealthAlertInputSchema.parse(rawInput)
  const observedAtMs = Date.parse(input.observedAt)

  await dependencies.assertLease()
  const workspaceIds = sortedUniqueWorkspaceIds(
    await dependencies.workspaces.listActiveWorkspaceIds()
  )
  const selectedWorkspaceIds = workspaceIds.slice(0, input.maxWorkspaces)
  let truncated = selectedWorkspaceIds.length < workspaceIds.length
  let sourcesObserved = 0
  let collectibleSources = 0
  let blockedSources = 0
  let unknownSources = 0
  let degradedSources = 0
  let staleSources = 0
  let exhaustedSources = 0
  let oldestDegradedAgeSeconds: number | null = null

  for (const workspaceId of selectedWorkspaceIds) {
    await dependencies.assertLease()
    const observations = await dependencies.observations.listSourceHealthAlertObservations(
      workspaceId,
      input.maxSourcesPerWorkspace
    )
    if (observations.length >= input.maxSourcesPerWorkspace) truncated = true

    for (const rawObservation of observations) {
      const observation = sourceHealthAlertObservationSchema.parse(rawObservation)
      sourcesObserved = increment(sourcesObserved)
      if (!observation.collectible) {
        blockedSources = increment(blockedSources)
        continue
      }
      collectibleSources = increment(collectibleSources)
      if (
        observation.healthState === 'unknown' ||
        observation.freshnessState === 'unknown' ||
        observation.quotaState === 'unknown'
      ) {
        unknownSources = increment(unknownSources)
      }
      if (observation.healthState === 'degraded') {
        degradedSources = increment(degradedSources)
        const currentAgeSeconds = ageSeconds(observedAtMs, observation.healthLastAttemptAt)
        oldestDegradedAgeSeconds =
          oldestDegradedAgeSeconds === null
            ? currentAgeSeconds
            : Math.max(oldestDegradedAgeSeconds, currentAgeSeconds)
      }
      if (observation.freshnessState === 'stale') staleSources = increment(staleSources)
      if (observation.quotaState === 'exhausted') exhaustedSources = increment(exhaustedSources)
    }
  }
  await dependencies.assertLease()

  const agedDegraded =
    oldestDegradedAgeSeconds !== null && oldestDegradedAgeSeconds >= input.alertAfterSeconds
  const alerted = staleSources > 0 || exhaustedSources > 0 || agedDegraded
  const state = alerted ? 'alert' : truncated ? 'incomplete' : 'clear'
  return sourceHealthAlertResultSchema.parse({
    observedAt: input.observedAt,
    alertAfterSeconds: input.alertAfterSeconds,
    workspacesScanned: selectedWorkspaceIds.length,
    sourcesObserved,
    collectibleSources,
    blockedSources,
    unknownSources,
    degradedSources,
    staleSources,
    exhaustedSources,
    oldestDegradedAgeSeconds,
    alerted,
    truncated,
    state
  })
}
