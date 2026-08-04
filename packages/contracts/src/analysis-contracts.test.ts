import { describe, expect, it } from 'vitest'
import {
  complaintAnalysisSchema,
  productionAnalysisInputSchema,
  productionOpportunitySeedSchema,
  productionResearchArtifactSchema,
  researchQualityBenchmarkSchema,
  researchQualitySnapshotSchema,
  workspaceOpportunitySeedApprovalInputSchema,
  workspaceOpportunitySeedCreateInputSchema,
  workspaceOpportunitySeedReadModelSchema,
  type ProductionAnalysisInput
} from './index'

const now = '2026-07-26T00:00:00.000Z'

describe('research quality contracts', () => {
  it('accepts the synthetic benchmark and preserves explicit provenance', () => {
    const complaint = {
      id: 'quality-case-contract',
      sourceId: 'quality-benchmark',
      sourceRecordId: 'record-contract',
      canonicalLocator: null,
      capturedAt: now,
      publishedAt: now,
      query: 'synthetic quality benchmark',
      product: 'RelayBox',
      company: 'Relay Labs',
      feature: 'export',
      category: 'integration',
      text: 'Synthetic label: export fails.',
      language: 'en',
      synthetic: true,
      redacted: true,
      allowedRepresentation: 'fixture'
    }
    const benchmark = researchQualityBenchmarkSchema.parse({
      version: 'research-quality-benchmark-v1.0.0',
      cases: [
        {
          id: complaint.id,
          complaint,
          expected: {
            classification: 'complaint',
            complaintType: 'integration',
            entities: { product: 'RelayBox', company: 'Relay Labs', feature: 'export' },
            duplicateGroupId: 'quality-group-contract',
            clusterGroupId: 'quality-cluster-contract',
            actionable: true
          }
        }
      ],
      rankingCases: [],
      evidenceSnapshotId: null,
      notes: []
    })
    expect(benchmark.reviewedInputOnly).toBe(true)
    expect(() =>
      researchQualityBenchmarkSchema.parse({
        ...benchmark,
        cases: [{ ...benchmark.cases[0], complaint: { ...complaint, synthetic: false } }]
      })
    ).toThrow(/synthetic/)
  })

  it('accepts a bounded quality snapshot and rejects source-derived provenance', () => {
    const snapshot = {
      schemaVersion: 'research-quality-v1.0.0',
      benchmarkVersion: 'research-quality-benchmark-v1.0.0',
      evaluatorVersion: 'research-quality-evaluator-v1.0.0',
      generatedAt: now,
      benchmarkHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
      synthetic: true,
      reviewedInputOnly: true,
      evidenceSnapshotId: null,
      factorProvenance: 'reviewed-input-only',
      metrics: {
        classifier: {
          accuracy: { sampleSize: 1, value: 1 },
          complaintTypeAccuracy: { sampleSize: 1, value: 1 },
          macroF1: { sampleSize: 1, value: 1 },
          actionabilityPrecision: { sampleSize: 1, value: 1 },
          calibrationError: { sampleSize: 1, value: 0 }
        },
        entity: {
          top1Accuracy: { sampleSize: 1, value: 1 },
          topKRecall: { sampleSize: 1, value: 1 },
          abstentionRate: { sampleSize: 1, value: 0 },
          highImpactWrongLinkRate: { sampleSize: 1, value: 0 }
        },
        deduplication: {
          pairPrecision: { sampleSize: 1, value: 1 },
          pairRecall: { sampleSize: 1, value: 1 },
          f1: { sampleSize: 1, value: 1 }
        },
        clustering: {
          pairPrecision: { sampleSize: 1, value: 1 },
          pairRecall: { sampleSize: 1, value: 1 },
          f1: { sampleSize: 1, value: 1 },
          purity: { sampleSize: 1, value: 1 }
        },
        stability: {
          duplicateInjection: { sampleSize: 1, value: 1 },
          sourceAblation: { sampleSize: 1, value: 1 }
        },
        ranking: {
          topKPrecision: { sampleSize: 1, value: 1 },
          topKRecall: { sampleSize: 1, value: 1 },
          rankCorrelation: { sampleSize: 1, value: 1 }
        },
        calibration: {
          expectedCalibrationError: { sampleSize: 1, value: 0 },
          brierScore: { sampleSize: 1, value: 0 }
        }
      },
      warnings: ['Synthetic only.'],
      provenance: {
        mode: 'synthetic-redacted-benchmark',
        sourceCoverage: 'not-derived',
        factorInputs: 'reviewed-input-only',
        note: 'No source coverage is derived.'
      }
    }
    expect(researchQualitySnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(() =>
      researchQualitySnapshotSchema.parse({
        ...snapshot,
        provenance: { ...snapshot.provenance, sourceCoverage: 'derived' }
      })
    ).toThrow()
  })
})

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
  it('requires the canonical six-file production coding package manifest', () => {
    const seed = input().opportunitySeed.seed
    expect(productionOpportunitySeedSchema.safeParse(seed).success).toBe(true)
    expect(
      productionOpportunitySeedSchema.safeParse({ ...seed, planFiles: ['README.md'] }).success
    ).toBe(false)
    expect(
      productionOpportunitySeedSchema.safeParse({
        ...seed,
        planFiles: [...seed.planFiles, 'README.md']
      }).success
    ).toBe(false)
    expect(
      productionOpportunitySeedSchema.safeParse({
        ...seed,
        planFiles: [...seed.planFiles].reverse()
      }).success
    ).toBe(true)
    expect(
      workspaceOpportunitySeedReadModelSchema.safeParse({
        seedReviewId: 'seed-review:legacy',
        seedVersion: 'seed-v0',
        seed: { ...seed, planFiles: ['README.md'] },
        contentHash: 'd'.repeat(64),
        reviewState: 'approved',
        createdBy: 'user:legacy',
        reviewedBy: 'user:legacy',
        reviewedAt: now,
        approvedBy: 'user:legacy',
        approvedAt: now,
        createdAt: now,
        updatedAt: now
      }).success
    ).toBe(true)
  })

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
