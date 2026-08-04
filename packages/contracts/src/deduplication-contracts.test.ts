import { describe, expect, it } from 'vitest'
import { complaintDeduplicationDecisionSchema } from './index'

describe('complaint deduplication contracts', () => {
  const canonical = {
    version: 'complaint-deduplication-v1.0.0' as const,
    complaintId: 'complaint:one',
    canonicalComplaintId: 'complaint:one',
    sourceId: 'source:fixture',
    sourceRecordId: 'record-one',
    evidenceId: null,
    sourceItemId: null,
    relation: 'canonical' as const,
    decision: 'retained' as const,
    similarity: 1,
    reviewRequired: false,
    reason: 'No safe duplicate relationship was identified; retain the source observation.'
  }

  it('accepts a provenance-linked canonical decision', () => {
    expect(complaintDeduplicationDecisionSchema.parse(canonical)).toEqual(canonical)
  })

  it('requires near-duplicate candidates to stay retained for review', () => {
    expect(
      complaintDeduplicationDecisionSchema.safeParse({
        ...canonical,
        complaintId: 'complaint:two',
        canonicalComplaintId: 'complaint:one',
        relation: 'near-duplicate-candidate',
        decision: 'deduplicated',
        reviewRequired: false,
        similarity: 0.95,
        reason: 'Candidate requires review.'
      }).success
    ).toBe(false)
  })

  it('keeps source-native duplicate lineage explicit', () => {
    expect(
      complaintDeduplicationDecisionSchema.parse({
        ...canonical,
        complaintId: 'complaint:two',
        canonicalComplaintId: 'complaint:one',
        relation: 'source-record-duplicate',
        decision: 'deduplicated',
        reason: 'The source-native record identifier repeats.'
      })
    ).toMatchObject({
      complaintId: 'complaint:two',
      canonicalComplaintId: 'complaint:one',
      decision: 'deduplicated',
      reviewRequired: false
    })
  })
})
