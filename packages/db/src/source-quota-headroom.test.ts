import { describe, expect, it } from 'vitest'
import { deriveSourceQuotaHeadroom } from './source-quota-headroom'

const quota = {
  requestsPerMinute: 10,
  maxRecordsPerRequest: 100,
  maxRecordsPerRun: 500,
  costPerRequestMicros: 0
}

const observed = {
  windowStartedAt: '2026-08-06T10:00:00.000Z',
  windowEndsAt: '2026-08-06T10:01:00.000Z'
}

describe('source quota headroom projection', () => {
  it('reports available and near-limit capacity from the bounded window read', () => {
    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: true,
        collectible: true,
        synthetic: false,
        ...observed,
        requestsUsed: 4,
        requestsRemaining: 6
      })
    ).toMatchObject({ state: 'available', requestsUsed: 4, requestsRemaining: 6 })

    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: true,
        collectible: true,
        synthetic: false,
        ...observed,
        requestsUsed: '9',
        requestsRemaining: '1'
      })
    ).toMatchObject({ state: 'near_limit', requestsUsed: 9, requestsRemaining: 1 })
  })

  it('reports exhaustion without allowing negative remaining capacity', () => {
    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: true,
        collectible: true,
        synthetic: false,
        ...observed,
        requestsUsed: 10,
        requestsRemaining: 0
      })
    ).toMatchObject({ state: 'exhausted', requestsRemaining: 0 })
  })

  it('fails closed for blocked or unobserved policies', () => {
    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: false,
        collectible: false,
        synthetic: false,
        windowStartedAt: null,
        windowEndsAt: null,
        requestsUsed: null,
        requestsRemaining: null
      })
    ).toMatchObject({ state: 'blocked', requestsPerMinute: 10 })

    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: true,
        collectible: true,
        synthetic: false,
        windowStartedAt: null,
        windowEndsAt: null,
        requestsUsed: null,
        requestsRemaining: null
      })
    ).toMatchObject({ state: 'unknown', requestsPerMinute: 10 })

    expect(
      deriveSourceQuotaHeadroom({
        policyQuota: null,
        enabled: true,
        collectible: true,
        synthetic: false,
        ...observed,
        requestsUsed: 0,
        requestsRemaining: 0
      })
    ).toMatchObject({ state: 'unknown', requestsPerMinute: null })
  })

  it('rejects counters outside the policy limit', () => {
    expect(() =>
      deriveSourceQuotaHeadroom({
        policyQuota: quota,
        enabled: true,
        collectible: true,
        synthetic: false,
        ...observed,
        requestsUsed: 11,
        requestsRemaining: 0
      })
    ).toThrow(/quota counter/)
  })
})
