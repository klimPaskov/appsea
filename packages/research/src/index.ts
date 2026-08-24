import { createHash } from 'node:crypto'
import { getOpportunity } from '@appsea/catalog'
import { FixtureConnector } from '@appsea/connectors'
import { calculateOpportunityScore, calculateOpportunityScoreV1 } from '@appsea/scoring'
import type {
  Complaint,
  ComplaintAnalysis,
  ComplaintDeduplicationDecision,
  ComplaintEntityReference,
  ComplaintType,
  ComplaintCluster,
  ComplaintClusterReviewState,
  CompetitiveResearchObservation,
  DeepResearchGateChecks,
  DeepResearchGateCompetitorRelationType,
  FixtureResearchArtifact,
  ProductionAnalysisComplaint,
  ProductionAnalysisInput,
  ProductionResearchArtifact
} from '@appsea/contracts'
import {
  complaintAnalysisSchema,
  complaintClusterSchema,
  deepResearchGateChecksSchema,
  fixtureResearchArtifactSchema,
  opportunitySchema,
  productionAnalysisInputSchema,
  productionResearchArtifactSchema
} from '@appsea/contracts'
import { buildResearchQualitySnapshot } from './quality-benchmark'

export const COMPLAINT_ANALYSIS_VERSION = 'complaint-analysis-v0.3.0'
export const COMPLAINT_DEDUPLICATION_VERSION = 'complaint-deduplication-v1.0.0'

export interface DeepResearchGateEvaluation {
  eligible: boolean
  blockingReasons: string[]
  coverageGaps: string[]
  confirmedObservationIds: string[]
  sourceIds: string[]
  evidenceIds: string[]
  contraryObservationIds: string[]
  competitorRelationTypes: DeepResearchGateCompetitorRelationType[]
}

export interface DeepResearchGateClusterReviewState {
  clusterVersionId: string
  reviewState: ComplaintClusterReviewState
}

const NEAR_DUPLICATE_THRESHOLD = 0.9
const MAX_NEAR_DUPLICATE_CANDIDATES = 64

const genericEntityLabels = new Set(['app', 'application', 'software', 'tool', 'teams', 'pages'])

const instructionLikeSignals: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    id: 'prompt-injection-instruction',
    pattern: /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i
  },
  {
    id: 'prompt-boundary-reference',
    pattern: /\b(?:system|developer|assistant)\s+(?:prompt|message|instruction)\b/i
  },
  {
    id: 'secret-extraction-request',
    pattern:
      /\b(?:reveal|show|print|leak|expose|dump)\b.{0,60}\b(?:prompt|secret|token|credential|api\s*key|password)\b/i
  },
  {
    id: 'repository-control-target',
    pattern:
      /(?:AGENTS\.md|\.agents[\\/]skills|\.codex[\\/]agents|repository\s+memory|source\s+code|permissions?)/i
  },
  {
    id: 'tool-execution-command',
    pattern: /(?:^|\n)\s*(?:run|execute|call)\s+(?:this|the)?\s*(?:command|tool|script)\b/i
  },
  {
    id: 'role-jailbreak',
    pattern: /\b(?:you are now|act as|jailbreak|bypass\s+(?:the\s+)?policy)\b/i
  }
]

export interface ComplaintContentSafetyAssessment {
  manipulationRisk: number
  signals: string[]
}

/**
 * Detect instruction-shaped source text before it can influence derived
 * complaint fields. The text remains immutable evidence; this function only
 * creates a deterministic review signal and never executes or rewrites it.
 */
export function assessComplaintContentSafety(text: string): ComplaintContentSafetyAssessment {
  const normalized = normalizeComplaintText(text)
  const signals = instructionLikeSignals
    .filter(({ pattern }) => pattern.test(normalized))
    .map(({ id }) => id)
  if (signals.length === 0) return { manipulationRisk: 0, signals: [] }
  return {
    manipulationRisk: Math.min(1, Number((0.85 + (signals.length - 1) * 0.05).toFixed(2))),
    signals
  }
}

function lower(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function classifyComplaintType(category: string, text: string): ComplaintType {
  const value = `${lower(category)} ${lower(text)}`
  if (/(missing|lack|no\s+(?:support|way|option)|cannot\s+export)/.test(value)) {
    return 'missing_capability'
  }
  if (/(price|pricing|billing|charge|subscription|refund|cost)/.test(value)) return 'pricing'
  if (/(privacy|personal data|tracking)/.test(value)) return 'privacy'
  if (/(security|breach|permission|token)/.test(value)) return 'security'
  if (/(integrat|webhook|sync|export|import|api)/.test(value)) return 'integration'
  if (/(slow|latency|performance|timeout|loading)/.test(value)) return 'performance'
  if (/(manual|handoff|coordination|copy and paste|workaround|reconciliation)/.test(value)) {
    return 'workflow_gap'
  }
  if (/(confus|discover|hard to use|too many steps|friction)/.test(value)) return 'usability'
  if (/(crash|freeze|outage|down|error|fail|broken|unread|drift)/.test(value)) {
    return 'broken_behavior'
  }
  if (/(support|response|ticket|help desk)/.test(value)) return 'support'
  if (/(accessib|screen reader|keyboard|contrast)/.test(value)) return 'accessibility'
  if (/(windows|macos|ios|android|browser|platform)/.test(value)) return 'platform_restriction'
  return 'other'
}

function classifyContent(category: string, text: string): ComplaintAnalysis['classification'] {
  const value = `${lower(category)} ${lower(text)}`
  if (/\?$/.test(text.trim()) || /^(how|why|where|can)\b/.test(lower(text))) return 'question'
  if (/(love|great|works perfectly|thank you|thanks)/.test(value)) return 'praise'
  if (/(spam|casino|buy now|promo code)/.test(value)) return 'spam'
  if (/(feature request|would like|please add|could you add|wish there was)/.test(value)) {
    return 'feature_request'
  }
  return 'complaint'
}

function severityFor(category: string, text: string): number {
  const value = `${lower(category)} ${lower(text)}`
  if (/(data loss|lost data|security breach|fraud|safety|critical)/.test(value)) return 5
  if (
    /(blocked|cannot complete|can't complete|unusable|outage|down|revenue|compliance)/.test(value)
  ) {
    return 4
  }
  if (/(fail|broken|error|duplicate|manual|missing|slow|drift)/.test(value)) return 3
  if (/(confus|friction|annoy|delay|extra step)/.test(value)) return 2
  return 1
}

function recurrenceFor(category: string, text: string): ComplaintAnalysis['recurrence'] {
  const value = `${lower(category)} ${lower(text)}`
  if (/(always|every time|each time|constantly|never)/.test(value)) return 'persistent'
  if (/(again|repeated|often|daily|weekly|keeps|still)/.test(value)) return 'repeated'
  if (/(sometimes|occasionally|once)/.test(value)) return 'occasional'
  return 'unknown'
}

function switchingIntentFor(category: string, text: string): ComplaintAnalysis['switchingIntent'] {
  const value = `${lower(category)} ${lower(text)}`
  if (/(switch|alternative|replace|churn|leave|moving to)/.test(value)) return 'explicit'
  if (/(wish there was|need a better|looking for)/.test(value)) return 'possible'
  return 'unknown'
}

function paymentSignalFor(category: string, text: string): ComplaintAnalysis['paymentSignal'] {
  const value = `${lower(category)} ${lower(text)}`
  if (/(pay|paid|budget|revenue|costs? us|willing to)/.test(value)) return 'explicit'
  if (/(price|pricing|subscription|billing|charge)/.test(value)) return 'weak'
  return 'unknown'
}

function entityReference(
  entityType: ComplaintEntityReference['entityType'],
  surfaceText: string
): ComplaintEntityReference {
  const normalized = normalizeComplaintText(surfaceText)
  const ambiguous = genericEntityLabels.has(lower(normalized))
  return {
    entityType,
    surfaceText: normalized,
    canonicalName: ambiguous ? null : normalized,
    confidence: ambiguous ? 0.45 : 0.9,
    resolution: ambiguous ? 'ambiguous' : normalized === surfaceText ? 'exact' : 'normalized',
    evidence: 'source-field'
  }
}

type ContextEntityType = 'substitute' | 'competitor'

interface ExplicitContextEntityPattern {
  entityType: ContextEntityType
  pattern: RegExp
}

/**
 * Resolve only names that the source text explicitly labels as an alternative
 * or competitor. Quoted or delimiter-bound names keep ordinary prose from
 * becoming a market entity; unmentioned dimensions stay unresolved.
 */
const explicitContextEntityPatterns: ReadonlyArray<ExplicitContextEntityPattern> = [
  {
    entityType: 'competitor',
    pattern: /\bcompetitor\s+(?:called|named|is)\s+["“]([^"”]{1,120})["”]/gi
  },
  {
    entityType: 'competitor',
    pattern:
      /\bcompetitor\s*[:=-]\s*([^,.;!?]{2,120}?)(?=\s+(?:still|handles|has|lacks|offers|supports|is|was|can|but|while|and)\b|[,.!?;]|$)/gi
  },
  {
    entityType: 'substitute',
    pattern: /\b(?:alternative|replacement)\s+(?:called|named|is)\s+["“]([^"”]{1,120})["”]/gi
  },
  {
    entityType: 'substitute',
    pattern:
      /\b(?:alternative|replacement)\s*[:=-]\s*([^,.;!?]{2,120}?)(?=\s+(?:still|handles|has|lacks|offers|supports|is|was|can|but|while|and)\b|[,.!?;]|$)/gi
  },
  {
    entityType: 'substitute',
    pattern:
      /\b(?:switched|switching|moved|moving|migrated|migrating)\s+to\s+["“]([^"”]{1,120})["”]/gi
  },
  {
    entityType: 'substitute',
    pattern: /\b(?:using|use|adopted|replaced\s+with)\s+["“]([^"”]{1,120})["”]/gi
  }
]

function explicitContextEntityReference(
  entityType: ContextEntityType,
  surfaceText: string
): ComplaintEntityReference | null {
  const normalized = normalizeComplaintText(surfaceText)
  if (!normalized || genericEntityLabels.has(lower(normalized))) return null
  return {
    entityType,
    surfaceText: normalized,
    canonicalName: normalized,
    confidence: 0.78,
    resolution: 'contextual',
    evidence: 'source-context'
  }
}

function extractExplicitContextEntities(text: string): {
  substitutes: ComplaintEntityReference[]
  competitors: ComplaintEntityReference[]
} {
  const byType: Record<ContextEntityType, ComplaintEntityReference[]> = {
    substitute: [],
    competitor: []
  }
  const seen = new Set<string>()
  for (const { entityType, pattern } of explicitContextEntityPatterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const reference = explicitContextEntityReference(entityType, match[1] ?? '')
      if (!reference) continue
      const key = `${entityType}\0${lower(reference.canonicalName ?? reference.surfaceText)}`
      if (seen.has(key)) continue
      seen.add(key)
      byType[entityType].push(reference)
    }
  }
  return {
    substitutes: byType.substitute,
    competitors: byType.competitor
  }
}

export function analyzeComplaint(complaint: Complaint): ComplaintAnalysis {
  const normalizedText = normalizeComplaintText(complaint.text)
  const safety = assessComplaintContentSafety(normalizedText)
  const safetyFlagged = safety.signals.length > 0
  const complaintType = safetyFlagged
    ? ('other' as const)
    : classifyComplaintType(complaint.category, normalizedText)
  const classification = safetyFlagged
    ? ('unrelated' as const)
    : classifyContent(complaint.category, normalizedText)
  const product = entityReference('product', complaint.product)
  const company = entityReference('company', complaint.company)
  const feature = entityReference('feature', complaint.feature)
  const contextEntities = safetyFlagged
    ? { substitutes: [], competitors: [] }
    : extractExplicitContextEntities(normalizedText)
  const unresolvedTypes: ComplaintAnalysis['entities']['unresolvedTypes'] = [
    ...(product.canonicalName === null ? (['product'] as const) : []),
    ...(company.canonicalName === null ? (['company'] as const) : []),
    ...(feature.canonicalName === null ? (['feature'] as const) : []),
    ...(contextEntities.substitutes.some((entry) => entry.canonicalName !== null)
      ? []
      : (['substitute'] as const)),
    ...(contextEntities.competitors.some((entry) => entry.canonicalName !== null)
      ? []
      : (['competitor'] as const))
  ]
  const severity = safetyFlagged ? 0 : severityFor(complaint.category, normalizedText)
  const classificationConfidence = safetyFlagged
    ? 0.95
    : classification === 'complaint'
      ? 0.8
      : 0.62
  return complaintAnalysisSchema.parse({
    complaintId: complaint.id,
    classification,
    complaintType,
    problemStatement: normalizedText,
    expectedOutcome: null,
    observedOutcome: normalizedText,
    consequence: null,
    affectedWorkflow: normalizeComplaintText(complaint.feature),
    workaround: null,
    featureMentions: uniqueStrings([complaint.feature]),
    userSegmentHints: [],
    severity,
    recurrence: safetyFlagged ? 'unknown' : recurrenceFor(complaint.category, normalizedText),
    switchingIntent: safetyFlagged
      ? 'unknown'
      : switchingIntentFor(complaint.category, normalizedText),
    paymentSignal: safetyFlagged ? 'unknown' : paymentSignalFor(complaint.category, normalizedText),
    actionabilityProbability: safetyFlagged ? 0.05 : classification === 'complaint' ? 0.8 : 0.45,
    classificationConfidence,
    entityConfidence: Number(
      ((product.confidence + company.confidence + feature.confidence) / 3).toFixed(2)
    ),
    manipulationRisk: safety.manipulationRisk,
    piiFlags: [],
    policyFlags: [
      complaint.synthetic ? 'synthetic-fixture' : 'source-policy-representation-applied',
      ...(safetyFlagged
        ? [
            'instruction-like-content-retained-for-review',
            ...safety.signals.map((id) => `content-safety:${id}`)
          ]
        : [])
    ],
    reviewState: 'unreviewed',
    extractionVersion: COMPLAINT_ANALYSIS_VERSION,
    derivation: {
      skillVersion: 'appsea-complaint-analysis-v1',
      modelVersion: 'deterministic-rules-v1',
      promptVersion: 'none'
    },
    entities: {
      product,
      company,
      feature,
      substitutes: contextEntities.substitutes,
      competitors: contextEntities.competitors,
      unresolvedTypes
    }
  })
}

export function analyzeComplaints(complaints: Complaint[]): ComplaintAnalysis[] {
  return [...complaints]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((complaint) => analyzeComplaint(complaint))
}

export function normalizeComplaintText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Stable text representation used only for deterministic similarity checks. */
export function complaintTextFingerprint(text: string): string {
  return normalizeComplaintText(text)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenJaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(complaintTextFingerprint(left).split(' ').filter(Boolean))
  const rightTokens = new Set(complaintTextFingerprint(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return intersection / new Set([...leftTokens, ...rightTokens]).size
}

interface FingerprintedComplaint<T extends Complaint> {
  complaint: T
  normalizedText: string
  fingerprint: string
  tokens: string[]
}

export interface DeduplicatedComplaintSet<T extends Complaint> {
  complaints: T[]
  decisions: ComplaintDeduplicationDecision[]
}

function comparisonKey<T extends Complaint>(complaint: T): string {
  return [
    complaint.sourceId,
    complaint.sourceRecordId,
    complaint.id,
    'evidenceId' in complaint ? String(complaint.evidenceId) : '',
    'sourceItemId' in complaint ? String(complaint.sourceItemId) : ''
  ].join('\0')
}

function contextKey<T extends Complaint>(complaint: T): string {
  return [lower(complaint.sourceId), lower(complaint.product), lower(complaint.category)].join('\0')
}

function decisionReferences<T extends Complaint>(
  complaint: T
): {
  evidenceId: string | null
  sourceItemId: string | null
} {
  const withEvidence = complaint as T & {
    evidenceId?: string
    sourceItemId?: string
  }
  return {
    evidenceId: withEvidence.evidenceId ?? null,
    sourceItemId: withEvidence.sourceItemId ?? null
  }
}

function roundSimilarity(value: number): number {
  return Number(value.toFixed(4))
}

function decisionSort(left: ComplaintDeduplicationDecision, right: ComplaintDeduplicationDecision) {
  return `${left.complaintId}\0${left.canonicalComplaintId}\0${left.relation}`.localeCompare(
    `${right.complaintId}\0${right.canonicalComplaintId}\0${right.relation}`
  )
}

/**
 * Deduplicate only identities that are safe to collapse automatically. A
 * source-native duplicate (or exact text plus the same canonical locator) is
 * dropped with a provenance-linked decision. Similar text from a distinct
 * source record is retained and marked for review instead of being treated as
 * a unique-user count or silently merged.
 */
export function deduplicateComplaintSet<T extends Complaint>(
  complaints: T[]
): DeduplicatedComplaintSet<T> {
  const ordered = [...complaints]
    .sort((left, right) => comparisonKey(left).localeCompare(comparisonKey(right)))
    .map((complaint) => ({
      ...complaint,
      text: normalizeComplaintText(complaint.text)
    }))
  const retained: FingerprintedComplaint<T>[] = []
  const decisions: ComplaintDeduplicationDecision[] = []
  const byNativeRecord = new Map<string, FingerprintedComplaint<T>>()
  const byContextToken = new Map<string, Map<string, FingerprintedComplaint<T>[]>>()

  const addDecision = (
    complaint: T,
    canonical: T,
    values: Pick<
      ComplaintDeduplicationDecision,
      'relation' | 'decision' | 'similarity' | 'reviewRequired' | 'reason'
    >
  ): void => {
    const references = decisionReferences(complaint)
    decisions.push({
      version: COMPLAINT_DEDUPLICATION_VERSION,
      complaintId: complaint.id,
      canonicalComplaintId: canonical.id,
      sourceId: complaint.sourceId,
      sourceRecordId: complaint.sourceRecordId,
      evidenceId: references.evidenceId,
      sourceItemId: references.sourceItemId,
      ...values,
      similarity: roundSimilarity(values.similarity)
    })
  }

  const register = (entry: FingerprintedComplaint<T>): void => {
    const context = contextKey(entry.complaint)
    const bucket = byContextToken.get(context) ?? new Map<string, FingerprintedComplaint<T>[]>()
    const tokens = entry.tokens.length > 0 ? entry.tokens.slice(0, 6) : ['__empty__']
    for (const token of tokens) {
      const entries = bucket.get(token) ?? []
      entries.push(entry)
      bucket.set(token, entries)
    }
    byContextToken.set(context, bucket)
  }

  for (const complaint of ordered) {
    const fingerprinted: FingerprintedComplaint<T> = {
      complaint,
      normalizedText: complaint.text,
      fingerprint: complaintTextFingerprint(complaint.text),
      tokens: [...new Set(complaintTextFingerprint(complaint.text).split(' ').filter(Boolean))]
    }
    const nativeKey = `${lower(complaint.sourceId)}\0${complaint.sourceRecordId}`
    const nativeCanonical = byNativeRecord.get(nativeKey)
    if (nativeCanonical) {
      addDecision(complaint, nativeCanonical.complaint, {
        relation: 'source-record-duplicate',
        decision: 'deduplicated',
        similarity: 1,
        reviewRequired: false,
        reason:
          'The source-native record identifier repeats; the first deterministic representative is retained.'
      })
      continue
    }

    const context = contextKey(complaint)
    const bucket = byContextToken.get(context)
    const candidateSet = new Map<string, FingerprintedComplaint<T>>()
    if (bucket) {
      for (const token of fingerprinted.tokens.slice(0, 6)) {
        for (const candidate of bucket.get(token) ?? [])
          candidateSet.set(candidate.complaint.id, candidate)
      }
    }
    const candidates = [...candidateSet.values()]
      .sort((left, right) => left.complaint.id.localeCompare(right.complaint.id))
      .slice(0, MAX_NEAR_DUPLICATE_CANDIDATES)
    let bestCandidate: { entry: FingerprintedComplaint<T>; similarity: number } | undefined
    for (const candidate of candidates) {
      const similarity = tokenJaccardSimilarity(
        fingerprinted.normalizedText,
        candidate.normalizedText
      )
      if (
        similarity >= NEAR_DUPLICATE_THRESHOLD &&
        (!bestCandidate ||
          similarity > bestCandidate.similarity ||
          (similarity === bestCandidate.similarity &&
            candidate.complaint.id.localeCompare(bestCandidate.entry.complaint.id) < 0))
      ) {
        bestCandidate = { entry: candidate, similarity }
      }
    }

    if (
      bestCandidate &&
      complaint.canonicalLocator &&
      bestCandidate.entry.complaint.canonicalLocator === complaint.canonicalLocator &&
      fingerprinted.fingerprint === bestCandidate.entry.fingerprint
    ) {
      addDecision(complaint, bestCandidate.entry.complaint, {
        relation: 'normalized-exact-duplicate',
        decision: 'deduplicated',
        similarity: bestCandidate.similarity,
        reviewRequired: false,
        reason: 'Normalized text and canonical locator match within the same source context.'
      })
      continue
    }

    const canonical = bestCandidate?.entry.complaint ?? complaint
    addDecision(
      complaint,
      canonical,
      bestCandidate
        ? {
            relation: 'near-duplicate-candidate',
            decision: 'review-required',
            similarity: bestCandidate.similarity,
            reviewRequired: true,
            reason:
              'High text similarity is retained as a separate observation until human review confirms repost identity.'
          }
        : {
            relation: 'canonical',
            decision: 'retained',
            similarity: 1,
            reviewRequired: false,
            reason: 'No safe duplicate relationship was identified; retain the source observation.'
          }
    )
    retained.push(fingerprinted)
    byNativeRecord.set(nativeKey, fingerprinted)
    register(fingerprinted)
  }

  return {
    complaints: retained.map((entry) => entry.complaint),
    decisions: decisions.sort(decisionSort)
  }
}

export function deduplicateComplaints<T extends Complaint>(complaints: T[]): T[] {
  const retainedById = new Map(
    deduplicateComplaintSet(complaints).complaints.map((complaint) => [complaint.id, complaint])
  )
  const seen = new Set<string>()
  return complaints.flatMap((complaint) => {
    const retained = retainedById.get(complaint.id)
    if (!retained || seen.has(complaint.id)) return []
    seen.add(complaint.id)
    return [retained]
  })
}

export interface ClusterOptions {
  mode?: 'fixture' | 'production'
}

export function clusterComplaints(
  complaints: Complaint[],
  options: ClusterOptions = {}
): ComplaintCluster[] {
  const groups = new Map<string, Complaint[]>()
  const entries =
    options.mode === 'production'
      ? [...complaints].sort((left, right) =>
          `${left.product}\0${left.category}\0${left.sourceId}\0${left.sourceRecordId}`.localeCompare(
            `${right.product}\0${right.category}\0${right.sourceId}\0${right.sourceRecordId}`
          )
        )
      : complaints
  for (const complaint of entries) {
    const key = `${complaint.product}\0${complaint.category}`
    const existing = groups.get(key) ?? []
    existing.push(complaint)
    groups.set(key, existing)
  }

  return [...groups.entries()].map(([key, entries], index) => {
    const separator = key.indexOf('\0')
    const product = separator >= 0 ? key.slice(0, separator) : key
    const category = separator >= 0 ? key.slice(separator + 1) : 'Uncategorized'
    const production = options.mode === 'production'
    return complaintClusterSchema.parse({
      id: `cluster-${production ? 'production-' : ''}${index + 1}`,
      title: `${product}: ${category}`,
      product,
      category,
      summary: production
        ? `${entries.length} retained observation${entries.length === 1 ? '' : 's'} describe${entries.length === 1 ? 's' : ''} ${category.toLowerCase()}.`
        : `${entries.length} synthetic observation${entries.length === 1 ? '' : 's'} ${entries.length === 1 ? 'describes' : 'describe'} ${category.toLowerCase()}.`,
      complaintIds: entries.map((entry) => entry.id),
      uniqueObservationCount: entries.length,
      sourceCount: new Set(entries.map((entry) => entry.sourceId)).size,
      confidence: entries.length >= 2 ? 0.8 : 0.62
    })
  })
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Compose a production-shaped analysis checkpoint from an already collected,
 * policy-validated payload. Product and score assumptions are supplied by a
 * reviewed seed; this stage never derives market, feasibility, or willingness
 * to pay claims from complaint text.
 */
export function buildProductionResearchArtifact(
  input: ProductionAnalysisInput
): ProductionResearchArtifact {
  const parsed = productionAnalysisInputSchema.parse(input)
  const deduplicated = deduplicateComplaintSet<ProductionAnalysisComplaint>(parsed.complaints)
  const complaints = deduplicated.complaints.sort((left, right) =>
    `${left.sourceId}\0${left.sourceRecordId}\0${left.id}`.localeCompare(
      `${right.sourceId}\0${right.sourceRecordId}\0${right.id}`
    )
  )
  if (complaints.length === 0) {
    throw new Error('Production analysis requires at least one retained complaint')
  }
  const providedAnalyses = parsed.analyses ?? []
  const providedByComplaintId = new Map(
    providedAnalyses.map((analysis) => [analysis.complaintId, analysis])
  )
  const analyses = providedAnalyses.length
    ? complaints.map((complaint) => {
        const analysis = providedByComplaintId.get(complaint.id)
        if (!analysis) {
          throw new Error(`Reviewed analysis snapshot is missing for complaint ${complaint.id}`)
        }
        return analysis
      })
    : analyzeComplaints(complaints)
  const clusters = clusterComplaints(complaints, { mode: 'production' })
  const complaintIds = clusters.flatMap((cluster) => cluster.complaintIds)
  const seed = parsed.opportunitySeed.seed
  const scoreSnapshot = seed.balancedScoreInput
    ? calculateOpportunityScoreV1(seed.balancedScoreInput, parsed.analysisAt)
    : calculateOpportunityScore(seed.scoreFactors, parsed.analysisAt)
  const opportunity = opportunitySchema.parse({
    id: seed.id,
    slug: seed.slug,
    name: seed.name,
    oneLine: seed.oneLine,
    thesis: seed.thesis,
    audience: seed.audience,
    firstWedge: seed.firstWedge,
    complaintCount: complaints.length,
    synthetic: false,
    tags: seed.tags,
    complaintIds,
    competitors: seed.competitors,
    scoreSnapshot,
    contraryEvidence: seed.contraryEvidence,
    planFiles: seed.planFiles
  })
  const coverageGaps = new Set(parsed.coverageGaps)
  for (const gap of parsed.competitiveResearch.coverageGaps) coverageGaps.add(gap)
  if (parsed.competitiveResearch.observations.length === 0) {
    coverageGaps.add(
      'No permitted competitor or contrary-signal source evidence is attached; reviewed seed values are not market research.'
    )
  } else {
    coverageGaps.add(
      'Only confirmed, evidence-linked observations from the current private collection lineage are included; unreviewed, rejected, deleted, or unrelated claims remain excluded.'
    )
  }
  if (parsed.testOnly) {
    coverageGaps.add(
      'This analysis was composed from a test-only offline transport and cannot support market conclusions.'
    )
  }
  if (!seed.balancedScoreInput) {
    coverageGaps.add(
      'This production-shaped artifact uses the legacy v0.2 score because no reviewed balanced v1 input envelope was supplied.'
    )
  }
  if (deduplicated.decisions.some((decision) => decision.decision === 'review-required')) {
    coverageGaps.add(
      'Near-duplicate candidates are retained pending human review; retained observations are not unique-author counts.'
    )
  }
  const safetyFlaggedCount = analyses.filter((analysis) => analysis.manipulationRisk >= 0.85).length
  if (safetyFlaggedCount > 0) {
    coverageGaps.add(
      `${safetyFlaggedCount} retained observation${safetyFlaggedCount === 1 ? '' : 's'} contain${safetyFlaggedCount === 1 ? 's' : ''} instruction-like source text and ${safetyFlaggedCount === 1 ? 'remains' : 'remain'} excluded from automatic complaint interpretation until human review.`
    )
  }
  if (parsed.modelGateway) {
    if (parsed.modelGateway.provider === 'deterministic-fallback') {
      coverageGaps.add(
        'No external model-use policy is approved; the provider-neutral gateway used a deterministic fallback and its suggestions are non-authoritative.'
      )
    }
    if (parsed.modelGateway.refusedCount > 0) {
      coverageGaps.add(
        `${parsed.modelGateway.refusedCount} gateway request${parsed.modelGateway.refusedCount === 1 ? '' : 's'} was refused by the trust, policy, or budget boundary; deterministic complaint analysis remains authoritative.`
      )
    }
  }
  const artifactId = `analysis:${stableHash({
    collectionArtifactId: parsed.collectionArtifactId,
    runId: parsed.runId,
    analysisRunId: parsed.analysisRunId,
    analysisAt: parsed.analysisAt,
    complaintIds,
    analyses,
    deduplication: deduplicated.decisions,
    opportunityId: opportunity.id,
    scoreFactors: seed.scoreFactors,
    ...(seed.balancedScoreInput ? { balancedScoreInput: seed.balancedScoreInput } : {}),
    policySnapshot: parsed.policySnapshot,
    opportunitySeed: parsed.opportunitySeed,
    evidenceIds: complaints.map((complaint) => complaint.evidenceId),
    competitiveResearch: parsed.competitiveResearch,
    ...(parsed.modelGateway ? { modelGateway: parsed.modelGateway } : {})
  }).slice(0, 32)}`
  return productionResearchArtifactSchema.parse({
    id: artifactId,
    mode: 'production',
    analysisVersion: 'production-analysis-v1',
    runId: parsed.runId,
    analysisRunId: parsed.analysisRunId,
    collectionArtifactId: parsed.collectionArtifactId,
    transport: parsed.transport,
    testOnly: parsed.testOnly,
    createdAt: parsed.analysisAt,
    sourcePolicies: [parsed.policySnapshot.policy],
    complaints,
    analyses,
    clusters,
    opportunity,
    deduplication: deduplicated.decisions,
    coverageGaps: [...coverageGaps],
    warnings: parsed.warnings,
    policySnapshot: parsed.policySnapshot,
    opportunitySeedReview: parsed.opportunitySeed,
    competitiveResearch: parsed.competitiveResearch,
    ...(parsed.modelGateway ? { modelGateway: parsed.modelGateway } : {}),
    qualitySnapshot: buildResearchQualitySnapshot(undefined, parsed.analysisAt)
  })
}

const deepResearchCheckLabels: ReadonlyArray<keyof DeepResearchGateChecks> = [
  'coherentCluster',
  'provenanceComplete',
  'copiedContentInfluence',
  'uniqueAuthorEstimate',
  'contraryEvidenceSearch',
  'competitorCoverage',
  'substituteCoverage',
  'sourceGapsReviewed',
  'policyRisksReviewed',
  'reproducibleSnapshot',
  'manipulationRiskReviewed',
  'extractionAgreement'
]

/**
 * Evaluate the explicit deep-research checklist without inventing evidence.
 * The database repository supplies active observations and the immutable
 * production artifact; this pure function only derives compact provenance
 * identifiers and deterministic blockers from those inputs.
 */
export function evaluateDeepResearchGate(input: {
  artifact: ProductionResearchArtifact
  observations: CompetitiveResearchObservation[]
  checks: DeepResearchGateChecks
  clusterReviewStates?: readonly DeepResearchGateClusterReviewState[]
}): DeepResearchGateEvaluation {
  const checks = deepResearchGateChecksSchema.parse(input.checks)
  const blockingReasons: string[] = []
  const confirmed = input.observations.filter(
    (observation) =>
      !observation.synthetic &&
      observation.reviewState === 'confirmed' &&
      observation.evidenceId !== null
  )
  const confirmedObservationIds = confirmed.map((observation) => observation.observationId).sort()
  const sourceIds = [...new Set(confirmed.map((observation) => observation.sourceId))].sort()
  const evidenceIds = [
    ...new Set(
      confirmed.flatMap((observation) =>
        observation.evidenceId === null ? [] : [observation.evidenceId]
      )
    )
  ].sort()
  const contraryObservationIds = confirmed
    .filter((observation) => observation.claimType === 'contrary_signal')
    .map((observation) => observation.observationId)
    .sort()
  const competitorRelationTypes = [
    ...new Set(input.artifact.opportunity.competitors.map((competitor) => competitor.type))
  ].sort() as DeepResearchGateCompetitorRelationType[]

  if (input.artifact.mode !== 'production' || input.artifact.opportunity.synthetic) {
    blockingReasons.push('Deep research cannot promote a synthetic opportunity.')
  }
  if (input.artifact.testOnly) {
    blockingReasons.push('Test-only analysis transport cannot support a market conclusion.')
  }
  if (input.artifact.clusters.length === 0) {
    blockingReasons.push('At least one coherent complaint cluster is required.')
  }
  if (input.clusterReviewStates) {
    if (input.clusterReviewStates.length < input.artifact.clusters.length) {
      blockingReasons.push('Every complaint cluster must have a stored human review state.')
    }
    if (
      input.clusterReviewStates.some(
        (cluster) => !['reviewed', 'confirmed'].includes(cluster.reviewState)
      )
    ) {
      blockingReasons.push('Complaint clusters require human review before deep research can pass.')
    }
  }
  if (
    input.artifact.analyses.some(
      (analysis) => !['confirmed', 'corrected'].includes(analysis.reviewState)
    )
  ) {
    blockingReasons.push('Every retained complaint analysis must be confirmed or corrected.')
  }
  if (confirmedObservationIds.length === 0 || sourceIds.length === 0 || evidenceIds.length === 0) {
    blockingReasons.push(
      'At least one confirmed non-synthetic competitor observation with retained evidence is required.'
    )
  }
  if (contraryObservationIds.length === 0) {
    blockingReasons.push('A confirmed contrary-signal observation is required.')
  }
  if (
    !competitorRelationTypes.includes('workaround') &&
    !competitorRelationTypes.includes('do-nothing')
  ) {
    blockingReasons.push('Substitute or do-nothing competitor coverage is required.')
  }

  for (const label of deepResearchCheckLabels) {
    const check = checks[label]
    if (check.state !== 'pass') {
      blockingReasons.push(`Deep-research check ${label} is ${check.state}.`)
    } else if (check.note === null && check.evidenceIds.length === 0) {
      blockingReasons.push(`Deep-research check ${label} has no review note or evidence reference.`)
    }
  }

  return {
    eligible: blockingReasons.length === 0,
    blockingReasons: [...new Set(blockingReasons)],
    coverageGaps: [...new Set(input.artifact.coverageGaps)],
    confirmedObservationIds,
    sourceIds,
    evidenceIds,
    contraryObservationIds,
    competitorRelationTypes
  }
}

export async function buildFixtureResearchArtifact(
  createdAt = new Date().toISOString()
): Promise<FixtureResearchArtifact> {
  const opportunity = getOpportunity('inbox-relay')
  if (!opportunity) throw new Error('Inbox Relay fixture opportunity is missing')

  const connector = new FixtureConnector()
  const result = await connector.collect({
    query: '',
    limit: 100,
    purpose: 'testing',
    requestedDisplayMode: 'fixture'
  })
  const selectedIds = new Set(opportunity.complaintIds)
  const deduplicated = deduplicateComplaintSet(
    result.complaints.filter((entry) => selectedIds.has(entry.id))
  )
  const complaints = deduplicated.complaints
  const analyses = analyzeComplaints(complaints)
  const clusters = clusterComplaints(complaints)

  return fixtureResearchArtifactSchema.parse({
    id: 'research-fixture-inbox-relay',
    mode: 'fixture',
    createdAt,
    sourcePolicies: [result.policy],
    complaints,
    analyses,
    clusters,
    opportunity,
    deduplication: deduplicated.decisions,
    coverageGaps: [
      'No live social source is enabled.',
      'Fixture counts cannot establish current complaint momentum.',
      'Competitor records are synthetic examples, not verified market research.',
      ...(deduplicated.decisions.some((decision) => decision.decision === 'review-required')
        ? [
            'Near-duplicate candidates are retained pending human review; retained observations are not unique-author counts.'
          ]
        : [])
    ],
    warnings: result.warnings,
    qualitySnapshot: buildResearchQualitySnapshot(undefined, createdAt)
  })
}

export {
  RESEARCH_QUALITY_BENCHMARK,
  RESEARCH_QUALITY_BENCHMARK_VERSION,
  RESEARCH_QUALITY_EVALUATOR_VERSION,
  RESEARCH_QUALITY_GATE_THRESHOLDS,
  RESEARCH_QUALITY_GATE_VERSION,
  buildResearchQualitySnapshot,
  evaluateResearchQuality,
  evaluateResearchQualityGate
} from './quality-benchmark'
