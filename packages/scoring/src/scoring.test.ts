import { describe, expect, it } from 'vitest'
import {
  assertDeterministicScoreSnapshot,
  assertDeterministicScoreSnapshotV1,
  calculateOpportunityScore,
  calculateOpportunityScoreV1,
  calculateBrierScore,
  calculateExpectedCalibrationError,
  evaluateTopKRanking,
  InvalidScoreSnapshotError,
  SCORE_VERSION,
  SCORE_V1_VERSION
} from './index'
import { balancedScoreFactorKeys, type BalancedScoreInput } from '@appsea/contracts'

describe('quality metric helpers', () => {
  it('computes bounded deterministic calibration metrics', () => {
    const observations = [
      { probability: 0.9, outcome: true },
      { probability: 0.1, outcome: false }
    ]
    expect(calculateExpectedCalibrationError(observations)).toBe(0.1)
    expect(calculateBrierScore(observations)).toBe(0.01)
    expect(calculateExpectedCalibrationError(observations)).toBe(
      calculateExpectedCalibrationError([...observations].reverse())
    )
  })

  it('evaluates reviewed-input ranking labels with deterministic tie breaks', () => {
    const items = [
      { id: 'candidate-b', score: 90, relevant: false },
      { id: 'candidate-a', score: 90, relevant: true },
      { id: 'candidate-c', score: 80, relevant: true }
    ]
    expect(evaluateTopKRanking(items, 2)).toMatchObject({
      topKPrecision: 0.5,
      topKRecall: 0.5,
      sampleSize: 3
    })
    expect(evaluateTopKRanking(items, 2)).toEqual(evaluateTopKRanking(items, 2))
  })
})

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

const reviewedFactorEvidence = (snapshotId: string): BalancedScoreInput['factorEvidence'] =>
  Object.fromEntries(
    balancedScoreFactorKeys.map((key) => [
      key,
      {
        basis: 'reviewed-seed' as const,
        evidenceIds: [
          `reviewed-seed:${snapshotId}:${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
        ]
      }
    ])
  ) as BalancedScoreInput['factorEvidence']

const balancedInput = {
  profile: 'balanced' as const,
  demand: {
    complaintFrequency: 80,
    independentUserCount: 70,
    sourceDiversity: 60,
    recentVelocity: 65,
    timePersistence: 75,
    segmentDensity: 55
  },
  pain: { severity: 82, workflowCriticality: 78, workaroundCost: 64, switchingIntent: 52 },
  marketOpening: {
    competitorDissatisfaction: 70,
    unresolvedSolutionGap: 74,
    substituteWeakness: 58,
    timing: 60
  },
  businessQuality: {
    willingnessToPay: 60,
    repeatUseRetention: 62,
    audienceReachability: 68,
    expansionPotential: 54
  },
  executionQuality: {
    mvpFeasibility: 76,
    dataIntegrationFeasibility: 66,
    trustComplianceFeasibility: 72,
    platformIndependence: 64
  },
  riskPenalties: {
    sourceLegal: 1,
    platformConcentration: 2,
    commoditization: 1,
    regulatoryTrust: 1,
    manipulation: 0,
    eventDriven: 1
  },
  confidenceComponents: {
    sample: 0.8,
    sourceDiversity: 0.7,
    directness: 0.85,
    entityConfidence: 0.9,
    timeStability: 0.7,
    manipulationSpam: 0.95,
    methodAgreementHumanReview: 0.75
  },
  evidenceSnapshotId: 'evidence-snapshot-v1',
  factorEvidence: reviewedFactorEvidence('evidence-snapshot-v1'),
  coverageSummary: {
    sourceCount: 2,
    observationCount: 18,
    independentUserCount: 14,
    gapCount: 1,
    summary: 'Two permitted sources with one visible coverage gap.'
  },
  freshnessSummary: {
    oldestObservationAt: '2026-01-01T00:00:00.000Z',
    newestObservationAt: '2026-07-10T00:00:00.000Z',
    asOf: '2026-07-10T00:00:00.000Z',
    ageDays: 190,
    summary: 'Observations span the prior six months.'
  }
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

  it('calculates and replays the reviewed balanced v1 envelope', () => {
    const snapshot = calculateOpportunityScoreV1(balancedInput, '2026-07-10T00:00:00.000Z')
    expect(snapshot.version).toBe(SCORE_V1_VERSION)
    expect(snapshot.rawScore).toBe(snapshot.score)
    expect(snapshot.riskAdjustedScore).toBeLessThanOrEqual(snapshot.rawScore)
    expect(snapshot.rankingScore).toBeLessThanOrEqual(snapshot.riskAdjustedScore)
    expect(snapshot.evidenceConfidence).toBeGreaterThan(0.7)
    expect(assertDeterministicScoreSnapshotV1(snapshot)).toEqual(snapshot)
  })

  it('makes risk and confidence monotonic without changing reviewed inputs', () => {
    const baseline = calculateOpportunityScoreV1(balancedInput)
    const riskier = calculateOpportunityScoreV1({
      ...balancedInput,
      riskPenalties: { ...balancedInput.riskPenalties, sourceLegal: 10 }
    })
    const lessCertain = calculateOpportunityScoreV1({
      ...balancedInput,
      confidenceComponents: { ...balancedInput.confidenceComponents, sample: 0 }
    })
    expect(riskier.rankingScore).toBeLessThan(baseline.rankingScore)
    expect(lessCertain.rankingScore).toBeLessThan(baseline.rankingScore)
  })

  it('rejects tampered v1 fields and preserves historical v0.2 replay', () => {
    const snapshot = calculateOpportunityScoreV1(balancedInput, '2026-07-10T00:00:00.000Z')
    expect(() => assertDeterministicScoreSnapshotV1({ ...snapshot, rankingScore: 99 })).toThrow(
      InvalidScoreSnapshotError
    )
    expect(assertDeterministicScoreSnapshot(calculateOpportunityScore(base))).toBeTruthy()
  })

  it('requires complete factor-specific provenance bindings', () => {
    const missing = Object.fromEntries(
      Object.entries(balancedInput.factorEvidence).filter(
        ([key]) => key !== 'demand.complaintFrequency'
      )
    )
    expect(() =>
      calculateOpportunityScoreV1({ ...balancedInput, factorEvidence: missing })
    ).toThrow(/Every balanced v1 factor must have an evidence binding/)
    expect(() =>
      calculateOpportunityScoreV1({
        ...balancedInput,
        factorEvidence: {
          ...balancedInput.factorEvidence,
          'unknown.factor': {
            basis: 'reviewed-seed',
            evidenceIds: ['reviewed-seed:unknown-factor']
          }
        }
      })
    ).toThrow(/Unknown balanced v1 factor evidence key/)
  })
})
