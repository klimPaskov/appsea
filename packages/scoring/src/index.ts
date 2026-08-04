import type {
  BalancedScoreInput,
  ScoreFactors,
  ScoreSnapshot,
  ScoreSnapshotV1
} from '@appsea/contracts'
import {
  balancedScoreInputSchema,
  scoreSnapshotSchema,
  scoreSnapshotV1Schema
} from '@appsea/contracts'

export const SCORE_VERSION = 'opportunity-score-v0.2.0'
export const SCORE_V1_VERSION = 'opportunity-score-v1.0.0'
export const SCORE_V1_MODEL_VERSION = 'balanced-reviewed-input-v1'

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

const v1Weights = {
  demand: {
    complaintFrequency: 8,
    independentUserCount: 6,
    sourceDiversity: 5,
    recentVelocity: 5,
    timePersistence: 3,
    segmentDensity: 3
  },
  pain: {
    severity: 7,
    workflowCriticality: 5,
    workaroundCost: 4,
    switchingIntent: 4
  },
  marketOpening: {
    competitorDissatisfaction: 6,
    unresolvedSolutionGap: 7,
    substituteWeakness: 4,
    timing: 3
  },
  businessQuality: {
    willingnessToPay: 5,
    repeatUseRetention: 4,
    audienceReachability: 3,
    expansionPotential: 3
  },
  executionQuality: {
    mvpFeasibility: 5,
    dataIntegrationFeasibility: 4,
    trustComplianceFeasibility: 3,
    platformIndependence: 3
  }
} as const

const v1RiskMaximums = {
  sourceLegal: 10,
  platformConcentration: 7,
  commoditization: 5,
  regulatoryTrust: 5,
  manipulation: 4,
  eventDriven: 4
} as const

const v1ConfidenceWeights = {
  sample: 25,
  sourceDiversity: 20,
  directness: 15,
  entityConfidence: 10,
  timeStability: 10,
  manipulationSpam: 10,
  methodAgreementHumanReview: 10
} as const

type V1Dimension = keyof typeof v1Weights

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function v1PositiveScore(input: BalancedScoreInput): number {
  let total = 0
  for (const dimension of Object.keys(v1Weights) as V1Dimension[]) {
    const values = input[dimension]
    const weights = v1Weights[dimension]
    for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
      total += values[key] * (weights[key] / 100)
    }
  }
  return round(clamp(total, 0, 100))
}

function v1RiskScore(input: BalancedScoreInput): number {
  const total = (Object.keys(v1RiskMaximums) as Array<keyof typeof v1RiskMaximums>).reduce(
    (sum, key) => sum + input.riskPenalties[key],
    0
  )
  return round(clamp(total, 0, 35))
}

function v1EvidenceConfidence(input: BalancedScoreInput): number {
  const total = (
    Object.keys(v1ConfidenceWeights) as Array<keyof typeof v1ConfidenceWeights>
  ).reduce(
    (sum, key) => sum + input.confidenceComponents[key] * (v1ConfidenceWeights[key] / 100),
    0
  )
  return round(clamp(total, 0, 1), 3)
}

function factorProvenance(input: BalancedScoreInput, key: string) {
  const provenance = input.factorEvidence[key]
  if (!provenance) {
    throw new Error(`Missing evidence binding for balanced v1 factor ${key}`)
  }
  return provenance
}

function buildV1Explanations(input: BalancedScoreInput, confidence: number) {
  const explanations: Array<{
    key: string
    value: number
    weight: number
    contribution: number
    evidenceIds: string[]
    evidenceBasis: 'source-evidence' | 'reviewed-seed'
    transformation: string
    confidence: number
    changeReason: string
  }> = []
  for (const dimension of Object.keys(v1Weights) as V1Dimension[]) {
    const values = input[dimension]
    const weights = v1Weights[dimension]
    for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
      const factorKey = `${dimension}.${String(key)}`
      const provenance = factorProvenance(input, factorKey)
      explanations.push({
        key: factorKey,
        value: values[key],
        weight: weights[key],
        contribution: round(values[key] * (weights[key] / 100)),
        evidenceIds: [...provenance.evidenceIds],
        evidenceBasis: provenance.basis,
        transformation: 'linear normalized signal (0..100) multiplied by fixed spec weight',
        confidence,
        changeReason: 'Reviewed seed input; no complaint text is used to derive this factor.'
      })
    }
  }
  for (const key of Object.keys(v1RiskMaximums) as Array<keyof typeof v1RiskMaximums>) {
    const factorKey = `risk.${String(key)}`
    const provenance = factorProvenance(input, factorKey)
    explanations.push({
      key: factorKey,
      value: input.riskPenalties[key] * (100 / v1RiskMaximums[key]),
      weight: v1RiskMaximums[key],
      contribution: -input.riskPenalties[key],
      evidenceIds: [...provenance.evidenceIds],
      evidenceBasis: provenance.basis,
      transformation: 'bounded risk penalty subtracted after positive score',
      confidence,
      changeReason: 'Reviewed seed risk assessment; displayed as a visible penalty.'
    })
  }
  for (const key of Object.keys(v1ConfidenceWeights) as Array<keyof typeof v1ConfidenceWeights>) {
    const factorKey = `confidence.${String(key)}`
    const provenance = factorProvenance(input, factorKey)
    explanations.push({
      key: factorKey,
      value: input.confidenceComponents[key] * 100,
      weight: v1ConfidenceWeights[key],
      contribution: round((input.confidenceComponents[key] * v1ConfidenceWeights[key]) / 100, 3),
      evidenceIds: [...provenance.evidenceIds],
      evidenceBasis: provenance.basis,
      transformation: 'weighted evidence-confidence component (0..1)',
      confidence: input.confidenceComponents[key],
      changeReason: 'Reviewed evidence-quality component retained for replay.'
    })
  }
  return explanations
}

function compatibilityFactors(
  input: BalancedScoreInput,
  confidence: number,
  riskPenalty: number
): ScoreFactors {
  return {
    complaintVolume: input.demand.complaintFrequency,
    painSeverity: input.pain.severity,
    recurrence: input.demand.timePersistence,
    willingnessToPay: input.businessQuality.willingnessToPay,
    competitiveGap: input.marketOpening.unresolvedSolutionGap,
    buildFeasibility: input.executionQuality.mvpFeasibility,
    evidenceQuality: round(confidence * 100),
    contraryEvidencePenalty: round((riskPenalty / 35) * 100)
  }
}

export function calculateOpportunityScoreV1(
  input: BalancedScoreInput,
  calculatedAt = new Date().toISOString()
): ScoreSnapshotV1 {
  const parsed = balancedScoreInputSchema.parse(input)
  const rawScore = v1PositiveScore(parsed)
  const riskPenalty = v1RiskScore(parsed)
  const riskAdjustedScore = round(clamp(rawScore - riskPenalty, 0, 100))
  const evidenceConfidence = v1EvidenceConfidence(parsed)
  const uncertaintyMargin = round(20 * (1 - evidenceConfidence))
  const rankingScore = round(clamp(riskAdjustedScore - uncertaintyMargin, 0, 100))
  const factors = compatibilityFactors(parsed, evidenceConfidence, riskPenalty)
  return scoreSnapshotV1Schema.parse({
    score: rawScore,
    rawScore,
    riskPenalty,
    riskAdjustedScore,
    evidenceConfidence,
    uncertaintyMargin,
    rankingScore,
    version: SCORE_V1_VERSION,
    modelVersion: SCORE_V1_MODEL_VERSION,
    scoringProfile: parsed.profile,
    calculatedAt,
    evidenceSnapshotId: parsed.evidenceSnapshotId,
    factorEvidence: parsed.factorEvidence,
    coverageSummary: parsed.coverageSummary,
    freshnessSummary: parsed.freshnessSummary,
    factors,
    weights: scoreWeights,
    positiveFactors: {
      demand: parsed.demand,
      pain: parsed.pain,
      marketOpening: parsed.marketOpening,
      businessQuality: parsed.businessQuality,
      executionQuality: parsed.executionQuality
    },
    scoringWeights: {
      ...v1Weights,
      riskPenalties: v1RiskMaximums
    },
    riskPenalties: parsed.riskPenalties,
    confidenceComponents: parsed.confidenceComponents,
    componentExplanations: buildV1Explanations(parsed, evidenceConfidence)
  })
}

export function assertDeterministicScoreSnapshotV1(snapshot: ScoreSnapshotV1): ScoreSnapshotV1 {
  const parsed = scoreSnapshotV1Schema.parse(snapshot)
  const expected = calculateOpportunityScoreV1(
    {
      profile: parsed.scoringProfile,
      demand: parsed.positiveFactors.demand,
      pain: parsed.positiveFactors.pain,
      marketOpening: parsed.positiveFactors.marketOpening,
      businessQuality: parsed.positiveFactors.businessQuality,
      executionQuality: parsed.positiveFactors.executionQuality,
      riskPenalties: parsed.riskPenalties,
      confidenceComponents: parsed.confidenceComponents,
      evidenceSnapshotId: parsed.evidenceSnapshotId,
      factorEvidence: parsed.factorEvidence,
      coverageSummary: parsed.coverageSummary,
      freshnessSummary: parsed.freshnessSummary
    },
    parsed.calculatedAt
  )
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new InvalidScoreSnapshotError()
  }
  return parsed
}

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
  return scoreForRanking(b) - scoreForRanking(a)
}

export function assertDeterministicScoreSnapshot(snapshot: ScoreSnapshot): ScoreSnapshot {
  const parsed = scoreSnapshotSchema.parse(snapshot)
  if ('rankingScore' in parsed) return assertDeterministicScoreSnapshotV1(parsed)
  const expected = calculateOpportunityScore(parsed.factors, parsed.calculatedAt)
  const weightsMatch = Object.entries(scoreWeights).every(
    ([factor, weight]) => parsed.weights[factor as keyof ScoreFactors] === weight
  )
  if (parsed.version !== expected.version || parsed.score !== expected.score || !weightsMatch) {
    throw new InvalidScoreSnapshotError()
  }
  return parsed
}

export function scoreForRanking(snapshot: ScoreSnapshot): number {
  return 'rankingScore' in snapshot ? snapshot.rankingScore : snapshot.score
}

export function scoreConfidence(snapshot: ScoreSnapshot): number {
  return 'evidenceConfidence' in snapshot
    ? snapshot.evidenceConfidence
    : snapshot.factors.evidenceQuality / 100
}

export interface CalibrationObservation {
  probability: number
  outcome: boolean
}

export interface TopKRankingItem {
  id: string
  score: number
  relevant: boolean
}

export interface TopKRankingMetrics {
  topKPrecision: number
  topKRecall: number
  rankCorrelation: number
  sampleSize: number
}

function roundMetric(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Deterministic expected calibration error for bounded probabilities. */
export function calculateExpectedCalibrationError(
  observations: CalibrationObservation[],
  binCount = 5
): number {
  if (!Number.isInteger(binCount) || binCount < 1 || binCount > 20) {
    throw new Error('Calibration bin count must be an integer between 1 and 20')
  }
  if (observations.length === 0) return 0
  const bins = Array.from({ length: binCount }, () => ({ probability: 0, outcome: 0, count: 0 }))
  for (const observation of observations) {
    const probability = clamp(observation.probability, 0, 1)
    const index = Math.min(binCount - 1, Math.floor(probability * binCount))
    const bin = bins[index]!
    bin.probability += probability
    bin.outcome += observation.outcome ? 1 : 0
    bin.count += 1
  }
  const error = bins.reduce((total, bin) => {
    if (bin.count === 0) return total
    return (
      total +
      (bin.count / observations.length) *
        Math.abs(bin.probability / bin.count - bin.outcome / bin.count)
    )
  }, 0)
  return roundMetric(clamp(error, 0, 1))
}

/** Deterministic Brier score for bounded probabilities. */
export function calculateBrierScore(observations: CalibrationObservation[]): number {
  if (observations.length === 0) return 0
  const score =
    observations.reduce((total, observation) => {
      const probability = clamp(observation.probability, 0, 1)
      const outcome = observation.outcome ? 1 : 0
      return total + (probability - outcome) ** 2
    }, 0) / observations.length
  return roundMetric(clamp(score, 0, 1))
}

/** Evaluate ranking labels supplied as reviewed inputs; no market claims are inferred. */
export function evaluateTopKRanking(items: TopKRankingItem[], requestedK = 3): TopKRankingMetrics {
  if (!Number.isInteger(requestedK) || requestedK < 1 || requestedK > 100) {
    throw new Error('Top-k must be an integer between 1 and 100')
  }
  const ranked = [...items].sort((left, right) => {
    const scoreDelta = right.score - left.score
    return scoreDelta !== 0 ? scoreDelta : left.id.localeCompare(right.id)
  })
  const topK = ranked.slice(0, requestedK)
  const relevantCount = ranked.filter((item) => item.relevant).length
  const relevantInTopK = topK.filter((item) => item.relevant).length
  const topKPrecision = topK.length === 0 ? 0 : relevantInTopK / topK.length
  const topKRecall = relevantCount === 0 ? 0 : relevantInTopK / relevantCount
  const rankCorrelation = spearmanCorrelation(ranked)
  return {
    topKPrecision: roundMetric(clamp(topKPrecision, 0, 1)),
    topKRecall: roundMetric(clamp(topKRecall, 0, 1)),
    rankCorrelation,
    sampleSize: items.length
  }
}

function spearmanCorrelation(items: TopKRankingItem[]): number {
  if (items.length < 2) return items.length === 1 ? 1 : 0
  const scoreRanks = new Map(
    [...items]
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((item, index) => [item.id, index + 1])
  )
  const relevanceRanks = new Map(
    [...items]
      .sort(
        (left, right) =>
          Number(right.relevant) - Number(left.relevant) || left.id.localeCompare(right.id)
      )
      .map((item, index) => [item.id, index + 1])
  )
  const n = items.length
  const squaredDistance = items.reduce((total, item) => {
    const delta = (scoreRanks.get(item.id) ?? 0) - (relevanceRanks.get(item.id) ?? 0)
    return total + delta * delta
  }, 0)
  return roundMetric(clamp(1 - (6 * squaredDistance) / (n * (n * n - 1)), -1, 1))
}
