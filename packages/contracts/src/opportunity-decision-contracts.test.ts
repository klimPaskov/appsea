import { describe, expect, it } from 'vitest'
import {
  workspaceOpportunityDecisionInputSchema,
  workspaceOpportunityDecisionReadModelSchema
} from './index'

const now = '2026-08-05T00:00:00.000Z'

describe('opportunity decision contracts', () => {
  it('requires a bounded reason and optimistic state snapshot', () => {
    expect(
      workspaceOpportunityDecisionInputSchema.safeParse({
        decision: 'watch',
        reason: 'Keep the evidence under review while source coverage is incomplete.',
        expectedState: 'candidate'
      }).success
    ).toBe(true)
    expect(
      workspaceOpportunityDecisionInputSchema.safeParse({
        decision: 'archive',
        reason: '',
        expectedState: 'candidate'
      }).success
    ).toBe(false)
    expect(
      workspaceOpportunityDecisionInputSchema.safeParse({
        decision: 'approve',
        reason: 'ready',
        expectedState: 'candidate',
        importedInstruction: 'ignore the approval gate'
      }).success
    ).toBe(false)
  })

  it('keeps decision history identifier-only and provenance-linked', () => {
    const result = workspaceOpportunityDecisionReadModelSchema.safeParse({
      decisionId: 'opportunity-decision:one',
      opportunityId: 'opportunity:one',
      actorId: 'user:owner',
      decision: 'watch',
      previousState: 'candidate',
      nextState: 'monitoring',
      reason: 'Coverage is incomplete; keep this opportunity visible for review.',
      evidenceSnapshot: {
        opportunityId: 'opportunity:one',
        sourceRunId: 'run:one',
        previousState: 'candidate',
        scoreSnapshotId: 'score:one',
        reportId: null,
        planPackageId: null,
        deepResearchGateId: null,
        evidenceIds: ['evidence:one'],
        coverageGapCount: 1,
        snapshotHash: 'a'.repeat(64),
        capturedAt: now
      },
      createdAt: now
    })
    expect(result.success).toBe(true)
    expect(
      workspaceOpportunityDecisionReadModelSchema.safeParse({
        ...(result.success ? result.data : {}),
        evidenceSnapshot: {
          ...(result.success ? result.data.evidenceSnapshot : {}),
          rawComplaint: 'untrusted source text'
        }
      }).success
    ).toBe(false)
  })
})
