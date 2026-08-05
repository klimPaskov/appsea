import {
  workspaceSourceQuotaHeadroomReadModelSchema,
  type SourceQuota,
  type WorkspaceSourceQuotaHeadroomReadModel
} from '@appsea/contracts'

export interface SourceQuotaHeadroomInput {
  policyQuota: SourceQuota | null
  enabled: boolean
  collectible: boolean
  synthetic: boolean
  windowStartedAt: string | null
  windowEndsAt: string | null
  requestsUsed: number | string | null
  requestsRemaining: number | string | null
}

const notes = {
  available: 'Quota is available for the current source window.',
  nearLimit: 'Quota is near the current source limit.',
  exhausted: 'Quota is exhausted for the current source window.',
  unknown: 'Quota usage has not been observed for the current source window.',
  blocked: 'Quota headroom is unavailable until the current source policy is active and approved.',
  missing: 'Quota metadata is not recorded for this source.'
} as const

function boundedCounter(value: number | string | null, maximum: number): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error('Stored source quota counter is outside the supported range')
  }
  return parsed
}

function empty(
  state: WorkspaceSourceQuotaHeadroomReadModel['state'],
  policyQuota: SourceQuota | null,
  note: string
): WorkspaceSourceQuotaHeadroomReadModel {
  return workspaceSourceQuotaHeadroomReadModelSchema.parse({
    state,
    windowStartedAt: null,
    windowEndsAt: null,
    requestsPerMinute: policyQuota?.requestsPerMinute ?? null,
    requestsUsed: null,
    requestsRemaining: null,
    note
  })
}

/**
 * Map the database's bounded current-minute quota observation into the private
 * source-health projection. This is deliberately read-only: reservation and
 * settlement state remain owned by the quota functions and worker boundary.
 */
export function deriveSourceQuotaHeadroom(
  input: SourceQuotaHeadroomInput
): WorkspaceSourceQuotaHeadroomReadModel {
  if (!input.policyQuota) return empty('unknown', null, notes.missing)

  const policyAllowsQuota = input.enabled && (input.collectible || input.synthetic)
  if (!policyAllowsQuota) return empty('blocked', input.policyQuota, notes.blocked)

  const requestsUsed = boundedCounter(input.requestsUsed, input.policyQuota.requestsPerMinute)
  const requestsRemaining = boundedCounter(
    input.requestsRemaining,
    input.policyQuota.requestsPerMinute
  )
  if (
    requestsUsed === null ||
    requestsRemaining === null ||
    input.windowStartedAt === null ||
    input.windowEndsAt === null
  ) {
    return empty('unknown', input.policyQuota, notes.unknown)
  }

  const nearLimitThreshold = Math.max(1, Math.ceil(input.policyQuota.requestsPerMinute * 0.1))
  const state =
    requestsRemaining === 0
      ? 'exhausted'
      : requestsRemaining <= nearLimitThreshold
        ? 'near_limit'
        : 'available'
  return workspaceSourceQuotaHeadroomReadModelSchema.parse({
    state,
    windowStartedAt: input.windowStartedAt,
    windowEndsAt: input.windowEndsAt,
    requestsPerMinute: input.policyQuota.requestsPerMinute,
    requestsUsed,
    requestsRemaining,
    note:
      state === 'exhausted'
        ? notes.exhausted
        : state === 'near_limit'
          ? notes.nearLimit
          : notes.available
  })
}
