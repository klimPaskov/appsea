import type { ScoreFactors, ScoreSnapshot } from '@appsea/contracts'
import { scoreSnapshotSchema } from '@appsea/contracts'

export const SCORE_VERSION = 'opportunity-score-v0.2.0'

export const scoreWeights: ScoreFactors = {
  complaintVolume: 20,
  painSeverity: 18,
  recurrence: 14,
  willingnessToPay: 10,
  competitiveGap: 14,
  buildFeasibility: 12,
  evidenceQuality: 12,
  contraryEvidencePenalty: 10
}

export class InvalidScoreSnapshotError extends Error {
  constructor() {
    super('Score snapshot does not match the supported deterministic scoring calculation')
    this.name = 'InvalidScoreSnapshotError'
  }
}

const positiveFactorNames: Array<keyof Omit<ScoreFactors, 'contraryEvidencePenalty'>> = [
  'complaintVolume',
  'painSeverity',
  'recurrence',
  'willingnessToPay',
  'competitiveGap',
  'buildFeasibility',
  'evidenceQuality'
]

export function calculateOpportunityScore(
  factors: ScoreFactors,
  calculatedAt = new Date().toISOString()
): ScoreSnapshot {
  const positive = positiveFactorNames.reduce(
    (sum, factor) => sum + factors[factor] * (scoreWeights[factor] / 100),
    0
  )
  const penalty = factors.contraryEvidencePenalty * (scoreWeights.contraryEvidencePenalty / 100)
  const score = Math.max(0, Math.min(100, Number((positive - penalty).toFixed(1))))

  return scoreSnapshotSchema.parse({
    score,
    version: SCORE_VERSION,
    calculatedAt,
    factors,
    weights: scoreWeights
  })
}

export function compareScoreSnapshots(a: ScoreSnapshot, b: ScoreSnapshot): number {
  return b.score - a.score
}

export function assertDeterministicScoreSnapshot(snapshot: ScoreSnapshot): ScoreSnapshot {
  const parsed = scoreSnapshotSchema.parse(snapshot)
  const expected = calculateOpportunityScore(parsed.factors, parsed.calculatedAt)
  const weightsMatch = Object.entries(scoreWeights).every(
    ([factor, weight]) => parsed.weights[factor as keyof ScoreFactors] === weight
  )
  if (parsed.version !== expected.version || parsed.score !== expected.score || !weightsMatch) {
    throw new InvalidScoreSnapshotError()
  }
  return parsed
}
