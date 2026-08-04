import { createHash } from 'node:crypto'
import {
  complaintSchema,
  researchQualityBenchmarkSchema,
  researchQualitySnapshotSchema,
  type Complaint,
  type ResearchQualityBenchmark,
  type ResearchQualityBenchmarkCase,
  type ResearchQualitySnapshot
} from '@appsea/contracts'
import {
  calculateBrierScore,
  calculateExpectedCalibrationError,
  evaluateTopKRanking,
  type CalibrationObservation
} from '@appsea/scoring'
import { analyzeComplaint, clusterComplaints, deduplicateComplaints } from './index'

export const RESEARCH_QUALITY_BENCHMARK_VERSION = 'research-quality-benchmark-v1.0.0'
export const RESEARCH_QUALITY_EVALUATOR_VERSION = 'research-quality-evaluator-v1.0.0'

const benchmarkTimestamp = '2026-08-04T00:00:00.000Z'

function benchmarkComplaint(
  id: string,
  sourceRecordId: string,
  product: string,
  company: string,
  feature: string,
  category: string,
  text: string,
  language = 'en',
  sourceId = 'quality-benchmark'
): Complaint {
  return complaintSchema.parse({
    id,
    sourceId,
    sourceRecordId,
    canonicalLocator: null,
    capturedAt: benchmarkTimestamp,
    publishedAt: benchmarkTimestamp,
    query: 'synthetic quality benchmark',
    product,
    company,
    feature,
    category,
    text,
    language,
    synthetic: true,
    redacted: true,
    allowedRepresentation: 'fixture'
  })
}

/**
 * Small, redacted labels for deterministic regression checks. The strings are
 * intentionally synthetic and are not retained source evidence or market
 * observations.
 */
export const RESEARCH_QUALITY_BENCHMARK: ResearchQualityBenchmark =
  researchQualityBenchmarkSchema.parse({
    version: RESEARCH_QUALITY_BENCHMARK_VERSION,
    cases: [
      {
        id: 'quality-case-export',
        complaint: benchmarkComplaint(
          'quality-case-export',
          'record-export-1',
          'RelayBox',
          'Relay Labs',
          'export',
          'integration',
          'Synthetic label: exporting a conversation fails every time.'
        ),
        expected: {
          classification: 'complaint',
          complaintType: 'integration',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'export' },
          duplicateGroupId: 'quality-group-export',
          clusterGroupId: 'quality-cluster-export',
          actionable: true
        }
      },
      {
        id: 'quality-case-export-repost',
        complaint: benchmarkComplaint(
          'quality-case-export-repost',
          'record-export-1',
          'RelayBox',
          'Relay Labs',
          'export',
          'integration',
          'Synthetic label: exporting a conversation fails every time.'
        ),
        expected: {
          classification: 'complaint',
          complaintType: 'integration',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'export' },
          duplicateGroupId: 'quality-group-export',
          clusterGroupId: 'quality-cluster-export',
          actionable: true
        }
      },
      {
        id: 'quality-case-pricing',
        complaint: benchmarkComplaint(
          'quality-case-pricing',
          'record-pricing-1',
          'RelayBox',
          'Relay Labs',
          'billing',
          'pricing',
          'Synthetic label: the subscription price is confusing.'
        ),
        expected: {
          classification: 'complaint',
          complaintType: 'pricing',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'billing' },
          duplicateGroupId: 'quality-group-pricing',
          clusterGroupId: 'quality-cluster-pricing',
          actionable: true
        }
      },
      {
        id: 'quality-case-question',
        complaint: benchmarkComplaint(
          'quality-case-question',
          'record-question-1',
          'RelayBox',
          'Relay Labs',
          'keyboard navigation',
          'accessibility',
          'Synthetic label: how can keyboard navigation be enabled?'
        ),
        expected: {
          classification: 'question',
          complaintType: 'accessibility',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'keyboard navigation' },
          duplicateGroupId: 'quality-group-question',
          clusterGroupId: 'quality-cluster-accessibility',
          actionable: false
        }
      },
      {
        id: 'quality-case-generic-product',
        complaint: benchmarkComplaint(
          'quality-case-generic-product',
          'record-generic-1',
          'app',
          'Relay Labs',
          'sync',
          'workflow',
          'Synthetic label: sync needs too many manual steps.'
        ),
        expected: {
          classification: 'complaint',
          complaintType: 'workflow_gap',
          entities: { product: null, company: 'Relay Labs', feature: 'sync' },
          duplicateGroupId: 'quality-group-generic',
          clusterGroupId: 'quality-cluster-workflow',
          actionable: true
        }
      },
      {
        id: 'quality-case-praise',
        complaint: benchmarkComplaint(
          'quality-case-praise',
          'record-praise-1',
          'RelayBox',
          'Relay Labs',
          'search',
          'general',
          'Synthetic label: the search works perfectly, thank you.'
        ),
        expected: {
          classification: 'praise',
          complaintType: 'other',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'search' },
          duplicateGroupId: 'quality-group-praise',
          clusterGroupId: 'quality-cluster-general',
          actionable: false
        }
      },
      {
        id: 'quality-case-spam',
        complaint: benchmarkComplaint(
          'quality-case-spam',
          'record-spam-1',
          'RelayBox',
          'Relay Labs',
          'unknown',
          'general',
          'Synthetic label: buy now promo code casino.'
        ),
        expected: {
          classification: 'spam',
          complaintType: 'other',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'unknown' },
          duplicateGroupId: 'quality-group-spam',
          clusterGroupId: 'quality-cluster-general',
          actionable: false
        }
      },
      {
        id: 'quality-case-multilingual',
        complaint: benchmarkComplaint(
          'quality-case-multilingual',
          'record-multilingual-1',
          'RelayBox',
          'Relay Labs',
          'notifications',
          'performance',
          'Synthetic label: notifications are slow and sometimes late.',
          'en',
          'quality-benchmark-alt'
        ),
        expected: {
          classification: 'complaint',
          complaintType: 'performance',
          entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'notifications' },
          duplicateGroupId: 'quality-group-multilingual',
          clusterGroupId: 'quality-cluster-performance',
          actionable: true
        }
      }
    ],
    rankingCases: [
      { candidateId: 'quality-opportunity-a', reviewedScore: 92, accepted: true },
      { candidateId: 'quality-opportunity-b', reviewedScore: 86, accepted: true },
      { candidateId: 'quality-opportunity-c', reviewedScore: 82, accepted: false },
      { candidateId: 'quality-opportunity-d', reviewedScore: 74, accepted: false },
      { candidateId: 'quality-opportunity-e', reviewedScore: 68, accepted: true }
    ],
    evidenceSnapshotId: null,
    reviewedInputOnly: true,
    notes: [
      'Synthetic redacted labels exercise deterministic regression behavior only.',
      'No source coverage, market demand, or factor-level evidence is derived from this corpus.'
    ]
  })

type Pair = readonly [string, string]

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function metric(value: number, sampleSize: number) {
  return { value: Math.max(0, Math.min(1, Number(value.toFixed(4)))), sampleSize }
}

function pairs(values: string[]): Pair[] {
  const output: Pair[] = []
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      output.push([values[left]!, values[right]!])
    }
  }
  return output
}

function pairMetrics(expectedGroups: string[], predictedGroups: string[]) {
  const indexes = expectedGroups.map((_, index) => String(index))
  const allPairs = pairs(indexes)
  const expected = new Set(
    allPairs
      .filter(([left, right]) => expectedGroups[Number(left)] === expectedGroups[Number(right)])
      .map(([left, right]) => `${left}:${right}`)
  )
  const predicted = new Set(
    allPairs
      .filter(([left, right]) => predictedGroups[Number(left)] === predictedGroups[Number(right)])
      .map(([left, right]) => `${left}:${right}`)
  )
  const intersection = [...predicted].filter((pair) => expected.has(pair)).length
  const precision = predicted.size === 0 ? 0 : intersection / predicted.size
  const recall = expected.size === 0 ? 0 : intersection / expected.size
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    pairPrecision: metric(precision, allPairs.length),
    pairRecall: metric(recall, allPairs.length),
    f1: metric(f1, allPairs.length)
  }
}

function purityMetric(expectedGroups: string[], predictedGroups: string[]) {
  const groups = new Map<string, string[]>()
  predictedGroups.forEach((group, index) => {
    const values = groups.get(group) ?? []
    values.push(expectedGroups[index]!)
    groups.set(group, values)
  })
  const correctlyAssigned = [...groups.values()].reduce((total, values) => {
    const counts = new Map<string, number>()
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
    return total + Math.max(...counts.values())
  }, 0)
  return metric(
    expectedGroups.length === 0 ? 0 : correctlyAssigned / expectedGroups.length,
    expectedGroups.length
  )
}

function clusterGroups(complaints: Complaint[]): string[] {
  const clusters = clusterComplaints(complaints, { mode: 'production' })
  const groupByComplaint = new Map<string, string>()
  clusters.forEach((cluster) =>
    cluster.complaintIds.forEach((id) =>
      groupByComplaint.set(id, `${cluster.product}\0${cluster.category}`)
    )
  )
  return complaints.map(
    (complaint) => groupByComplaint.get(complaint.id) ?? `unclustered:${complaint.id}`
  )
}

function groupByKey(
  cases: ResearchQualityBenchmarkCase[],
  key: 'duplicateGroupId' | 'clusterGroupId'
) {
  return cases.map((entry) => entry.expected[key])
}

function evaluateEntity(cases: ResearchQualityBenchmarkCase[]) {
  const fields = ['product', 'company', 'feature'] as const
  let correct = 0
  let expectedCount = 0
  let expectedHits = 0
  let wrongLink = 0
  let abstained = 0
  let total = 0
  for (const entry of cases) {
    const analysis = analyzeComplaint(entry.complaint)
    for (const field of fields) {
      const expected = entry.expected.entities[field]
      const actual = analysis.entities[field].canonicalName
      total += 1
      if (expected !== null) expectedCount += 1
      if (actual === null) abstained += 1
      if (actual === expected) correct += 1
      if (expected !== null && actual === expected) expectedHits += 1
      if (actual !== null && actual !== expected) wrongLink += 1
    }
  }
  return {
    top1Accuracy: metric(total === 0 ? 0 : correct / total, total),
    topKRecall: metric(expectedCount === 0 ? 0 : expectedHits / expectedCount, expectedCount),
    abstentionRate: metric(total === 0 ? 0 : abstained / total, total),
    highImpactWrongLinkRate: metric(total === 0 ? 0 : wrongLink / total, total)
  }
}

function evaluateClassifier(cases: ResearchQualityBenchmarkCase[]) {
  const predictions = cases.map((entry) => ({
    actual: analyzeComplaint(entry.complaint),
    expected: entry.expected
  }))
  const accuracy = predictions.length
    ? predictions.filter((entry) => entry.actual.classification === entry.expected.classification)
        .length / predictions.length
    : 0
  const complaintTypeAccuracy = predictions.length
    ? predictions.filter((entry) => entry.actual.complaintType === entry.expected.complaintType)
        .length / predictions.length
    : 0
  const labels = [...new Set(predictions.map((entry) => entry.expected.classification))]
  const macroF1 = labels.length
    ? labels.reduce((total, label) => {
        const truePositive = predictions.filter(
          (entry) =>
            entry.expected.classification === label && entry.actual.classification === label
        ).length
        const falsePositive = predictions.filter(
          (entry) =>
            entry.expected.classification !== label && entry.actual.classification === label
        ).length
        const falseNegative = predictions.filter(
          (entry) =>
            entry.expected.classification === label && entry.actual.classification !== label
        ).length
        const precision =
          truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive)
        const recall =
          truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative)
        return (
          total + (precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall))
        )
      }, 0) / labels.length
    : 0
  const actionability: CalibrationObservation[] = predictions.map((entry) => ({
    probability: entry.actual.actionabilityProbability,
    outcome: entry.expected.actionable
  }))
  const predictedPositive = predictions.filter(
    (entry) => entry.actual.actionabilityProbability >= 0.5
  )
  const actionabilityPrecision = predictedPositive.length
    ? predictedPositive.filter((entry) => entry.expected.actionable).length /
      predictedPositive.length
    : 0
  return {
    accuracy: metric(accuracy, predictions.length),
    complaintTypeAccuracy: metric(complaintTypeAccuracy, predictions.length),
    macroF1: metric(macroF1, labels.length),
    actionabilityPrecision: metric(actionabilityPrecision, predictedPositive.length),
    calibrationError: metric(calculateExpectedCalibrationError(actionability), actionability.length)
  }
}

function evaluateStability(complaints: Complaint[]) {
  const unique = deduplicateComplaints(complaints)
  const baselineGroups = clusterGroups(unique)
  const injected = [...unique, { ...unique[0]!, id: 'quality-injected-duplicate' }]
  const injectedGroups = clusterGroups(injected).slice(0, unique.length)
  const duplicateInjection = baselineGroups.length
    ? baselineGroups.filter((group, index) => group === injectedGroups[index]).length /
      baselineGroups.length
    : 0

  const sourceIds = [...new Set(unique.map((complaint) => complaint.sourceId))]
  const ablatedSource = sourceIds.length > 1 ? sourceIds[sourceIds.length - 1] : null
  const remaining = ablatedSource
    ? unique.filter((complaint) => complaint.sourceId !== ablatedSource)
    : unique
  const baseline = clusterGroups(unique)
  const remainingGroups = clusterGroups(remaining)
  const baselineById = new Map(unique.map((complaint, index) => [complaint.id, baseline[index]]))
  const sourceAblation = remaining.length
    ? remaining.reduce(
        (total, complaint, index) =>
          total + (baselineById.get(complaint.id) === remainingGroups[index] ? 1 : 0),
        0
      ) / remaining.length
    : 1
  return {
    duplicateInjection: metric(duplicateInjection, baselineGroups.length),
    sourceAblation: metric(sourceAblation, remaining.length)
  }
}

export function evaluateResearchQuality(
  benchmark: ResearchQualityBenchmark = RESEARCH_QUALITY_BENCHMARK
) {
  const parsed = researchQualityBenchmarkSchema.parse(benchmark)
  const cases = parsed.cases
  const complaints = cases.map((entry) => entry.complaint)
  const classifier = evaluateClassifier(cases)
  const entity = evaluateEntity(cases)
  const deduplication = pairMetrics(
    groupByKey(cases, 'duplicateGroupId'),
    complaints.map(
      (complaint) =>
        `${complaint.sourceId}:${complaint.sourceRecordId}:${complaint.text.toLocaleLowerCase('en-US')}`
    )
  )
  const expectedClusterGroups = groupByKey(cases, 'clusterGroupId')
  const predictedClusterGroups = clusterGroups(complaints)
  const clustering = {
    ...pairMetrics(expectedClusterGroups, predictedClusterGroups),
    purity: purityMetric(expectedClusterGroups, predictedClusterGroups)
  }
  const ranking = evaluateTopKRanking(
    parsed.rankingCases.map((entry) => ({
      id: entry.candidateId,
      score: entry.reviewedScore,
      relevant: entry.accepted
    })),
    Math.min(3, parsed.rankingCases.length || 1)
  )
  const calibrationObservations: CalibrationObservation[] = cases.map((entry) => {
    const analysis = analyzeComplaint(entry.complaint)
    return { probability: analysis.actionabilityProbability, outcome: entry.expected.actionable }
  })
  return {
    classifier,
    entity,
    deduplication,
    clustering,
    stability: evaluateStability(complaints),
    ranking: {
      topKPrecision: metric(ranking.topKPrecision, ranking.sampleSize),
      topKRecall: metric(ranking.topKRecall, ranking.sampleSize),
      rankCorrelation: metric((ranking.rankCorrelation + 1) / 2, ranking.sampleSize)
    },
    calibration: {
      expectedCalibrationError: metric(
        calculateExpectedCalibrationError(calibrationObservations),
        calibrationObservations.length
      ),
      brierScore: metric(
        calculateBrierScore(calibrationObservations),
        calibrationObservations.length
      )
    }
  }
}

export function buildResearchQualitySnapshot(
  benchmark: ResearchQualityBenchmark = RESEARCH_QUALITY_BENCHMARK,
  generatedAt = new Date().toISOString()
): ResearchQualitySnapshot {
  const parsed = researchQualityBenchmarkSchema.parse(benchmark)
  const metrics = evaluateResearchQuality(parsed)
  const benchmarkHash = hash(parsed)
  const withoutHash = {
    schemaVersion: 'research-quality-v1.0.0' as const,
    benchmarkVersion: parsed.version,
    evaluatorVersion: RESEARCH_QUALITY_EVALUATOR_VERSION,
    generatedAt,
    benchmarkHash,
    synthetic: true as const,
    reviewedInputOnly: true as const,
    evidenceSnapshotId: parsed.evidenceSnapshotId,
    factorProvenance: 'reviewed-input-only' as const,
    metrics,
    warnings: [
      'This quality snapshot is computed from a synthetic, redacted benchmark and is not market evidence.',
      'Classifier, entity, deduplication, clustering, and ranking metrics are regression signals, not live calibration.',
      'Coverage and score factor provenance remain reviewed-input-only; no source coverage is derived.'
    ],
    provenance: {
      mode: 'synthetic-redacted-benchmark' as const,
      sourceCoverage: 'not-derived' as const,
      factorInputs: 'reviewed-input-only' as const,
      note: 'The benchmark is checked into the repository to detect deterministic pipeline drift before source activation.'
    }
  }
  return researchQualitySnapshotSchema.parse({
    ...withoutHash,
    contentHash: hash(withoutHash)
  })
}
