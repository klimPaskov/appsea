import { createHash } from 'node:crypto'
import { getOpportunity } from '@appsea/catalog'
import { FixtureConnector } from '@appsea/connectors'
import { calculateOpportunityScore } from '@appsea/scoring'
import type {
  Complaint,
  ComplaintAnalysis,
  ComplaintEntityReference,
  ComplaintType,
  ComplaintCluster,
  FixtureResearchArtifact,
  ProductionAnalysisComplaint,
  ProductionAnalysisInput,
  ProductionResearchArtifact
} from '@appsea/contracts'
import {
  complaintAnalysisSchema,
  complaintClusterSchema,
  fixtureResearchArtifactSchema,
  opportunitySchema,
  productionAnalysisInputSchema,
  productionResearchArtifactSchema
} from '@appsea/contracts'

export const COMPLAINT_ANALYSIS_VERSION = 'complaint-analysis-v0.1.0'

const genericEntityLabels = new Set(['app', 'application', 'software', 'tool', 'teams', 'pages'])

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

export function analyzeComplaint(complaint: Complaint): ComplaintAnalysis {
  const normalizedText = normalizeComplaintText(complaint.text)
  const complaintType = classifyComplaintType(complaint.category, normalizedText)
  const classification = classifyContent(complaint.category, normalizedText)
  const product = entityReference('product', complaint.product)
  const company = entityReference('company', complaint.company)
  const feature = entityReference('feature', complaint.feature)
  const unresolvedTypes: ComplaintAnalysis['entities']['unresolvedTypes'] = [
    ...(product.canonicalName === null ? (['product'] as const) : []),
    ...(company.canonicalName === null ? (['company'] as const) : []),
    ...(feature.canonicalName === null ? (['feature'] as const) : []),
    'substitute',
    'competitor'
  ]
  const severity = severityFor(complaint.category, normalizedText)
  const classificationConfidence = classification === 'complaint' ? 0.8 : 0.62
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
    recurrence: recurrenceFor(complaint.category, normalizedText),
    switchingIntent: switchingIntentFor(complaint.category, normalizedText),
    paymentSignal: paymentSignalFor(complaint.category, normalizedText),
    actionabilityProbability: classification === 'complaint' ? 0.8 : 0.45,
    classificationConfidence,
    entityConfidence: Number(
      ((product.confidence + company.confidence + feature.confidence) / 3).toFixed(2)
    ),
    manipulationRisk: 0,
    piiFlags: [],
    policyFlags: [
      complaint.synthetic ? 'synthetic-fixture' : 'source-policy-representation-applied'
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
      substitutes: [],
      competitors: [],
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

export function deduplicateComplaints<T extends Complaint>(complaints: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []

  for (const complaint of complaints) {
    const key = [
      complaint.sourceId,
      complaint.sourceRecordId,
      normalizeComplaintText(complaint.text).toLowerCase()
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ ...complaint, text: normalizeComplaintText(complaint.text) })
  }

  return unique
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
  const complaints = deduplicateComplaints<ProductionAnalysisComplaint>(parsed.complaints).sort(
    (left, right) =>
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
  const scoreSnapshot = calculateOpportunityScore(seed.scoreFactors, parsed.analysisAt)
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
  coverageGaps.add(
    'No permitted competitor or contrary-signal source evidence is attached; reviewed seed values are not market research.'
  )
  if (parsed.testOnly) {
    coverageGaps.add(
      'This analysis was composed from a test-only offline transport and cannot support market conclusions.'
    )
  }
  const artifactId = `analysis:${stableHash({
    collectionArtifactId: parsed.collectionArtifactId,
    runId: parsed.runId,
    analysisRunId: parsed.analysisRunId,
    analysisAt: parsed.analysisAt,
    complaintIds,
    analyses,
    opportunityId: opportunity.id,
    scoreFactors: seed.scoreFactors,
    policySnapshot: parsed.policySnapshot,
    opportunitySeed: parsed.opportunitySeed,
    evidenceIds: complaints.map((complaint) => complaint.evidenceId)
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
    coverageGaps: [...coverageGaps],
    warnings: parsed.warnings,
    policySnapshot: parsed.policySnapshot,
    opportunitySeedReview: parsed.opportunitySeed
  })
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
  const complaints = deduplicateComplaints(
    result.complaints.filter((entry) => selectedIds.has(entry.id))
  )
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
    coverageGaps: [
      'No live social source is enabled.',
      'Fixture counts cannot establish current complaint momentum.',
      'Competitor records are synthetic examples, not verified market research.'
    ],
    warnings: result.warnings
  })
}
