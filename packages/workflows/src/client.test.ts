import { describe, expect, it } from 'vitest'
import { productionResearchArtifactSchema } from '@appsea/contracts'
import {
  prepareFixtureResearchWorkflowStart,
  prepareProductionAnalysisWorkflowStart,
  prepareProductionCollectionWorkflowStart,
  productionCollectionIdempotencyDigest
} from './client'

const analysisAt = '2026-07-10T00:00:00.000Z'
const analysisArtifact = productionResearchArtifactSchema.parse({
  id: 'analysis-artifact:workflow',
  mode: 'production',
  analysisVersion: 'production-analysis-v1',
  runId: 'collection-run:workflow',
  analysisRunId: 'analysis-run:workflow',
  collectionArtifactId: 'collection-artifact:workflow',
  transport: 'persisted-collection',
  testOnly: false,
  createdAt: analysisAt,
  sourcePolicies: [
    {
      sourceId: 'source:workflow',
      displayName: 'Permitted source',
      sourceType: 'api',
      enabled: true,
      policyState: 'approved',
      permittedPurposes: ['opportunity-research'],
      commercialUse: 'allowed',
      accessMethod: 'documented-api',
      retentionDays: 30,
      deletionRequired: true,
      attributionRequired: false,
      displayMode: 'metadata-only',
      coverageNotes: [],
      reviewedAt: analysisAt,
      policyOwner: 'operator',
      policyDocumentRef: null,
      expiresAt: null,
      quota: {
        requestsPerMinute: 10,
        maxRecordsPerRequest: 10,
        maxRecordsPerRun: 10,
        costPerRequestMicros: 0
      },
      deletion: {
        sourceRecordIdField: 'record_id',
        supportsTombstones: true,
        deletionPollIntervalHours: 24,
        retentionAction: 'tombstone'
      }
    }
  ],
  policySnapshot: {
    sourceId: 'source:workflow',
    policyVersion: 'policy-v1',
    contentHash: 'a'.repeat(64),
    reviewId: 'review:workflow',
    policy: {
      sourceId: 'source:workflow',
      displayName: 'Permitted source',
      sourceType: 'api',
      enabled: true,
      policyState: 'approved',
      permittedPurposes: ['opportunity-research'],
      commercialUse: 'allowed',
      accessMethod: 'documented-api',
      retentionDays: 30,
      deletionRequired: true,
      attributionRequired: false,
      displayMode: 'metadata-only',
      coverageNotes: [],
      reviewedAt: analysisAt,
      policyOwner: 'operator',
      policyDocumentRef: null,
      expiresAt: null,
      quota: {
        requestsPerMinute: 10,
        maxRecordsPerRequest: 10,
        maxRecordsPerRun: 10,
        costPerRequestMicros: 0
      },
      deletion: {
        sourceRecordIdField: 'record_id',
        supportsTombstones: true,
        deletionPollIntervalHours: 24,
        retentionAction: 'tombstone'
      }
    }
  },
  opportunitySeedReview: {
    seed: {
      id: 'opportunity:workflow',
      slug: 'workflow-wedge',
      name: 'Workflow Wedge',
      oneLine: 'A reviewed wedge',
      thesis: 'A reviewed thesis',
      audience: 'Operators',
      firstWedge: 'Evidence review',
      tags: [],
      competitors: [],
      contraryEvidence: [],
      scoreFactors: {
        complaintVolume: 0,
        painSeverity: 0,
        recurrence: 0,
        willingnessToPay: 0,
        competitiveGap: 0,
        buildFeasibility: 0,
        evidenceQuality: 0,
        contraryEvidencePenalty: 0
      },
      planFiles: ['README.md']
    },
    seedVersion: 'seed-v1',
    contentHash: 'b'.repeat(64),
    reviewId: 'seed-review:workflow',
    reviewedBy: 'operator',
    reviewedAt: analysisAt
  },
  complaints: [
    {
      id: 'complaint:workflow',
      evidenceId: 'evidence:workflow',
      sourceItemId: 'source-item:workflow',
      evidenceHash: 'c'.repeat(64),
      sourceId: 'source:workflow',
      sourceRecordId: 'record-workflow',
      capturedAt: analysisAt,
      publishedAt: null,
      query: 'workflow',
      product: 'Product',
      company: 'Company',
      feature: 'Feature',
      category: 'Reliability',
      text: 'Redacted observation',
      language: 'en',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'metadata-only'
    }
  ],
  clusters: [
    {
      id: 'cluster:workflow',
      title: 'Reliability',
      product: 'Product',
      category: 'Reliability',
      summary: 'A reliability observation',
      complaintIds: ['complaint:workflow'],
      uniqueObservationCount: 1,
      sourceCount: 1,
      confidence: 0.62
    }
  ],
  opportunity: {
    id: 'opportunity:workflow',
    slug: 'workflow-wedge',
    name: 'Workflow Wedge',
    oneLine: 'A reviewed wedge',
    thesis: 'A reviewed thesis',
    audience: 'Operators',
    firstWedge: 'Evidence review',
    complaintCount: 1,
    synthetic: false,
    tags: [],
    complaintIds: ['complaint:workflow'],
    competitors: [],
    scoreSnapshot: {
      score: 0,
      version: 'opportunity-score-v0.2.0',
      calculatedAt: analysisAt,
      factors: {
        complaintVolume: 0,
        painSeverity: 0,
        recurrence: 0,
        willingnessToPay: 0,
        competitiveGap: 0,
        buildFeasibility: 0,
        evidenceQuality: 0,
        contraryEvidencePenalty: 0
      },
      weights: {
        complaintVolume: 0,
        painSeverity: 0,
        recurrence: 0,
        willingnessToPay: 0,
        competitiveGap: 0,
        buildFeasibility: 0,
        evidenceQuality: 0,
        contraryEvidencePenalty: 0
      }
    },
    contraryEvidence: [],
    planFiles: ['README.md']
  },
  coverageGaps: [],
  warnings: []
})

const request = {
  workspaceId: 'workspace-workflow-test',
  campaignId: 'campaign-workflow-test',
  runId: 'run-workflow-test',
  idempotencyKey: 'sentinel-secret-idempotency-key',
  workflowVersion: 'fixture-research-v1' as const,
  fixtureAt: '2026-07-10T00:00:00.000Z',
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  }
}

describe('fixture workflow client boundary', () => {
  it('derives deterministic workflow identity and semantic input hashes', () => {
    const first = prepareFixtureResearchWorkflowStart(request)
    const replay = prepareFixtureResearchWorkflowStart(structuredClone(request))

    expect(replay).toEqual(first)
    expect(first.workflowId).toMatch(/^workflow:fixture:workspace-workflow-test:[a-f0-9]{32}$/)
    expect(first.input.idempotencyDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.input.inputHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps the raw idempotency key out of workflow history input', () => {
    const prepared = prepareFixtureResearchWorkflowStart(request)

    expect(JSON.stringify(prepared)).not.toContain(request.idempotencyKey)
  })

  it('keeps a stable workflow ID but changes the input hash for conflicting input', () => {
    const first = prepareFixtureResearchWorkflowStart(request)
    const changed = prepareFixtureResearchWorkflowStart({
      ...request,
      budget: { ...request.budget, maxSourceItems: 9 }
    })

    expect(changed.workflowId).toBe(first.workflowId)
    expect(changed.input.inputHash).not.toBe(first.input.inputHash)
  })

  it('binds an explicit requesting actor into semantic workflow input', () => {
    const actor = { actorType: 'user' as const, actorId: 'user:workflow-owner' }
    const prepared = prepareFixtureResearchWorkflowStart({ ...request, requestedBy: actor })

    expect(prepared.input.requestedBy).toEqual(actor)
    expect(prepared.input.inputHash).not.toBe(
      prepareFixtureResearchWorkflowStart(request).input.inputHash
    )
    expect(JSON.stringify(prepared)).not.toContain(request.idempotencyKey)
  })

  it('rejects low-entropy short idempotency keys', () => {
    expect(() =>
      prepareFixtureResearchWorkflowStart({ ...request, idempotencyKey: 'too-short' })
    ).toThrow()
  })
})

describe('production workflow client boundary', () => {
  it('shares one canonical idempotency digest with worker entry points', () => {
    const productionRequest = {
      workspaceId: 'workspace-production-test',
      campaignId: 'campaign-production-test',
      runId: 'run-production-test',
      idempotencyKey: 'sentinel-production-idempotency-key',
      workflowVersion: 'production-collection-v1' as const,
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-v1',
      query: 'billing',
      limit: 10,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt' as const,
      budget: {
        currency: 'USD' as const,
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      requestedAt: '2026-07-10T00:00:00.000Z'
    }
    const prepared = prepareProductionCollectionWorkflowStart(productionRequest)

    expect(prepared.input.idempotencyDigest).toBe(
      productionCollectionIdempotencyDigest(
        productionRequest.workspaceId,
        productionRequest.idempotencyKey,
        productionRequest.workflowVersion
      )
    )
    expect(JSON.stringify(prepared)).not.toContain(productionRequest.idempotencyKey)
  })

  it('prepares an identifier-only post-collection analysis workflow', () => {
    const prepared = prepareProductionAnalysisWorkflowStart({
      workspaceId: 'workspace-analysis-workflow',
      collectionRunId: analysisArtifact.runId,
      analysisRunId: analysisArtifact.analysisRunId,
      idempotencyKey: 'sentinel-analysis-idempotency-key',
      workflowVersion: 'production-analysis-v2',
      requestedAt: analysisAt,
      seedReviewId: analysisArtifact.opportunitySeedReview.reviewId
    })
    expect(prepared.workflowId).toMatch(
      /^workflow:analysis:workspace-analysis-workflow:[a-f0-9]{32}$/
    )
    expect(prepared.input.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(prepared)).not.toContain('sentinel-analysis-idempotency-key')
    expect(JSON.stringify(prepared)).not.toContain('Redacted observation')
    expect(prepared.input).not.toHaveProperty('artifact')
    expect(prepared.input.seedReviewId).toBe(analysisArtifact.opportunitySeedReview.reviewId)
  })
})
