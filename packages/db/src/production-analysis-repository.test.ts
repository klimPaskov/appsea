import { describe, expect, it } from 'vitest'
import { calculateOpportunityScore } from '@appsea/scoring'
import { analyzeComplaint } from '@appsea/research'
import { contentHash } from './hash'
import {
  assertProductionAnalysisTimestamps,
  buildProductionAnalysisSnapshot,
  sanitizeProductionArtifact
} from './production-analysis-repository'
import {
  productionAnalysisPersistenceInputSchema,
  productionResearchArtifactSchema,
  type ProductionResearchArtifact
} from '@appsea/contracts'

const at = '2026-07-26T00:00:00.000Z'

function artifact(): ProductionResearchArtifact {
  const policy = {
    sourceId: 'source:permitted',
    displayName: 'Permitted source',
    sourceType: 'api' as const,
    enabled: true,
    policyState: 'approved' as const,
    permittedPurposes: ['opportunity-research'],
    commercialUse: 'allowed' as const,
    accessMethod: 'documented-api',
    retentionDays: 30,
    deletionRequired: true,
    attributionRequired: false,
    displayMode: 'metadata-only' as const,
    coverageNotes: ['bounded fixture-backed policy test'],
    reviewedAt: at,
    policyOwner: 'operator',
    policyDocumentRef: null,
    expiresAt: null,
    quota: {
      requestsPerMinute: 10,
      maxRecordsPerRequest: 100,
      maxRecordsPerRun: 100,
      costPerRequestMicros: 0
    },
    deletion: {
      sourceRecordIdField: 'record_id',
      supportsTombstones: true,
      deletionPollIntervalHours: 24,
      retentionAction: 'tombstone' as const
    }
  }
  const seed = {
    id: 'opportunity:permitted',
    slug: 'permitted-wedge',
    name: 'Permitted Wedge',
    oneLine: 'A bounded product wedge',
    thesis: 'A reviewed thesis',
    audience: 'Operators',
    firstWedge: 'Evidence review',
    tags: ['reviewed'],
    competitors: [],
    contraryEvidence: ['Needs pricing validation'],
    scoreFactors: {
      complaintVolume: 60,
      painSeverity: 60,
      recurrence: 50,
      willingnessToPay: 40,
      competitiveGap: 50,
      buildFeasibility: 70,
      evidenceQuality: 80,
      contraryEvidencePenalty: 20
    },
    planFiles: [
      'README.md',
      '01-product-brief.md',
      '02-mvp-scope.md',
      '03-architecture.md',
      '04-task-graph.json',
      '05-validation.md'
    ]
  }
  const complaint = {
    id: 'complaint:one',
    evidenceId: 'evidence:one',
    sourceItemId: 'source-item:one',
    evidenceHash: 'a'.repeat(64),
    sourceId: policy.sourceId,
    sourceRecordId: 'record-one',
    canonicalLocator: null,
    capturedAt: at,
    publishedAt: null,
    query: 'bounded query',
    product: 'Product',
    company: 'Company',
    feature: 'Feature',
    category: 'Reliability',
    text: 'Policy-restricted text',
    language: 'en',
    synthetic: false,
    redacted: true,
    allowedRepresentation: 'metadata-only' as const
  }
  return productionResearchArtifactSchema.parse({
    id: 'analysis-artifact:one',
    mode: 'production',
    analysisVersion: 'production-analysis-v1',
    runId: 'collection-run:one',
    analysisRunId: 'analysis-run:one',
    collectionArtifactId: 'collection-artifact:one',
    transport: 'persisted-collection',
    testOnly: false,
    createdAt: at,
    sourcePolicies: [policy],
    policySnapshot: {
      sourceId: policy.sourceId,
      policyVersion: 'policy-v1',
      contentHash: 'b'.repeat(64),
      reviewId: 'review:one',
      policy
    },
    opportunitySeedReview: {
      seed,
      seedVersion: 'seed-v1',
      contentHash: contentHash(seed),
      reviewId: 'seed-review:one',
      reviewedBy: 'operator',
      reviewedAt: at
    },
    complaints: [complaint],
    analyses: [analyzeComplaint(complaint)],
    clusters: [
      {
        id: 'cluster:one',
        title: 'Product reliability',
        product: 'Product',
        category: 'Reliability',
        summary: 'A repeated reliability problem',
        complaintIds: [complaint.id],
        uniqueObservationCount: 1,
        sourceCount: 1,
        confidence: 0.62
      }
    ],
    opportunity: {
      id: seed.id,
      slug: seed.slug,
      name: seed.name,
      oneLine: seed.oneLine,
      thesis: seed.thesis,
      audience: seed.audience,
      firstWedge: seed.firstWedge,
      complaintCount: 1,
      synthetic: false,
      tags: seed.tags,
      complaintIds: [complaint.id],
      competitors: seed.competitors,
      scoreSnapshot: calculateOpportunityScore(seed.scoreFactors, at),
      contraryEvidence: seed.contraryEvidence,
      planFiles: seed.planFiles
    },
    coverageGaps: ['Only one permitted source was collected.'],
    warnings: []
  })
}

describe('production analysis persistence helpers', () => {
  it('sanitizes restricted representations without changing evidence identity', () => {
    const parsed = artifact()
    const sanitized = sanitizeProductionArtifact(parsed)
    expect(sanitized.complaints[0]?.text).toBe('[Content withheld by source policy]')
    expect(sanitized.complaints[0]?.evidenceHash).toBe(parsed.complaints[0]?.evidenceHash)
  })

  it('builds a deterministic lineage snapshot from the reviewed artifact', () => {
    const parsed = artifact()
    const input = productionAnalysisPersistenceInputSchema.parse({
      workspaceId: 'workspace:one',
      collectionRunId: parsed.runId,
      analysisRunId: parsed.analysisRunId,
      idempotencyKey: 'analysis-idempotency-key',
      requestedAt: at,
      artifact: parsed
    })
    const snapshot = buildProductionAnalysisSnapshot(
      input,
      'c'.repeat(64),
      parsed.opportunity.id,
      'score:one',
      'report:one',
      'plan:one'
    )
    expect(snapshot).toMatchObject({
      mode: 'production-analysis',
      analysisRunId: parsed.analysisRunId,
      collectionRunId: parsed.runId,
      complaintCount: 1,
      clusterCount: 1,
      competitorCount: 0
    })
    expect(snapshot.policySnapshots[0]?.reviewId).toBe('review:one')
  })

  it('rejects caller-controlled timestamps that could extend retention into the future', () => {
    const parsed = productionAnalysisPersistenceInputSchema.parse({
      workspaceId: 'workspace:one',
      collectionRunId: 'collection-run:one',
      analysisRunId: 'analysis-run:one',
      idempotencyKey: 'analysis-idempotency-key',
      requestedAt: '2099-01-01T00:00:00.000Z',
      artifact: { ...artifact(), createdAt: '2099-01-01T00:00:00.000Z' }
    })
    expect(() => assertProductionAnalysisTimestamps(parsed, Date.parse(at))).toThrow(
      'must not be materially in the future'
    )
  })
})
