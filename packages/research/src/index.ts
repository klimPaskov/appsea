import { createHash } from 'node:crypto'
import { getOpportunity } from '@appsea/catalog'
import { FixtureConnector } from '@appsea/connectors'
import { calculateOpportunityScore } from '@appsea/scoring'
import type {
  Complaint,
  ComplaintCluster,
  FixtureResearchArtifact,
  ProductionAnalysisComplaint,
  ProductionAnalysisInput,
  ProductionResearchArtifact
} from '@appsea/contracts'
import {
  complaintClusterSchema,
  fixtureResearchArtifactSchema,
  opportunitySchema,
  productionAnalysisInputSchema,
  productionResearchArtifactSchema
} from '@appsea/contracts'

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
  const clusters = clusterComplaints(complaints)

  return fixtureResearchArtifactSchema.parse({
    id: 'research-fixture-inbox-relay',
    mode: 'fixture',
    createdAt,
    sourcePolicies: [result.policy],
    complaints,
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
