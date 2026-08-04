import { describe, expect, it } from 'vitest'
import {
  analyzeComplaint,
  analyzeComplaints,
  buildFixtureResearchArtifact,
  buildProductionResearchArtifact,
  clusterComplaints,
  deduplicateComplaints
} from './index'
import { complaintAnalysisSchema, productionAnalysisInputSchema } from '@appsea/contracts'

const complaint = {
  id: 'c1',
  sourceId: 'fixture',
  sourceRecordId: 'record-1',
  canonicalLocator: null,
  capturedAt: '2026-07-10T00:00:00.000Z',
  publishedAt: null,
  query: 'test',
  product: 'Test',
  company: 'Test',
  feature: 'feature',
  category: 'problem',
  text: '  repeated   spaces ',
  language: 'en',
  synthetic: true,
  redacted: false,
  allowedRepresentation: 'fixture' as const
}

describe('fixture research', () => {
  it('classifies complaints deterministically and keeps unresolved market entities explicit', () => {
    const analyzed = analyzeComplaint({
      ...complaint,
      product: 'Teams',
      category: 'handoff loss',
      text: 'The handoff fails every time and we need an alternative.'
    })
    expect(analyzed.complaintType).toBe('workflow_gap')
    expect(analyzed.severity).toBe(3)
    expect(analyzed.recurrence).toBe('persistent')
    expect(analyzed.switchingIntent).toBe('explicit')
    expect(analyzed.entities.product.resolution).toBe('ambiguous')
    expect(analyzed.entities.product.canonicalName).toBeNull()
    expect(analyzed.entities.unresolvedTypes).toContain('competitor')
    expect(analyzed.entities.substitutes).toEqual([])
    expect(analyzed).toEqual(
      analyzeComplaint({
        ...complaint,
        product: 'Teams',
        category: 'handoff loss',
        text: 'The handoff fails every time and we need an alternative.'
      })
    )
  })

  it('orders analysis snapshots by complaint identity for replay', () => {
    const first = analyzeComplaints([complaint, { ...complaint, id: 'c0' }])
    const replay = analyzeComplaints([{ ...complaint, id: 'c0' }, complaint])
    expect(replay).toEqual(first)
    expect(first.map((entry) => entry.complaintId)).toEqual(['c0', 'c1'])
  })

  it('normalizes and deduplicates source records', () => {
    expect(deduplicateComplaints([complaint, complaint])).toEqual([
      { ...complaint, text: 'repeated spaces' }
    ])
  })

  it('builds a complete labeled artifact', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    expect(artifact.mode).toBe('fixture')
    expect(artifact.complaints).toHaveLength(4)
    expect(artifact.analyses).toHaveLength(4)
    expect(artifact.analyses.map((analysis) => analysis.complaintId).sort()).toEqual(
      artifact.complaints.map((entry) => entry.id).sort()
    )
    expect(artifact.clusters.length).toBeGreaterThan(0)
    expect(artifact.coverageGaps.length).toBeGreaterThan(0)
  })
})

const productionInput = productionAnalysisInputSchema.parse({
  collectionArtifactId: 'collection:research-test',
  runId: 'run:research-test',
  analysisRunId: 'analysis-run:research-test',
  transport: 'offline-sample',
  testOnly: true,
  request: {
    workspaceId: 'workspace:research-test',
    campaignId: 'campaign:research-test',
    runId: 'run:research-test',
    idempotencyKey: 'b'.repeat(64),
    sourceId: 'source:approved',
    policyVersion: 'policy-v1',
    query: 'handoff',
    limit: 10,
    purpose: 'opportunity-research',
    requestedDisplayMode: 'excerpt',
    budget: {
      currency: 'USD',
      maxSourceItems: 10,
      maxCostMicros: 0,
      maxActivityAttempts: 3
    },
    requestedAt: '2026-07-26T00:00:00.000Z'
  },
  policySnapshot: {
    sourceId: 'source:approved',
    policyVersion: 'policy-v1',
    contentHash: 'a'.repeat(64),
    reviewId: 'review:research-test',
    policy: {
      sourceId: 'source:approved',
      displayName: 'Approved test source',
      sourceType: 'api',
      enabled: true,
      policyState: 'approved',
      permittedPurposes: ['opportunity-research'],
      commercialUse: 'allowed',
      accessMethod: 'offline test transport',
      retentionDays: 30,
      deletionRequired: true,
      attributionRequired: true,
      displayMode: 'excerpt',
      coverageNotes: ['Offline test transport is not market evidence.'],
      reviewedAt: '2026-07-26T00:00:00.000Z',
      policyOwner: 'research-test',
      policyDocumentRef: null,
      expiresAt: '2026-10-26T00:00:00.000Z',
      quota: {
        requestsPerMinute: 1,
        maxRecordsPerRequest: 10,
        maxRecordsPerRun: 10,
        costPerRequestMicros: 0
      },
      deletion: {
        sourceRecordIdField: 'id',
        supportsTombstones: false,
        deletionPollIntervalHours: 24,
        retentionAction: 'redact'
      }
    }
  },
  complaints: [
    {
      id: 'complaint:research-2',
      evidenceId: 'evidence:research-2',
      sourceItemId: 'source-item:research-2',
      evidenceHash: '2'.repeat(64),
      sourceId: 'source:approved',
      sourceRecordId: '2',
      canonicalLocator: null,
      capturedAt: '2026-07-25T00:00:00.000Z',
      publishedAt: null,
      query: 'handoff',
      product: 'Example Inbox',
      company: 'Example Co',
      feature: 'handoff history',
      category: 'handoff loss',
      text: 'The next teammate cannot see the handoff history.',
      language: 'en',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    },
    {
      id: 'complaint:research-1',
      evidenceId: 'evidence:research-1',
      sourceItemId: 'source-item:research-1',
      evidenceHash: '1'.repeat(64),
      sourceId: 'source:approved',
      sourceRecordId: '1',
      canonicalLocator: null,
      capturedAt: '2026-07-24T00:00:00.000Z',
      publishedAt: null,
      query: 'handoff',
      product: 'Example Inbox',
      company: 'Example Co',
      feature: 'handoff history',
      category: 'handoff loss',
      text: 'Handoff history disappears when ownership changes.',
      language: 'en',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    },
    {
      id: 'complaint:research-3',
      evidenceId: 'evidence:research-3',
      sourceItemId: 'source-item:research-3',
      evidenceHash: '3'.repeat(64),
      sourceId: 'source:approved',
      sourceRecordId: '3',
      canonicalLocator: null,
      capturedAt: '2026-07-23T00:00:00.000Z',
      publishedAt: null,
      query: 'handoff',
      product: 'Other Inbox',
      company: 'Other Co',
      feature: 'assignment',
      category: 'handoff loss',
      text: 'Ownership changes do not leave a visible trail.',
      language: 'en',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    }
  ],
  deletions: [],
  coverageGaps: ['The offline test transport is not a statistical sample.'],
  warnings: ['Test-only transport.'],
  opportunitySeed: {
    seed: {
      id: 'opportunity:research-test',
      slug: 'research-test',
      name: 'Research Test Opportunity',
      oneLine: 'A test-only opportunity seed.',
      thesis: 'This seed is for deterministic pipeline tests only.',
      audience: 'Test users',
      firstWedge: 'Read-only handoff history.',
      tags: ['test-only'],
      competitors: [],
      contraryEvidence: ['Competitor research is intentionally absent.'],
      scoreFactors: {
        complaintVolume: 20,
        painSeverity: 30,
        recurrence: 20,
        willingnessToPay: 0,
        competitiveGap: 0,
        buildFeasibility: 40,
        evidenceQuality: 30,
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
    seedVersion: 'research-test-seed-v1',
    contentHash: 'b'.repeat(64),
    reviewId: 'review:research-test-seed',
    reviewedBy: 'research-test',
    reviewedAt: '2026-07-26T00:00:00.000Z'
  },
  analysisAt: '2026-07-26T00:00:00.000Z'
})

const reviewedBalancedInput = {
  profile: 'balanced' as const,
  demand: {
    complaintFrequency: 60,
    independentUserCount: 50,
    sourceDiversity: 40,
    recentVelocity: 45,
    timePersistence: 55,
    segmentDensity: 35
  },
  pain: { severity: 70, workflowCriticality: 60, workaroundCost: 50, switchingIntent: 40 },
  marketOpening: {
    competitorDissatisfaction: 45,
    unresolvedSolutionGap: 55,
    substituteWeakness: 50,
    timing: 40
  },
  businessQuality: {
    willingnessToPay: 35,
    repeatUseRetention: 40,
    audienceReachability: 50,
    expansionPotential: 30
  },
  executionQuality: {
    mvpFeasibility: 75,
    dataIntegrationFeasibility: 65,
    trustComplianceFeasibility: 70,
    platformIndependence: 60
  },
  riskPenalties: {
    sourceLegal: 1,
    platformConcentration: 1,
    commoditization: 1,
    regulatoryTrust: 0,
    manipulation: 0,
    eventDriven: 0
  },
  confidenceComponents: {
    sample: 0.6,
    sourceDiversity: 0.5,
    directness: 0.7,
    entityConfidence: 0.8,
    timeStability: 0.6,
    manipulationSpam: 0.9,
    methodAgreementHumanReview: 0.65
  },
  evidenceSnapshotId: 'evidence-snapshot-reviewed',
  coverageSummary: {
    sourceCount: 1,
    observationCount: 3,
    independentUserCount: 3,
    gapCount: 1,
    summary: 'One approved test source with visible coverage limits.'
  },
  freshnessSummary: {
    oldestObservationAt: '2026-07-23T00:00:00.000Z',
    newestObservationAt: '2026-07-25T00:00:00.000Z',
    asOf: '2026-07-26T00:00:00.000Z',
    ageDays: 3,
    summary: 'Recent test observations.'
  }
}

describe('production analysis composition', () => {
  it('is deterministic and preserves complete cluster membership', () => {
    const first = buildProductionResearchArtifact(productionInput)
    const replay = buildProductionResearchArtifact({
      ...productionInput,
      complaints: [...productionInput.complaints].reverse()
    })
    expect(replay).toEqual(first)
    expect(first.mode).toBe('production')
    expect(first.testOnly).toBe(true)
    expect(first.analyses).toHaveLength(first.complaints.length)
    expect(first.clusters.flatMap((cluster) => cluster.complaintIds).sort()).toEqual(
      first.complaints.map((complaint) => complaint.id).sort()
    )
    expect(first.clusters.every((cluster) => !cluster.summary.includes('synthetic'))).toBe(true)
    expect(first.coverageGaps).toContain(
      'This analysis was composed from a test-only offline transport and cannot support market conclusions.'
    )
    expect(first.coverageGaps).toContain(
      'No permitted competitor or contrary-signal source evidence is attached; reviewed seed values are not market research.'
    )
  })

  it('does not invent score factors from complaint text', () => {
    const first = buildProductionResearchArtifact(productionInput)
    const changedText = buildProductionResearchArtifact({
      ...productionInput,
      complaints: productionInput.complaints.map((complaint) => ({
        ...complaint,
        text: `${complaint.text} Additional unrelated words.`
      }))
    })
    expect(changedText.opportunity.scoreSnapshot).toEqual(first.opportunity.scoreSnapshot)
  })

  it('uses reviewed analysis snapshots so human corrections reach reports', () => {
    const reviewedAnalyses = productionInput.complaints.map((complaint, index) =>
      complaintAnalysisSchema.parse({
        ...analyzeComplaint(complaint),
        ...(index === 0
          ? { severity: 5, reviewState: 'corrected' as const }
          : { reviewState: 'confirmed' as const })
      })
    )
    const artifact = buildProductionResearchArtifact({
      ...productionInput,
      analyses: reviewedAnalyses
    })
    expect(
      artifact.analyses.find(
        (analysis) => analysis.complaintId === productionInput.complaints[0]?.id
      )
    ).toMatchObject({
      severity: 5,
      reviewState: 'corrected'
    })
  })

  it('keeps production clustering wording separate from fixture wording', () => {
    const clusters = clusterComplaints(productionInput.complaints, { mode: 'production' })
    expect(clusters[0]?.summary).not.toContain('synthetic')
  })

  it('uses only an explicitly reviewed balanced input envelope for v1 scoring', () => {
    const input = {
      ...productionInput,
      opportunitySeed: {
        ...productionInput.opportunitySeed,
        seed: {
          ...productionInput.opportunitySeed.seed,
          balancedScoreInput: reviewedBalancedInput
        }
      }
    }
    const artifact = buildProductionResearchArtifact(input)
    expect(artifact.opportunity.scoreSnapshot).toMatchObject({
      version: 'opportunity-score-v1.0.0',
      scoringProfile: 'balanced',
      evidenceSnapshotId: 'evidence-snapshot-reviewed'
    })
    const changedText = buildProductionResearchArtifact({
      ...input,
      complaints: input.complaints.map((complaint) => ({
        ...complaint,
        text: `${complaint.text} unrelated text that must not alter reviewed score.`
      }))
    })
    expect(changedText.opportunity.scoreSnapshot).toEqual(artifact.opportunity.scoreSnapshot)
  })
})
