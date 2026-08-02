import { describe, expect, it } from 'vitest'
import {
  complaintAnalysisSchema,
  productionAnalysisInputSchema,
  productionOpportunitySeedSchema,
  productionResearchArtifactSchema,
  workspaceOpportunitySeedApprovalInputSchema,
  workspaceOpportunitySeedCreateInputSchema,
  type ProductionAnalysisInput
} from './index'

const now = '2026-07-26T00:00:00.000Z'

const analysisFor = (complaintId: string) =>
  complaintAnalysisSchema.parse({
    complaintId,
    classification: 'complaint',
    complaintType: 'workflow_gap',
    problemStatement: 'The handoff history is unavailable to the next teammate.',
    expectedOutcome: null,
    observedOutcome: 'The handoff history is unavailable to the next teammate.',
    consequence: null,
    affectedWorkflow: 'handoff history',
    workaround: null,
    featureMentions: ['handoff history'],
    userSegmentHints: [],
    severity: 2,
    recurrence: 'unknown',
    switchingIntent: 'unknown',
    paymentSignal: 'unknown',
    actionabilityProbability: 0.8,
    classificationConfidence: 0.8,
    entityConfidence: 0.9,
    manipulationRisk: 0,
    piiFlags: [],
    policyFlags: ['source-policy-representation-applied'],
    reviewState: 'unreviewed',
    extractionVersion: 'complaint-analysis-v0.1.0',
    derivation: {
      skillVersion: 'appsea-complaint-analysis-v1',
      modelVersion: 'test',
      promptVersion: 'none'
    },
    entities: {
      product: {
        entityType: 'product',
        surfaceText: 'Example Inbox',
        canonicalName: 'Example Inbox',
        confidence: 0.9,
        resolution: 'exact',
        evidence: 'source-field'
      },
      company: {
        entityType: 'company',
        surfaceText: 'Example Company',
        canonicalName: 'Example Company',
        confidence: 0.9,
        resolution: 'exact',
        evidence: 'source-field'
      },
      feature: {
        entityType: 'feature',
        surfaceText: 'handoff history',
        canonicalName: 'handoff history',
        confidence: 0.9,
        resolution: 'exact',
        evidence: 'source-field'
      },
      substitutes: [],
      competitors: [],
      unresolvedTypes: ['substitute', 'competitor']
    }
  })

function input(overrides: Partial<ProductionAnalysisInput> = {}): ProductionAnalysisInput {
  return {
    collectionArtifactId: 'collection:sample',
    runId: 'run:sample',
    analysisRunId: 'analysis-run:sample',
    transport: 'offline-sample',
    testOnly: true,
    request: {
      workspaceId: 'workspace:sample',
      campaignId: 'campaign:sample',
      runId: 'run:sample',
      idempotencyKey: 'a'.repeat(64),
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-policy-v1',
      query: 'shared inbox',
      limit: 10,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt',
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      requestedAt: now
    },
    policySnapshot: {
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-policy-v1',
      contentHash: 'a'.repeat(64),
      reviewId: 'review:contracts-test',
      policy: {
        sourceId: 'cfpb-consumer-complaints',
        displayName: 'CFPB sample policy',
        sourceType: 'api',
        enabled: true,
        policyState: 'approved',
        permittedPurposes: ['opportunity-research'],
        commercialUse: 'allowed',
        accessMethod: 'test-only in-memory payload',
        retentionDays: 30,
        deletionRequired: true,
        attributionRequired: true,
        displayMode: 'excerpt',
        coverageNotes: ['Test-only payload; no market conclusion is permitted.'],
        reviewedAt: now,
        policyOwner: 'contracts-test',
        policyDocumentRef: null,
        expiresAt: '2026-10-26T00:00:00.000Z',
        quota: {
          requestsPerMinute: 6,
          maxRecordsPerRequest: 1_000,
          maxRecordsPerRun: 1_000,
          costPerRequestMicros: 0
        },
        deletion: {
          sourceRecordIdField: 'complaint_id',
          supportsTombstones: false,
          deletionPollIntervalHours: 24,
          retentionAction: 'redact'
        }
      }
    },
    complaints: [
      {
        id: 'complaint:sample-1',
        evidenceId: 'evidence:sample-1',
        sourceItemId: 'source-item:sample-1',
        evidenceHash: 'b'.repeat(64),
        sourceId: 'cfpb-consumer-complaints',
        sourceRecordId: '1001',
        canonicalLocator: null,
        capturedAt: now,
        publishedAt: null,
        query: 'shared inbox',
        product: 'Example Inbox',
        company: 'Example Company',
        feature: 'handoff history',
        category: 'handoff loss',
        text: 'The handoff history is unavailable to the next teammate.',
        language: 'en',
        synthetic: false,
        redacted: true,
        allowedRepresentation: 'excerpt'
      }
    ],
    deletions: [],
    coverageGaps: ['The sample is not a statistical sample.'],
    warnings: ['Test-only transport.'],
    opportunitySeed: {
      seed: {
        id: 'opportunity:sample',
        slug: 'sample-handoff',
        name: 'Sample Handoff',
        oneLine: 'A reviewed test opportunity.',
        thesis: 'This seed is a contract test and is not market evidence.',
        audience: 'Test users',
        firstWedge: 'Read-only handoff history review.',
        tags: ['test-only'],
        competitors: [],
        contraryEvidence: ['Competitor research is not included in this sample.'],
        scoreFactors: {
          complaintVolume: 10,
          painSeverity: 20,
          recurrence: 10,
          willingnessToPay: 0,
          competitiveGap: 0,
          buildFeasibility: 30,
          evidenceQuality: 20,
          contraryEvidencePenalty: 90
        },
        planFiles: [
          'README.md',
          '01-product-brief.md',
          '02-mvp-scope.md',
          '03-architecture.md',
          '04-task-graph.json',
          '05-validation.md'
        ]
      },
      seedVersion: 'seed-v1',
      contentHash: 'c'.repeat(64),
      reviewId: 'review:seed-contracts-test',
      reviewedBy: 'contracts-test',
      reviewedAt: now
    },
    analysisAt: now,
    ...overrides
  }
}

describe('production analysis contracts', () => {
  it('keeps source-backed competitor feature claims outside reviewed seed input', () => {
    const seed = input().opportunitySeed.seed
    expect(
      productionOpportunitySeedSchema.safeParse({
        ...seed,
        competitors: [
          {
            name: 'Source-backed claim',
            type: 'direct',
            positioning: 'Untrusted source claim',
            strengths: [],
            weaknesses: [],
            relatedComplaintCategories: [],
            featureMatrix: [
              {
                feature: 'handoff history',
                status: 'supported',
                evidenceBasis: 'source-observation',
                observationIds: ['observation:competitor-one'],
                notes: null
              }
            ]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('keeps seed review creation and approval inputs strict', () => {
    const seedReview = workspaceOpportunitySeedCreateInputSchema.parse({
      seedReviewId: 'seed-review:contract',
      seedVersion: 'seed-v1',
      seed: input().opportunitySeed.seed
    })
    expect(seedReview.seed.id).toBe('opportunity:sample')
    expect(
      workspaceOpportunitySeedApprovalInputSchema.safeParse({ action: 'approved' }).success
    ).toBe(true)
    expect(
      workspaceOpportunitySeedApprovalInputSchema.safeParse({ action: 'approved', extra: true })
        .success
    ).toBe(false)
    expect(
      workspaceOpportunitySeedCreateInputSchema.safeParse({
        seedReviewId: 'seed-review:control',
        seedVersion: 'seed-v1',
        seed: { ...input().opportunitySeed.seed, thesis: 'bad\u0000seed' }
      }).success
    ).toBe(false)
  })

  it('accepts a reviewed, redacted, non-fixture analysis payload', () => {
    expect(productionAnalysisInputSchema.parse(input()).testOnly).toBe(true)
  })

  it('rejects synthetic or unredacted complaints and offline payloads without testOnly', () => {
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input(),
        testOnly: false
      }).success
    ).toBe(false)
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input({
          complaints: [{ ...input().complaints[0]!, synthetic: true }]
        })
      }).success
    ).toBe(false)
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input({
          complaints: [{ ...input().complaints[0]!, redacted: false }]
        })
      }).success
    ).toBe(false)
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input({
          policySnapshot: {
            ...input().policySnapshot,
            policyVersion: 'different-policy-v1'
          }
        })
      }).success
    ).toBe(false)
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input({
          policySnapshot: {
            ...input().policySnapshot,
            policy: { ...input().policySnapshot.policy, commercialUse: 'unknown' }
          }
        })
      }).success
    ).toBe(false)
    expect(
      productionAnalysisInputSchema.safeParse({
        ...input({
          complaints: [
            input().complaints[0]!,
            { ...input().complaints[0]!, id: 'complaint:sample-2' }
          ]
        })
      }).success
    ).toBe(false)
  })

  it('keeps production artifact validation separate from the fixture contract', () => {
    const artifact = {
      id: 'analysis:sample',
      mode: 'production' as const,
      analysisVersion: 'production-analysis-v1' as const,
      runId: 'run:sample',
      analysisRunId: 'analysis-run:sample',
      collectionArtifactId: 'collection:sample',
      transport: 'offline-sample' as const,
      testOnly: true,
      createdAt: now,
      sourcePolicies: [input().policySnapshot.policy],
      complaints: input().complaints,
      analyses: [analysisFor('complaint:sample-1')],
      clusters: [
        {
          id: 'cluster:sample',
          title: 'Example Inbox: handoff loss',
          product: 'Example Inbox',
          category: 'handoff loss',
          summary: 'One retained observation describes handoff loss.',
          complaintIds: ['complaint:sample-1'],
          uniqueObservationCount: 1,
          sourceCount: 1,
          confidence: 0.62
        }
      ],
      opportunity: {
        ...input().opportunitySeed.seed,
        complaintCount: 1,
        synthetic: false,
        complaintIds: ['complaint:sample-1'],
        scoreSnapshot: {
          score: 0,
          version: 'opportunity-score-v0.2.0',
          calculatedAt: now,
          factors: input().opportunitySeed.seed.scoreFactors,
          weights: {
            complaintVolume: 20,
            painSeverity: 18,
            recurrence: 14,
            willingnessToPay: 10,
            competitiveGap: 14,
            buildFeasibility: 12,
            evidenceQuality: 12,
            contraryEvidencePenalty: 10
          }
        }
      },
      coverageGaps: ['The sample is not a statistical sample.'],
      warnings: ['Test-only transport.'],
      policySnapshot: input().policySnapshot,
      opportunitySeedReview: input().opportunitySeed
    }
    expect(productionResearchArtifactSchema.parse(artifact).mode).toBe('production')
  })
})

export { input as productionAnalysisContractFixture }
