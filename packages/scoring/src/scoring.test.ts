import { describe, expect, it } from 'vitest'
import {
  assertDeterministicScoreSnapshot,
  calculateOpportunityScore,
  InvalidScoreSnapshotError,
  SCORE_VERSION
} from './index'

const base = {
  complaintVolume: 80,
  painSeverity: 82,
  recurrence: 75,
  willingnessToPay: 60,
  competitiveGap: 70,
  buildFeasibility: 76,
  evidenceQuality: 72,
  contraryEvidencePenalty: 20
}

describe('opportunity scoring', () => {
  it('is deterministic for the same inputs', () => {
    const at = '2026-07-10T00:00:00.000Z'
    expect(calculateOpportunityScore(base, at)).toEqual(calculateOpportunityScore(base, at))
  })

  it('uses the current score version and applies contrary evidence as a penalty', () => {
    const strong = calculateOpportunityScore(base)
    const penalized = calculateOpportunityScore({ ...base, contraryEvidencePenalty: 90 })
    expect(strong.version).toBe(SCORE_VERSION)
    expect(penalized.score).toBeLessThan(strong.score)
  })

  it('rejects tampered final scores, versions, and weights', () => {
    const valid = calculateOpportunityScore(base, '2026-07-10T00:00:00.000Z')
    expect(assertDeterministicScoreSnapshot(valid)).toEqual(valid)
    expect(() => assertDeterministicScoreSnapshot({ ...valid, score: valid.score + 1 })).toThrow(
      InvalidScoreSnapshotError
    )
    expect(() => assertDeterministicScoreSnapshot({ ...valid, version: 'made-up-v9' })).toThrow(
      InvalidScoreSnapshotError
    )
    expect(() =>
      assertDeterministicScoreSnapshot({
        ...valid,
        weights: { ...valid.weights, complaintVolume: valid.weights.complaintVolume + 1 }
      })
    ).toThrow(InvalidScoreSnapshotError)
  })
})
