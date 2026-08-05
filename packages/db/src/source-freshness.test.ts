import { describe, expect, it } from 'vitest'
import { sourcePolicySchema } from '@appsea/contracts'
import { deriveSourceFreshness } from './source-freshness'

const now = '2026-08-06T12:00:00.000Z'

function policy(freshness?: {
  mode: 'scheduled' | 'on_demand'
  expectedIntervalHours: number | null
  allowedDelayHours: number | null
}) {
  return sourcePolicySchema.parse({
    sourceId: 'source-under-test',
    displayName: 'Source under test',
    sourceType: 'api',
    enabled: true,
    policyState: 'approved',
    permittedPurposes: ['testing'],
    commercialUse: 'allowed',
    accessMethod: 'Official API',
    retentionDays: 30,
    deletionRequired: true,
    attributionRequired: true,
    displayMode: 'metadata-only',
    coverageNotes: [],
    reviewedAt: now,
    ...(freshness ? { freshness } : {})
  })
}

describe('source freshness projection', () => {
  it('marks a scheduled observation fresh through the allowed delay boundary', () => {
    const result = deriveSourceFreshness({
      policy: policy({ mode: 'scheduled', expectedIntervalHours: 24, allowedDelayHours: 12 }),
      healthState: 'healthy',
      collectible: true,
      synthetic: false,
      lastObservedAt: '2026-08-05T00:00:00.000Z',
      now
    })
    expect(result).toMatchObject({
      state: 'fresh',
      ageHours: 36,
      expectedIntervalHours: 24,
      allowedDelayHours: 12
    })
  })

  it('marks a scheduled observation stale after the reviewed window', () => {
    const result = deriveSourceFreshness({
      policy: policy({ mode: 'scheduled', expectedIntervalHours: 24, allowedDelayHours: 12 }),
      healthState: 'healthy',
      collectible: true,
      synthetic: false,
      lastObservedAt: '2026-08-04T23:00:00.000Z',
      now
    })
    expect(result.state).toBe('stale')
    expect(result.ageHours).toBe(37)
  })

  it('keeps blocked sources blocked and does not turn missing coverage into freshness', () => {
    const result = deriveSourceFreshness({
      policy: policy({ mode: 'scheduled', expectedIntervalHours: 24, allowedDelayHours: 24 }),
      healthState: 'blocked',
      collectible: false,
      synthetic: false,
      lastObservedAt: null,
      now
    })
    expect(result).toMatchObject({ state: 'blocked', lastObservedAt: null, ageHours: null })
  })

  it('labels owner-authorized imports on demand instead of claiming a schedule', () => {
    const result = deriveSourceFreshness({
      policy: policy({ mode: 'on_demand', expectedIntervalHours: null, allowedDelayHours: null }),
      healthState: 'healthy',
      collectible: true,
      synthetic: false,
      lastObservedAt: '2026-08-06T10:00:00.000Z',
      now
    })
    expect(result).toMatchObject({
      state: 'on_demand',
      ageHours: 2,
      expectedIntervalHours: null,
      allowedDelayHours: null
    })
  })

  it('keeps legacy policies explicitly unknown', () => {
    const result = deriveSourceFreshness({
      policy: policy(),
      healthState: 'unknown',
      collectible: true,
      synthetic: false,
      lastObservedAt: null,
      now
    })
    expect(result).toMatchObject({
      state: 'unknown',
      note: 'Freshness is not configured for this source.'
    })
  })
})
