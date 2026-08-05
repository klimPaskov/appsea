import {
  workspaceSourceFreshnessReadModelSchema,
  type SourcePolicy,
  type SourceFreshnessPolicy,
  type SourceHealthState,
  type WorkspaceSourceFreshnessReadModel
} from '@appsea/contracts'

const MAX_AGE_HOURS = 87_600

export interface SourceFreshnessProjectionInput {
  policy: SourcePolicy | null
  healthState: SourceHealthState
  collectible: boolean
  synthetic: boolean
  lastObservedAt: string | null
  now?: string
}

function ageHours(lastObservedAt: string, now: string): number | null {
  const observedMillis = Date.parse(lastObservedAt)
  const nowMillis = Date.parse(now)
  if (!Number.isFinite(observedMillis) || !Number.isFinite(nowMillis)) return null
  return Math.min(MAX_AGE_HOURS, Math.max(0, Math.floor((nowMillis - observedMillis) / 3_600_000)))
}

function scheduledValues(
  freshness: SourceFreshnessPolicy | undefined
): Pick<WorkspaceSourceFreshnessReadModel, 'expectedIntervalHours' | 'allowedDelayHours'> {
  return freshness?.mode === 'scheduled'
    ? {
        expectedIntervalHours: freshness.expectedIntervalHours,
        allowedDelayHours: freshness.allowedDelayHours
      }
    : { expectedIntervalHours: null, allowedDelayHours: null }
}

/**
 * Derive a bounded, private freshness projection from a reviewed policy and
 * retained observation timestamp. This never treats an unavailable source as
 * evidence of no complaints and never fetches or activates a connector.
 */
export function deriveSourceFreshness(
  input: SourceFreshnessProjectionInput
): WorkspaceSourceFreshnessReadModel {
  const freshness = input.policy?.freshness
  const configured = scheduledValues(freshness)
  const observedAge = input.lastObservedAt
    ? ageHours(input.lastObservedAt, input.now ?? new Date().toISOString())
    : null

  if (input.healthState === 'blocked' || (!input.synthetic && !input.collectible)) {
    return workspaceSourceFreshnessReadModelSchema.parse({
      state: 'blocked',
      lastObservedAt: input.lastObservedAt,
      ageHours: observedAge,
      ...configured,
      note: 'Freshness is blocked while the current source policy gate is not collectible.'
    })
  }

  if (freshness?.mode === 'on_demand') {
    return workspaceSourceFreshnessReadModelSchema.parse({
      state: 'on_demand',
      lastObservedAt: input.lastObservedAt,
      ageHours: observedAge,
      expectedIntervalHours: null,
      allowedDelayHours: null,
      note: 'This source is refreshed on demand; no scheduled freshness SLA is claimed.'
    })
  }

  if (
    freshness?.mode !== 'scheduled' ||
    freshness.expectedIntervalHours === null ||
    freshness.allowedDelayHours === null
  ) {
    return workspaceSourceFreshnessReadModelSchema.parse({
      state: 'unknown',
      lastObservedAt: input.lastObservedAt,
      ageHours: observedAge,
      ...configured,
      note: 'Freshness is not configured for this source.'
    })
  }

  if (input.lastObservedAt === null || observedAge === null) {
    return workspaceSourceFreshnessReadModelSchema.parse({
      state: 'unknown',
      lastObservedAt: input.lastObservedAt,
      ageHours: observedAge,
      ...configured,
      note: 'No valid source observation is available for the configured freshness window.'
    })
  }

  const staleAfterHours = freshness.expectedIntervalHours + freshness.allowedDelayHours
  const state = observedAge <= staleAfterHours ? 'fresh' : 'stale'
  return workspaceSourceFreshnessReadModelSchema.parse({
    state,
    lastObservedAt: input.lastObservedAt,
    ageHours: observedAge,
    ...configured,
    note:
      state === 'fresh'
        ? 'The latest source observation is within the reviewed freshness window.'
        : 'The latest source observation is outside the reviewed freshness window.'
  })
}
