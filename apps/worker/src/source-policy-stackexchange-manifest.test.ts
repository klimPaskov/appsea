import { contentHash } from '@appsea/db'
import { describe, expect, it } from 'vitest'
import { stackExchangeSourcePolicy } from '@appsea/connectors'
import {
  buildStackExchangeSourcePolicyReviewManifest,
  stackExchangeSourcePolicyDefaultVersion,
  stackExchangeSourcePolicyEvidence
} from './source-policy-stackexchange-manifest'

describe('Stack Exchange source-policy review manifest', () => {
  it('is deterministic, secret-free, and remains disabled', () => {
    const first = buildStackExchangeSourcePolicyReviewManifest()
    const second = buildStackExchangeSourcePolicyReviewManifest()

    expect(first).toEqual(second)
    expect(first.policyVersion).toBe(stackExchangeSourcePolicyDefaultVersion)
    expect(first.policyContentHash).toBe(contentHash(stackExchangeSourcePolicy))
    expect(first.policyState).toBe('pending_review')
    expect(first.connectorEnabled).toBe(false)
    expect(first.approvalGate.activationAllowed).toBe(false)
    expect(JSON.stringify(first)).not.toMatch(/password|token|secret|question body|complaint text/i)
  })

  it('requires bounded policy versions and preserves the written-permission gate', () => {
    expect(() => buildStackExchangeSourcePolicyReviewManifest('BAD VERSION')).toThrow(
      /bounded lowercase identifier/
    )
    const manifest = buildStackExchangeSourcePolicyReviewManifest('stackexchange-2026-09-v2')
    expect(manifest.policy).toMatchObject({
      commercialUse: 'unknown',
      permissionEvidenceRequired: true
    })
    expect(manifest.approvalGate).toMatchObject({
      activationFunction: 'appsea.approve_source_policy',
      requiredReviewerRoles: ['legal', 'privacy', 'security'],
      reviewerMustBeIndependentOfPolicyOwner: true,
      approvalReferenceRequired: true,
      permissionEvidenceReferenceRequired: true,
      writtenConsentOrCommercialExceptionRequired: true,
      activationAllowed: false
    })
  })

  it('contains only first-party HTTPS evidence references', () => {
    expect(stackExchangeSourcePolicyEvidence.length).toBeGreaterThanOrEqual(4)
    for (const evidence of stackExchangeSourcePolicyEvidence) {
      const url = new URL(evidence.url)
      expect(url.protocol).toBe('https:')
      expect([
        'api.stackexchange.com',
        'engineering.stackexchange.com',
        'stackoverflow.com'
      ]).toContain(url.hostname)
      expect(evidence.observedAt).toBe('2026-08-06')
      expect(evidence.finding.length).toBeGreaterThan(20)
    }
  })
})
