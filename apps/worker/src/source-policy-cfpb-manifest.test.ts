import { contentHash } from '@appsea/db'
import { describe, expect, it } from 'vitest'
import { cfpbSourcePolicy } from '@appsea/connectors'
import {
  buildCfpbSourcePolicyReviewManifest,
  cfpbSourcePolicyDefaultVersion,
  cfpbSourcePolicyEvidence
} from './source-policy-cfpb-manifest'

describe('CFPB source-policy review manifest', () => {
  it('is deterministic, secret-free, and remains disabled', () => {
    const first = buildCfpbSourcePolicyReviewManifest()
    const second = buildCfpbSourcePolicyReviewManifest()

    expect(first).toEqual(second)
    expect(first.policyVersion).toBe(cfpbSourcePolicyDefaultVersion)
    expect(first.policyContentHash).toBe(contentHash(cfpbSourcePolicy))
    expect(first.policyState).toBe('pending_review')
    expect(first.connectorEnabled).toBe(false)
    expect(first.approvalGate.activationAllowed).toBe(false)
    expect(JSON.stringify(first)).not.toMatch(/password|token|secret|complaint text/i)
  })

  it('requires bounded policy versions and preserves the independent review gate', () => {
    expect(() => buildCfpbSourcePolicyReviewManifest('BAD VERSION')).toThrow(
      /bounded lowercase identifier/
    )
    const manifest = buildCfpbSourcePolicyReviewManifest('cfpb-2026-08-v2')
    expect(manifest.policy.requiredReviewerRoles).toEqual(['legal', 'privacy', 'security'])
    expect(manifest.approvalGate).toMatchObject({
      activationFunction: 'appsea.approve_source_policy',
      requiredReviewerRoles: ['legal', 'privacy', 'security'],
      reviewerMustBeIndependentOfPolicyOwner: true,
      approvalReferenceRequired: true,
      counselConfirmationRequiredForCommercialUse: true,
      activationAllowed: false
    })
  })

  it('contains only first-party HTTPS evidence references', () => {
    expect(cfpbSourcePolicyEvidence.length).toBeGreaterThanOrEqual(4)
    for (const evidence of cfpbSourcePolicyEvidence) {
      const url = new URL(evidence.url)
      expect(url.protocol).toBe('https:')
      expect(['cfpb.github.io', 'www.consumerfinance.gov', 'files.consumerfinance.gov']).toContain(
        url.hostname
      )
      expect(evidence.observedAt).toBe('2026-08-06')
      expect(evidence.finding.length).toBeGreaterThan(20)
    }
  })
})
