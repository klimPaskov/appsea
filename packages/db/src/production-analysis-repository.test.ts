import { describe, expect, it, vi } from 'vitest'
import { calculateOpportunityScore } from '@appsea/scoring'
import { analyzeComplaint } from '@appsea/research'
import { contentHash } from './hash'
import {
  assertProductionAnalysisTimestamps,
  buildProductionAnalysisSnapshot,
  persistCompetitorObservationLineageInTransaction,
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
  it('persists a confirmed owner-import competitor snapshot and rejects stale rows', async () => {
    const observation = {
      observationId: 'observation:competitor',
      opportunityId: 'opportunity:permitted',
      competitorId: 'competitor:one',
      competitorName: 'Export competitor',
      competitorType: 'direct' as const,
      sourceId: 'source:permitted',
      sourceRecordId: 'record-competitor',
      sourceItemId: 'source-item:competitor',
      evidenceId: 'evidence:competitor',
      observationHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      claimType: 'feature' as const,
      claim: 'The competitor lacks a reliable export workflow.',
      observedAt: at,
      capturedAt: at,
      publishedAt: null,
      confidence: 0.84,
      reviewState: 'confirmed' as const,
      synthetic: false as const,
      allowedRepresentation: 'excerpt' as const,
      canonicalLocator: 'https://example.com/record-competitor'
    }
    const query = vi.fn()
    query
      .mockResolvedValueOnce({
        rows: [
          {
            workspace_id: 'workspace:one',
            observation_id: observation.observationId,
            opportunity_id: observation.opportunityId,
            competitor_id: observation.competitorId,
            source_id: observation.sourceId,
            source_record_id: observation.sourceRecordId,
            source_item_id: observation.sourceItemId,
            evidence_id: observation.evidenceId,
            claim_type: observation.claimType,
            claim: observation.claim,
            observed_at: at,
            captured_at: at,
            published_at: null,
            confidence: observation.confidence,
            review_state: 'confirmed',
            synthetic: false,
            allowed_representation: 'excerpt',
            canonical_locator: observation.canonicalLocator,
            created_by: 'user:owner',
            reviewed_by: 'user:owner',
            reviewed_at: at,
            created_at: at,
            updated_at: at,
            content_hash: observation.observationHash,
            evidence_content_hash: observation.evidenceHash,
            competitor_name: observation.competitorName,
            competitor_type: observation.competitorType
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            review_state: 'confirmed',
            synthetic: false,
            source_item_deletion_state: 'active',
            evidence_deletion_state: 'active',
            evidence_id: observation.evidenceId,
            relation_competitor_id: observation.competitorId,
            competitor_synthetic: false,
            collection_source_item_id: observation.sourceItemId,
            collection_source_id: observation.sourceId,
            collection_policy_source_id: observation.sourceId
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            observation_id: observation.observationId,
            opportunity_id: observation.opportunityId,
            competitor_id: observation.competitorId,
            source_id: observation.sourceId,
            source_record_id: observation.sourceRecordId,
            source_item_id: observation.sourceItemId,
            evidence_id: observation.evidenceId,
            observation_content_hash: observation.observationHash,
            evidence_content_hash: observation.evidenceHash,
            competitor_name: observation.competitorName,
            competitor_type: observation.competitorType
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const snapshotHash = await persistCompetitorObservationLineageInTransaction(
      { query } as never,
      {
        workspaceId: 'workspace:one',
        collectionRunId: 'run:collection',
        analysisRunId: 'analysis-run:one',
        opportunityId: observation.opportunityId,
        snapshot: { observations: [observation], coverageGaps: [] },
        linkedAt: at
      }
    )

    expect(snapshotHash).toMatch(/^[a-f0-9]{64}$/)
    expect(query.mock.calls[4]?.[0]).toContain('research_analysis_run_competitor_observations')
  })

  it('fails closed when a captured observation is rejected before analysis commit', async () => {
    const staleObservation = {
      observationId: 'observation:stale',
      opportunityId: 'opportunity:permitted',
      competitorId: 'competitor:one',
      competitorName: 'Export competitor',
      competitorType: 'direct' as const,
      sourceId: 'source:permitted',
      sourceRecordId: 'record-stale',
      sourceItemId: 'source-item:stale',
      evidenceId: 'evidence:stale',
      observationHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      claimType: 'contrary_signal' as const,
      claim: 'A contrary signal was reviewed.',
      observedAt: at,
      capturedAt: at,
      publishedAt: null,
      confidence: 0.7,
      reviewState: 'confirmed' as const,
      synthetic: false as const,
      allowedRepresentation: 'excerpt' as const,
      canonicalLocator: null
    }
    const query = vi.fn()
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        {
          review_state: 'rejected',
          synthetic: false,
          source_item_deletion_state: 'active',
          evidence_deletion_state: 'active',
          evidence_id: staleObservation.evidenceId,
          relation_competitor_id: staleObservation.competitorId,
          competitor_synthetic: false,
          collection_source_item_id: staleObservation.sourceItemId,
          collection_source_id: staleObservation.sourceId,
          collection_policy_source_id: staleObservation.sourceId
        }
      ],
      rowCount: 1
    })

    await expect(
      persistCompetitorObservationLineageInTransaction({ query } as never, {
        workspaceId: 'workspace:one',
        collectionRunId: 'run:collection',
        analysisRunId: 'analysis-run:stale',
        opportunityId: staleObservation.opportunityId,
        snapshot: { observations: [staleObservation], coverageGaps: [] }
      })
    ).rejects.toThrow('snapshot is stale')
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a rejected-only coverage gap changes before commit', async () => {
    const query = vi.fn()
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        {
          review_state: 'rejected',
          synthetic: false,
          source_item_deletion_state: 'active',
          evidence_deletion_state: 'active',
          evidence_id: 'evidence:rejected',
          relation_competitor_id: 'competitor:one',
          competitor_synthetic: false,
          collection_source_item_id: 'source-item:rejected',
          collection_source_id: 'source:permitted',
          collection_policy_source_id: 'source:permitted'
        }
      ],
      rowCount: 1
    })

    await expect(
      persistCompetitorObservationLineageInTransaction({ query } as never, {
        workspaceId: 'workspace:one',
        collectionRunId: 'run:collection',
        analysisRunId: 'analysis-run:coverage-stale',
        opportunityId: 'opportunity:permitted',
        snapshot: { observations: [], coverageGaps: [] }
      })
    ).rejects.toThrow('snapshot is stale')
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('sanitizes restricted representations without changing evidence identity', () => {
    const parsed = productionResearchArtifactSchema.parse({
      ...artifact(),
      competitiveResearch: {
        observations: [
          {
            observationId: 'observation:metadata-only',
            opportunityId: 'opportunity:permitted',
            competitorId: 'competitor:one',
            competitorName: 'Metadata competitor',
            competitorType: 'direct',
            sourceId: 'source:permitted',
            sourceRecordId: 'record-one',
            sourceItemId: 'source-item:one',
            evidenceId: 'evidence:one',
            observationHash: 'c'.repeat(64),
            evidenceHash: 'a'.repeat(64),
            claimType: 'feature',
            claim: 'This claim must not be rendered from metadata-only input.',
            observedAt: at,
            capturedAt: at,
            publishedAt: null,
            confidence: 0.7,
            reviewState: 'confirmed',
            synthetic: false,
            allowedRepresentation: 'metadata-only',
            canonicalLocator: null
          }
        ],
        coverageGaps: []
      }
    })
    const sanitized = sanitizeProductionArtifact(parsed)
    expect(sanitized.complaints[0]?.text).toBe('[Content withheld by source policy]')
    expect(sanitized.complaints[0]?.evidenceHash).toBe(parsed.complaints[0]?.evidenceHash)
    expect(sanitized.competitiveResearch.observations[0]?.claim).toBe(
      '[Content withheld by source policy]'
    )
    expect(sanitized.coverageGaps).toContain(
      'Competitive observation claims are withheld for metadata-only or aggregate-only representations.'
    )
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
