import { describe, expect, it } from 'vitest'
import {
  authRetentionInputSchema,
  authRetentionResultSchema,
  authRecoveryBatchInputSchema,
  workspaceInvitationDeliveryBatchInputSchema,
  authSignInInputSchema,
  authReauthenticationInputSchema,
  authAccountDeletionInputSchema,
  authAccountDeletionResultSchema,
  authPasswordResetAcceptedReadModelSchema,
  authPasswordResetInputSchema,
  authPasswordResetRequestInputSchema,
  authPasswordResetTokenSchema,
  authSignUpInputSchema,
  authSessionListReadModelSchema,
  authSessionReadModelSchema,
  authSessionSummaryReadModelSchema,
  workspaceCostSummaryQuerySchema,
  workspaceCostSummaryReadModelSchema,
  workspaceCostAlertInputSchema,
  workspaceCostAlertObservationSchema,
  workspaceCostAlertResultSchema,
  sourceQuotaReconciliationCaseSchema,
  sourceQuotaReconciliationListQuerySchema,
  sourceQuotaReconciliationResolveInputSchema,
  sourceQuotaReconciliationAlertInputSchema,
  sourceQuotaReconciliationAlertResultSchema,
  productionAnalysisRecomputeAlertInputSchema,
  productionAnalysisRecomputeAlertObservationSchema,
  productionAnalysisRecomputeAlertResultSchema,
  complaintSchema,
  competitorFeatureMatrixEntrySchema,
  competitorSchema,
  fixturePersistenceInputSchema,
  fixtureResearchWorkflowInputSchema,
  fixtureResearchWorkflowStartRequestSchema,
  opportunitySchema,
  productionAnalysisHandoffReadModelSchema,
  productionAnalysisGovernanceSchema,
  productionAnalysisStatusReadModelSchema,
  productionAnalysisWorkflowPersistenceActivityResultSchema,
  productionCollectionRequestSchema,
  productionCollectionPersistenceInputSchema,
  productionCollectionResultSchema,
  productionCollectionWorkflowStartRequestSchema,
  productionWorkflowAdmissionDecisionSchema,
  sourceCollectionLeaseResultSchema,
  sourceSnapshotReconciliationInputSchema,
  sourceSnapshotReconciliationPageSchema,
  sourceSnapshotReconciliationReadModelSchema,
  sourceSnapshotReconciliationStartRequestSchema,
  researchJobBudgetSchema,
  researchCampaignConfigurationSchema,
  researchCampaignCreateInputSchema,
  researchCampaignReadModelSchema,
  researchCampaignUpdateInputSchema,
  researchCampaignRefreshScheduleReadModelSchema,
  researchCampaignRunInputSchema,
  researchCampaignRunReadModelSchema,
  sourcePolicySchema,
  sourcePolicyApprovalInputSchema,
  workspaceSourceReadModelSchema,
  complaintAnalysisCorrectionSchema,
  workspaceComplaintReviewInputSchema,
  sourceMaintenanceInputSchema,
  sourceMaintenanceResultSchema,
  maintenanceSchedulerNameSchema,
  maintenanceSchedulerOwnerIdSchema,
  maintenanceSchedulerLeaseTokenSchema,
  maintenanceSchedulerFenceSchema,
  maintenanceSchedulerLeaseResultSchema,
  maintenanceSchedulerRenewResultSchema,
  maintenanceSchedulerReleaseResultSchema,
  maintenanceSchedulerRunMetricSchema,
  maintenanceSchedulerRunPurgeInputSchema,
  workspaceOpportunityReadModelSchema,
  workspaceOpportunityDetailReadModelSchema,
  competitiveResearchReadModelSchema,
  competitiveResearchObservationCreateInputSchema,
  competitiveResearchObservationReviewInputSchema,
  composeCompetitiveResearchReadModel,
  workspaceReportApprovalInputSchema,
  workspaceReportExportReadModelSchema,
  workspacePlanApprovalInputSchema,
  workspacePlanExportReadModelSchema,
  workspacePlanReadModelSchema,
  workspaceMemberRoleUpdateInputSchema,
  workspaceMemberReadModelSchema,
  workspaceInvitationAcceptInputSchema,
  workspaceInvitationAcceptedReadModelSchema,
  workspaceInvitationCreateInputSchema,
  workspaceInvitationReadModelSchema,
  type FixturePersistenceInput
} from './index'

const now = '2026-07-10T00:00:00.000Z'
const scoreValues = {
  complaintVolume: 50,
  painSeverity: 50,
  recurrence: 50,
  willingnessToPay: 50,
  competitiveGap: 50,
  buildFeasibility: 50,
  evidenceQuality: 50,
  contraryEvidencePenalty: 10
}

const validFixturePersistenceInput: FixturePersistenceInput = {
  workspaceId: 'workspace-fixture',
  campaignId: 'campaign-fixture',
  runId: 'run-fixture',
  idempotencyKey: 'fixture-run-key',
  requestedAt: now,
  artifact: {
    id: 'artifact-fixture',
    mode: 'fixture' as const,
    createdAt: now,
    sourcePolicies: [
      {
        sourceId: 'fixture-source',
        displayName: 'Fixture source',
        sourceType: 'fixture' as const,
        enabled: true,
        policyState: 'approved' as const,
        permittedPurposes: ['testing'],
        commercialUse: 'allowed' as const,
        accessMethod: 'repository fixture',
        retentionDays: 0,
        deletionRequired: false,
        attributionRequired: false,
        displayMode: 'fixture' as const,
        coverageNotes: ['Synthetic only'],
        reviewedAt: now,
        policyOwner: 'contracts-test',
        policyDocumentRef: null,
        expiresAt: null,
        quota: {
          requestsPerMinute: 60,
          maxRecordsPerRequest: 5_000,
          maxRecordsPerRun: 50_000,
          costPerRequestMicros: 0
        },
        deletion: {
          sourceRecordIdField: 'source_record_id',
          supportsTombstones: false,
          deletionPollIntervalHours: 24,
          retentionAction: 'tombstone' as const
        }
      }
    ],
    complaints: [
      {
        id: 'complaint-fixture',
        sourceId: 'fixture-source',
        sourceRecordId: 'fixture-record',
        canonicalLocator: null,
        capturedAt: now,
        publishedAt: null,
        query: 'fixture query',
        product: 'Fixture product',
        company: 'Fixture company',
        feature: 'Fixture feature',
        category: 'Fixture category',
        text: 'Synthetic fixture complaint.',
        language: 'en',
        synthetic: true,
        redacted: false,
        allowedRepresentation: 'fixture' as const
      }
    ],
    analyses: [
      {
        complaintId: 'complaint-fixture',
        classification: 'complaint',
        complaintType: 'workflow_gap',
        problemStatement: 'Synthetic fixture complaint.',
        expectedOutcome: null,
        observedOutcome: 'Synthetic fixture complaint.',
        consequence: null,
        affectedWorkflow: 'Fixture feature',
        workaround: null,
        featureMentions: ['Fixture feature'],
        userSegmentHints: [],
        severity: 1,
        recurrence: 'unknown',
        switchingIntent: 'unknown',
        paymentSignal: 'unknown',
        actionabilityProbability: 0.8,
        classificationConfidence: 0.8,
        entityConfidence: 0.9,
        manipulationRisk: 0,
        piiFlags: [],
        policyFlags: ['synthetic-fixture'],
        reviewState: 'unreviewed',
        extractionVersion: 'complaint-analysis-v0.1.0',
        derivation: {
          skillVersion: 'appsea-complaint-analysis-v1',
          modelVersion: 'deterministic-rules-v1',
          promptVersion: 'none'
        },
        entities: {
          product: {
            entityType: 'product',
            surfaceText: 'Fixture product',
            canonicalName: 'Fixture product',
            confidence: 0.9,
            resolution: 'exact',
            evidence: 'source-field'
          },
          company: {
            entityType: 'company',
            surfaceText: 'Fixture company',
            canonicalName: 'Fixture company',
            confidence: 0.9,
            resolution: 'exact',
            evidence: 'source-field'
          },
          feature: {
            entityType: 'feature',
            surfaceText: 'Fixture feature',
            canonicalName: 'Fixture feature',
            confidence: 0.9,
            resolution: 'exact',
            evidence: 'source-field'
          },
          substitutes: [],
          competitors: [],
          unresolvedTypes: ['substitute', 'competitor']
        }
      }
    ],
    clusters: [
      {
        id: 'cluster-fixture',
        title: 'Fixture cluster',
        product: 'Fixture product',
        category: 'Fixture category',
        summary: 'One synthetic fixture observation.',
        complaintIds: ['complaint-fixture'],
        uniqueObservationCount: 1,
        sourceCount: 1,
        confidence: 0.8
      }
    ],
    opportunity: {
      id: 'opportunity-fixture',
      slug: 'fixture-opportunity',
      name: 'Fixture Opportunity',
      oneLine: 'A synthetic opportunity.',
      thesis: 'Fixture evidence proves contract shape only.',
      audience: 'Test users',
      firstWedge: 'A deterministic fixture path.',
      complaintCount: 1,
      synthetic: true,
      tags: ['fixture'],
      complaintIds: ['complaint-fixture'],
      competitors: [],
      scoreSnapshot: {
        score: 50,
        version: 'fixture-score-v1',
        calculatedAt: now,
        factors: scoreValues,
        weights: scoreValues
      },
      contraryEvidence: ['Synthetic evidence cannot prove demand.'],
      planFiles: ['README.md']
    },
    coverageGaps: ['No live source is enabled.'],
    warnings: ['Synthetic fixture only.']
  },
  planPackage: {
    opportunitySlug: 'fixture-opportunity',
    generatedAt: now,
    files: [{ path: 'README.md', content: '# Fixture Opportunity' }]
  }
}

describe('contracts', () => {
  it('bounds full-snapshot reconciliation inputs and preserves visible incomplete state', () => {
    const base = {
      workspaceId: 'workspace-fixture',
      reconciliationId: 'reconciliation:source:0123456789abcdef0123456789abcdef',
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-policy-v1',
      idempotencyKey: 'a'.repeat(64),
      pageSize: 100,
      maxRecords: 1_000,
      requestedAt: now
    }
    expect(sourceSnapshotReconciliationInputSchema.safeParse(base).success).toBe(true)
    expect(
      sourceSnapshotReconciliationInputSchema.safeParse({ ...base, maxRecords: 99 }).success
    ).toBe(false)
    expect(
      sourceSnapshotReconciliationReadModelSchema.safeParse({
        ...base,
        inputHash: 'b'.repeat(64),
        state: 'incomplete',
        attemptCount: 1,
        pagesScanned: 10,
        sourceRecordCount: 1_000,
        deletionCount: 0,
        coverageGaps: ['The bounded snapshot ended before a short page was observed.'],
        warnings: [],
        failureCode: 'snapshot_incomplete',
        failureSummary: 'The source snapshot was incomplete.',
        observedAt: now,
        finishedAt: now,
        nextOffset: 1_000,
        nextAttemptAt: now,
        updatedAt: now
      }).success
    ).toBe(true)
    expect(
      sourceSnapshotReconciliationPageSchema.safeParse({
        offset: 0,
        pageSize: 100,
        sourceRecordCount: 1,
        sourceRecordIds: ['123'],
        shortPage: true,
        completeSnapshot: true,
        warnings: []
      }).success
    ).toBe(true)
    expect(
      sourceSnapshotReconciliationPageSchema.safeParse({
        offset: 0,
        pageSize: 100,
        sourceRecordCount: 100,
        sourceRecordIds: ['123'],
        shortPage: true,
        completeSnapshot: true,
        warnings: []
      }).success
    ).toBe(false)
    expect(
      sourceSnapshotReconciliationStartRequestSchema.safeParse({
        sourceId: 'cfpb-consumer-complaints',
        policyVersion: 'cfpb-policy-v1',
        idempotencyKey: 'caller-key-that-is-never-persisted',
        pageSize: 100,
        maxRecords: 1_000,
        requestedAt: now
      }).success
    ).toBe(true)
    expect(
      sourceSnapshotReconciliationStartRequestSchema.safeParse({
        sourceId: 'cfpb-consumer-complaints',
        policyVersion: 'cfpb-policy-v1',
        idempotencyKey: 'caller-key-that-is-never-persisted',
        pageSize: 101,
        maxRecords: 100,
        requestedAt: now
      }).success
    ).toBe(false)
  })

  it('rejects a source without a reviewed policy', () => {
    const result = sourcePolicySchema.safeParse({ sourceId: 'missing-fields' })
    expect(result.success).toBe(false)
  })

  it('requires a canonical independent source-policy reviewer', () => {
    const valid = {
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-policy-v1',
      reviewId: 'review:cfpb:v1',
      reviewer: 'Privacy review queue',
      reviewerIdentity: 'privacy-reviewer@example.invalid',
      reviewerRole: 'privacy' as const,
      independenceAttested: true as const,
      approvalReference: 'ticket:cfpb:v1',
      notes: ['Reviewed intended use and retention.'],
      contentHash: 'a'.repeat(64),
      reviewedAt: now,
      expiresAt: null,
      recordedAt: now
    }
    expect(sourcePolicyApprovalInputSchema.safeParse(valid).success).toBe(true)
    expect(
      sourcePolicyApprovalInputSchema.safeParse({
        ...valid,
        reviewerIdentity: 'Privacy-Reviewer@example.invalid'
      }).success
    ).toBe(false)
    expect(
      sourcePolicyApprovalInputSchema.safeParse({ ...valid, independenceAttested: false }).success
    ).toBe(false)
  })

  it('keeps the private source registry bounded and policy-safe', () => {
    const source = workspaceSourceReadModelSchema.parse({
      sourceId: 'cfpb-consumer-complaints',
      displayName: 'CFPB Consumer Complaint Database',
      sourceType: 'api',
      lifecycleState: 'disabled_pending_review',
      currentPolicyVersion: 'cfpb-policy-v1',
      policyVersion: 'cfpb-policy-v1',
      policyState: 'pending_review',
      permittedPurposes: ['opportunity-research'],
      commercialUse: 'allowed',
      accessMethod: 'Official API',
      retentionDays: 30,
      deletionRequired: true,
      attributionRequired: true,
      displayMode: 'excerpt',
      coverageNotes: ['Historical export is not covered.'],
      policyDocumentRef: 'https://example.com/policy',
      reviewedAt: now,
      expiresAt: null,
      quota: {
        requestsPerMinute: 6,
        maxRecordsPerRequest: 1000,
        maxRecordsPerRun: 1000,
        costPerRequestMicros: 0
      },
      deletion: {
        sourceRecordIdField: 'complaint_id',
        supportsTombstones: false,
        deletionPollIntervalHours: 24,
        retentionAction: 'redact'
      },
      enabled: false,
      synthetic: false,
      collectible: false
    })
    expect(source.collectible).toBe(false)
    expect(workspaceSourceReadModelSchema.safeParse({ ...source, policyPayload: {} }).success).toBe(
      false
    )
    expect(
      workspaceSourceReadModelSchema.safeParse({
        ...source,
        policyDocumentRef: 'javascript:alert(1)'
      }).success
    ).toBe(false)
  })

  it('validates bounded authentication inputs and excludes secrets from read models', () => {
    expect(
      authSignUpInputSchema.safeParse({
        email: 'User@Example.com',
        password: 'a sufficiently long password',
        displayName: 'Example User',
        workspaceName: 'Private workspace',
        workspaceSlug: 'private-workspace'
      }).success
    ).toBe(true)
    expect(
      authSignInInputSchema.safeParse({ email: 'not-an-email', password: 'short' }).success
    ).toBe(false)
    expect(
      authReauthenticationInputSchema.safeParse({ password: 'a sufficiently long password' })
        .success
    ).toBe(true)
    expect(
      authAccountDeletionInputSchema.safeParse({ confirmation: 'DELETE MY ACCOUNT' }).success
    ).toBe(true)
    expect(
      authAccountDeletionInputSchema.safeParse({ confirmation: 'delete my account' }).success
    ).toBe(false)
    expect(
      authAccountDeletionResultSchema.safeParse({ closed: true, blockingWorkspaceIds: [] }).success
    ).toBe(true)
    expect(
      authSignUpInputSchema.safeParse({
        email: 'user@example.com',
        password: 'a sufficiently long password',
        displayName: 'Example User'
      }).success
    ).toBe(false)
    expect(
      authSessionReadModelSchema.safeParse({
        sessionId: 'session:abc',
        user: {
          userId: 'user:abc',
          email: 'user@example.com',
          displayName: 'Example User',
          createdAt: now
        },
        workspaces: [],
        expiresAt: now
      }).success
    ).toBe(true)
    expect(
      authSessionReadModelSchema.safeParse({
        sessionId: 'session:abc',
        user: {
          userId: 'user:abc',
          email: 'user@example.com',
          displayName: 'Example User',
          password: 'must-not-be-returned',
          createdAt: now
        },
        workspaces: [],
        expiresAt: now
      }).success
    ).toBe(false)
  })

  it('validates session inventory read models without exposing token material', () => {
    const summary = {
      id: 'session:abc',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now,
      current: true
    }
    expect(authSessionSummaryReadModelSchema.safeParse(summary).success).toBe(true)
    expect(authSessionListReadModelSchema.safeParse({ sessions: [summary] }).success).toBe(true)
    expect(
      authSessionSummaryReadModelSchema.safeParse({ ...summary, token: 'secret' }).success
    ).toBe(false)
    expect(
      authSessionListReadModelSchema.safeParse({ sessions: [{ ...summary, current: 'yes' }] })
        .success
    ).toBe(false)
    expect(
      authSessionListReadModelSchema.safeParse({
        sessions: Array.from({ length: 1_001 }, () => summary)
      }).success
    ).toBe(false)
  })

  it('bounds password-reset inputs and keeps the accepted response token-free', () => {
    expect(
      authPasswordResetRequestInputSchema.safeParse({ email: 'User@Example.com' }).success
    ).toBe(true)
    expect(
      authPasswordResetInputSchema.safeParse({
        token: 'a'.repeat(48),
        password: 'a sufficiently long replacement password'
      }).success
    ).toBe(true)
    expect(authPasswordResetTokenSchema.safeParse('short').success).toBe(false)
    expect(
      authPasswordResetInputSchema.safeParse({
        token: 'a'.repeat(48),
        password: 'short'
      }).success
    ).toBe(false)
    expect(authPasswordResetAcceptedReadModelSchema.safeParse({ accepted: true }).success).toBe(
      true
    )
    expect(
      authPasswordResetAcceptedReadModelSchema.safeParse({ accepted: true, token: 'secret' })
        .success
    ).toBe(false)
  })

  it('bounds maintenance job inputs and outputs', () => {
    expect(maintenanceSchedulerNameSchema.safeParse('appsea-source-maintenance-v1').success).toBe(
      true
    )
    expect(maintenanceSchedulerOwnerIdSchema.safeParse('worker:host-1:123').success).toBe(true)
    expect(maintenanceSchedulerLeaseTokenSchema.safeParse('token:worker:host-1:123').success).toBe(
      true
    )
    expect(
      maintenanceSchedulerFenceSchema.safeParse({
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host-1:123',
        leaseToken: 'token:worker:host-1:123'
      }).success
    ).toBe(true)
    expect(
      maintenanceSchedulerFenceSchema.safeParse({
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host-1:123',
        leaseToken: 'token:worker:host-1:123',
        secret: 'must-not-be-carried'
      }).success
    ).toBe(false)
    expect(
      maintenanceSchedulerLeaseResultSchema.safeParse({
        acquired: true,
        leaseUntil: now,
        leaseToken: 'token:worker:host-1:123'
      }).success
    ).toBe(true)
    expect(
      maintenanceSchedulerRenewResultSchema.safeParse({
        renewed: false,
        leaseUntil: null
      }).success
    ).toBe(true)
    expect(maintenanceSchedulerReleaseResultSchema.safeParse({ released: true }).success).toBe(true)
    expect(maintenanceSchedulerNameSchema.safeParse('bad name').success).toBe(false)
    expect(maintenanceSchedulerOwnerIdSchema.safeParse('x').success).toBe(false)
    expect(maintenanceSchedulerLeaseTokenSchema.safeParse('short').success).toBe(false)
    expect(
      maintenanceSchedulerLeaseResultSchema.safeParse({
        acquired: true,
        leaseUntil: null,
        leaseToken: null
      }).success
    ).toBe(false)
    expect(
      maintenanceSchedulerRenewResultSchema.safeParse({ renewed: true, leaseUntil: null }).success
    ).toBe(false)

    expect(
      maintenanceSchedulerRunMetricSchema.safeParse({
        runId: 'maintenance:run:one',
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host:1',
        state: 'succeeded',
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        failureCode: null,
        counters: { sourceItems: 4, deletionTombstones: 1 }
      }).success
    ).toBe(true)
    expect(
      maintenanceSchedulerRunMetricSchema.safeParse({
        runId: 'maintenance:run:failed',
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host:1',
        state: 'failed',
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        failureCode: 'APPSEA_SOURCE_MAINTENANCE_FAILED',
        counters: {}
      }).success
    ).toBe(true)
    expect(
      maintenanceSchedulerRunMetricSchema.safeParse({
        runId: 'maintenance:run:raw',
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host:1',
        state: 'failed',
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        failureCode: 'database password leaked',
        counters: {}
      }).success
    ).toBe(false)
    expect(
      maintenanceSchedulerRunMetricSchema.safeParse({
        runId: 'maintenance:run:bad-state',
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host:1',
        state: 'succeeded',
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        failureCode: 'APPSEA_SOURCE_MAINTENANCE_FAILED',
        counters: {}
      }).success
    ).toBe(false)
    expect(
      maintenanceSchedulerRunMetricSchema.safeParse({
        runId: 'maintenance:run:too-many',
        schedulerName: 'appsea-source-maintenance-v1',
        ownerId: 'worker:host:1',
        state: 'succeeded',
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        failureCode: null,
        counters: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`counter${index}`, 1])
        )
      }).success
    ).toBe(false)
    expect(
      maintenanceSchedulerRunPurgeInputSchema.safeParse({ before: now, limit: 100 }).success
    ).toBe(true)

    const sourceInput = {
      jobId: 'maintenance:source:123',
      occurredAt: now,
      quotaBatchSize: 100,
      deletionBatchSize: 25,
      retentionBatchSize: 25,
      snapshotReconciliationBatchSize: 2,
      quotaRetentionDays: 7,
      workspaceId: null
    }
    expect(sourceMaintenanceInputSchema.safeParse(sourceInput).success).toBe(true)
    expect(
      sourceMaintenanceResultSchema.safeParse({
        jobId: sourceInput.jobId,
        quotaWorkspacesScanned: 2,
        deletionWorkspacesScanned: 2,
        quotaReservationsExpired: 3,
        quotaReservationsPurged: 4,
        productionWorkflowAdmissionsPurged: 2,
        productionAnalysisAdmissionsPurged: 3,
        sourceCollectionLeasesPurged: 1,
        productionAnalysisObjectsPurged: 2,
        sourceSnapshotReconciliationsProcessed: 2,
        sourceSnapshotReconciliationsCompleted: 1,
        sourceSnapshotReconciliationsIncomplete: 0,
        sourceSnapshotReconciliationsFailed: 0,
        sourceSnapshotReconciliationsRetried: 1,
        sourceSnapshotCoverageGaps: 3,
        campaignRefreshClaims: 1,
        campaignRefreshDispatched: 1,
        campaignRefreshFailed: 0,
        campaignRefreshPolicyDenied: 0,
        retentionTombstonesQueued: 5,
        deletionTombstonesProcessed: 6,
        deletionObjectsAffected: 7,
        deletionOpportunitiesInvalidated: 1,
        recomputationJobsQueued: 2
      }).success
    ).toBe(true)
    expect(
      sourceMaintenanceInputSchema.safeParse({ ...sourceInput, deletionBatchSize: 0 }).success
    ).toBe(false)
    expect(
      sourceMaintenanceResultSchema.safeParse({
        jobId: sourceInput.jobId,
        quotaWorkspacesScanned: 2,
        deletionWorkspacesScanned: 2,
        quotaReservationsExpired: 3,
        quotaReservationsPurged: 4,
        productionWorkflowAdmissionsPurged: 2,
        productionAnalysisAdmissionsPurged: 3,
        sourceCollectionLeasesPurged: 1,
        productionAnalysisObjectsPurged: 2,
        sourceSnapshotReconciliationsProcessed: 2,
        sourceSnapshotReconciliationsCompleted: 1,
        sourceSnapshotReconciliationsIncomplete: 0,
        sourceSnapshotReconciliationsFailed: 0,
        sourceSnapshotReconciliationsRetried: 1,
        sourceSnapshotCoverageGaps: 3,
        campaignRefreshClaims: 1,
        campaignRefreshDispatched: 1,
        campaignRefreshFailed: 0,
        campaignRefreshPolicyDenied: 0,
        retentionTombstonesQueued: 5,
        deletionTombstonesProcessed: 5,
        deletionObjectsAffected: 10_000_001,
        deletionOpportunitiesInvalidated: 1,
        recomputationJobsQueued: 2
      }).success
    ).toBe(false)

    expect(
      authRetentionInputSchema.safeParse({
        jobId: 'maintenance:auth:123',
        retentionDays: 7,
        batchSize: 100
      }).success
    ).toBe(true)
    expect(
      authRetentionResultSchema.safeParse({
        jobId: 'maintenance:auth:123',
        sessionsDeleted: 2,
        rateLimitsDeleted: 4,
        passwordResetTokensDeleted: 1,
        workspaceInvitationsDeleted: 2
      }).success
    ).toBe(true)
    expect(authRecoveryBatchInputSchema.safeParse({ batchSize: 100 }).success).toBe(true)
    expect(authRecoveryBatchInputSchema.safeParse({ batchSize: 101 }).success).toBe(false)
    expect(workspaceInvitationDeliveryBatchInputSchema.safeParse({ batchSize: 100 }).success).toBe(
      true
    )
    expect(workspaceInvitationDeliveryBatchInputSchema.safeParse({ batchSize: 101 }).success).toBe(
      false
    )
  })

  it('bounds private workspace member administration inputs and read models', () => {
    expect(workspaceMemberRoleUpdateInputSchema.safeParse({ role: 'editor' }).success).toBe(true)
    expect(workspaceMemberRoleUpdateInputSchema.safeParse({ role: 'admin' }).success).toBe(false)
    expect(
      workspaceMemberRoleUpdateInputSchema.safeParse({ role: 'viewer', extra: 'nope' }).success
    ).toBe(false)
    expect(
      workspaceMemberReadModelSchema.safeParse({
        userId: 'user:member',
        email: 'member@example.com',
        displayName: 'Workspace Member',
        role: 'viewer',
        createdAt: now
      }).success
    ).toBe(true)
  })

  it('keeps invitations non-owner, token-free, and strict', () => {
    expect(
      workspaceInvitationCreateInputSchema.safeParse({
        email: 'invitee@example.com',
        role: 'editor'
      }).success
    ).toBe(true)
    expect(
      workspaceInvitationCreateInputSchema.safeParse({
        email: 'invitee@example.com',
        role: 'owner'
      }).success
    ).toBe(false)
    expect(workspaceInvitationAcceptInputSchema.safeParse({ token: 'a'.repeat(48) }).success).toBe(
      true
    )
    expect(
      workspaceInvitationAcceptInputSchema.safeParse({ token: 'a'.repeat(48), email: 'x' }).success
    ).toBe(false)
    expect(
      workspaceInvitationReadModelSchema.safeParse({
        invitationId: 'invite:one',
        email: 'invitee@example.com',
        role: 'viewer',
        state: 'pending',
        createdAt: '2026-07-25T00:00:00.000Z',
        expiresAt: '2026-07-28T00:00:00.000Z'
      }).success
    ).toBe(true)
    expect(
      workspaceInvitationAcceptedReadModelSchema.safeParse({
        accepted: true,
        workspaceId: 'workspace:one',
        role: 'editor'
      }).success
    ).toBe(true)
  })

  it('validates private opportunity summaries', () => {
    expect(
      workspaceOpportunityReadModelSchema.safeParse({
        id: 'opportunity:one',
        slug: 'private-opportunity',
        name: 'Private opportunity',
        oneLine: 'A private opportunity',
        complaintCount: 2,
        synthetic: true,
        score: 72.5,
        scoreVersion: 'fixture-score-v1',
        scoreCalculatedAt: now,
        state: 'researched',
        currentReportId: null,
        currentPlanPackageId: 'plan:one'
      }).success
    ).toBe(true)
  })

  it('requires explicit coverage gaps on private opportunity details', () => {
    const result = workspaceOpportunityDetailReadModelSchema.safeParse({
      opportunity: {
        id: 'opportunity:one',
        slug: 'private-opportunity',
        name: 'Private opportunity',
        oneLine: 'A private opportunity',
        thesis: 'A thesis',
        audience: 'Users',
        firstWedge: 'A wedge',
        complaintCount: 0,
        synthetic: true,
        tags: [],
        complaintIds: [],
        competitors: [],
        scoreSnapshot: {
          score: 0,
          version: 'fixture-score-v1',
          calculatedAt: now,
          factors: scoreValues,
          weights: scoreValues
        },
        contraryEvidence: [],
        planFiles: []
      },
      summary: {
        id: 'opportunity:one',
        slug: 'private-opportunity',
        name: 'Private opportunity',
        oneLine: 'A private opportunity',
        complaintCount: 0,
        synthetic: true,
        score: 0,
        scoreVersion: 'fixture-score-v1',
        scoreCalculatedAt: now,
        state: 'researched',
        currentReportId: null,
        currentPlanPackageId: null
      },
      evidence: [],
      competitiveResearch: {
        status: 'unresolved',
        observedAt: null,
        sourceIds: [],
        evidenceIds: [],
        coverageGaps: ['Competitor records are synthetic examples, not verified market research.'],
        seedReview: null,
        synthetic: true
      },
      coverageGaps: ['No live source is enabled.'],
      sourceCoverage: [],
      report: null,
      plan: null
    })
    expect(result.success).toBe(true)
  })

  it('keeps competitive research provenance and coverage state explicit', () => {
    const observation = {
      observationId: 'observation:competitor-one',
      opportunityId: 'opportunity:one',
      competitorId: 'competitor:one',
      sourceId: 'source:directory',
      sourceRecordId: 'record-1',
      sourceItemId: 'source-item:one',
      evidenceId: 'evidence:competitor',
      claimType: 'feature' as const,
      claim: 'The competitor lacks a reliable export workflow.',
      observedAt: now,
      capturedAt: now,
      publishedAt: null,
      confidence: 0.8,
      reviewState: 'confirmed' as const,
      synthetic: false,
      allowedRepresentation: 'excerpt' as const,
      canonicalLocator: 'https://example.com/record-1',
      createdBy: 'user:editor',
      reviewedBy: 'user:owner',
      reviewedAt: now,
      createdAt: now,
      updatedAt: now
    }
    expect(
      competitiveResearchReadModelSchema.safeParse({
        status: 'source-backed',
        observedAt: now,
        sourceIds: ['source:directory'],
        evidenceIds: ['evidence:competitor'],
        observations: [observation],
        coverageGaps: [],
        seedReview: null,
        synthetic: false
      }).success
    ).toBe(true)
    expect(
      competitiveResearchReadModelSchema.safeParse({
        status: 'source-backed',
        observedAt: null,
        sourceIds: [],
        evidenceIds: [],
        coverageGaps: [],
        seedReview: null,
        synthetic: true
      }).success
    ).toBe(false)

    expect(
      competitiveResearchReadModelSchema.safeParse({
        status: 'source-backed',
        observedAt: now,
        sourceIds: ['source:directory'],
        evidenceIds: ['evidence:competitor'],
        observations: [{ ...observation, reviewState: 'unreviewed' }],
        coverageGaps: [],
        seedReview: null,
        synthetic: false
      }).success
    ).toBe(false)

    expect(
      competitiveResearchObservationCreateInputSchema.safeParse({
        observationId: observation.observationId,
        competitorId: observation.competitorId,
        sourceItemId: observation.sourceItemId,
        evidenceId: observation.evidenceId,
        claimType: observation.claimType,
        claim: observation.claim,
        observedAt: observation.observedAt,
        confidence: observation.confidence
      }).success
    ).toBe(true)
    expect(
      competitiveResearchObservationReviewInputSchema.safeParse({ action: 'confirmed' }).success
    ).toBe(true)
    expect(
      competitiveResearchObservationReviewInputSchema.safeParse({ action: 'reviewed' }).success
    ).toBe(false)

    const seedOnly = composeCompetitiveResearchReadModel({
      synthetic: false,
      coverageGaps: [],
      seedReview: {
        reviewId: 'seed-review:one',
        seedVersion: 'seed-v1',
        contentHash: 'a'.repeat(64),
        reviewedBy: 'user:owner',
        reviewedAt: now
      }
    })
    expect(seedOnly.status).toBe('reviewed-seed-only')
    expect(seedOnly.coverageGaps[0]).toContain('not market research')

    const unreviewed = composeCompetitiveResearchReadModel({
      synthetic: false,
      coverageGaps: [],
      observations: [{ ...observation, reviewState: 'unreviewed' }]
    })
    expect(unreviewed.status).toBe('unresolved')

    const sourceBacked = composeCompetitiveResearchReadModel({
      synthetic: false,
      coverageGaps: [],
      observations: [observation]
    })
    expect(sourceBacked.status).toBe('source-backed')
    expect(sourceBacked.sourceIds).toEqual(['source:directory'])
    expect(sourceBacked.evidenceIds).toEqual(['evidence:competitor'])
  })

  it('keeps report approval actions strict and export hashes bounded', () => {
    expect(workspaceReportApprovalInputSchema.safeParse({ action: 'reviewed' }).success).toBe(true)
    expect(workspaceReportApprovalInputSchema.safeParse({ action: 'approved' }).success).toBe(true)
    expect(workspaceReportApprovalInputSchema.safeParse({ action: 'draft' }).success).toBe(false)
    expect(
      workspaceReportApprovalInputSchema.safeParse({ action: 'approved', extra: true }).success
    ).toBe(false)

    const report = {
      id: 'report:one',
      version: 'fixture-report-v1',
      structuredReport: {
        schemaVersion: '1.0.0' as const,
        reportType: 'opportunity' as const,
        synthetic: true,
        artifactId: 'research:one',
        generatedAt: now,
        opportunity: {
          id: 'opportunity:one',
          slug: 'private-opportunity',
          name: 'Private opportunity',
          thesis: 'A thesis',
          audience: 'Users',
          firstWedge: 'A wedge'
        },
        evidence: { complaintCount: 0, clusterCount: 0, observations: [], clusters: [] },
        inference: {
          scoreSnapshot: {
            score: 0,
            version: 'fixture-score-v1',
            calculatedAt: now,
            factors: scoreValues,
            weights: scoreValues
          },
          confidence: 'low' as const,
          rationale: [],
          contraryEvidence: []
        },
        recommendation: {
          decision: 'defer' as const,
          firstWedge: 'A wedge',
          nextSteps: ['Validate the strongest uncertainty']
        },
        coverage: { gaps: ['No live source'], sources: [] },
        warnings: ['Synthetic fixture only']
      },
      generatedAt: now,
      approvalState: 'approved' as const
    }
    expect(
      workspaceReportExportReadModelSchema.safeParse({
        report,
        manifestHash: 'a'.repeat(64)
      }).success
    ).toBe(true)
  })

  it('requires synthetic fixture labeling on complaints', () => {
    const result = complaintSchema.safeParse({
      id: 'c1',
      sourceId: 'fixture',
      sourceRecordId: 'f1',
      capturedAt: now,
      publishedAt: now,
      query: 'query',
      product: 'MailBox',
      company: 'Example',
      feature: 'triage',
      category: 'handoff',
      text: 'A synthetic complaint',
      language: 'en',
      redacted: false,
      allowedRepresentation: 'fixture'
    })
    expect(result.success).toBe(false)
  })

  it('keeps complaint-analysis corrections derived-only and idempotency-bound', () => {
    const correction = {
      classification: 'complaint' as const,
      complaintType: 'workflow_gap' as const,
      severity: 4,
      entities: {
        product: {
          entityType: 'product' as const,
          surfaceText: 'TeamMail',
          canonicalName: 'TeamMail',
          confidence: 0.98,
          resolution: 'exact' as const,
          evidence: 'source-field' as const
        },
        company: {
          entityType: 'company' as const,
          surfaceText: 'Synthetic Mail Co',
          canonicalName: 'Synthetic Mail Co',
          confidence: 0.98,
          resolution: 'exact' as const,
          evidence: 'source-field' as const
        },
        feature: {
          entityType: 'feature' as const,
          surfaceText: 'shared inbox assignment',
          canonicalName: 'shared inbox assignment',
          confidence: 0.9,
          resolution: 'normalized' as const,
          evidence: 'source-context' as const
        },
        substitutes: [],
        competitors: [],
        unresolvedTypes: ['substitute', 'competitor'] as const
      }
    }
    expect(complaintAnalysisCorrectionSchema.safeParse(correction).success).toBe(true)
    expect(
      workspaceComplaintReviewInputSchema.safeParse({
        action: 'corrected',
        correctionId: 'correction:analysis:one',
        analysisCorrection: correction
      }).success
    ).toBe(true)
    expect(
      workspaceComplaintReviewInputSchema.safeParse({
        action: 'corrected',
        analysisCorrection: correction
      }).success
    ).toBe(false)
    expect(
      workspaceComplaintReviewInputSchema.safeParse({
        action: 'confirmed',
        correctionId: 'correction:analysis:one',
        analysisCorrection: correction
      }).success
    ).toBe(false)
    expect(
      complaintAnalysisCorrectionSchema.safeParse({ text: 'raw source content' }).success
    ).toBe(false)
  })

  it('requires provenance for source-backed competitor feature coverage', () => {
    const reviewedSeed = competitorSchema.parse({
      name: 'Reviewed alternative',
      type: 'adjacent',
      positioning: 'A reviewed seed assumption',
      strengths: [],
      weaknesses: [],
      relatedComplaintCategories: [],
      featureMatrix: [
        {
          feature: 'Handoff history',
          status: 'partial',
          evidenceBasis: 'reviewed-seed',
          notes: 'Requires a reviewed product assumption.'
        }
      ]
    })
    expect(reviewedSeed.featureMatrix[0]?.observationIds).toEqual([])
    expect(
      competitorFeatureMatrixEntrySchema.safeParse({
        feature: 'Handoff history',
        status: 'supported',
        evidenceBasis: 'source-observation',
        observationIds: [],
        notes: null
      }).success
    ).toBe(false)
    expect(
      competitorFeatureMatrixEntrySchema.safeParse({
        feature: 'Handoff history',
        status: 'supported',
        evidenceBasis: 'fixture',
        observationIds: ['observation:source-backed'],
        notes: null
      }).success
    ).toBe(false)
    expect(
      competitorSchema.safeParse({
        ...reviewedSeed,
        featureMatrix: [
          ...reviewedSeed.featureMatrix,
          {
            feature: ' handoff HISTORY ',
            status: 'unknown',
            evidenceBasis: 'reviewed-seed',
            notes: null
          }
        ]
      }).success
    ).toBe(false)
  })

  it('retains an optional canonical source locator for attribution', () => {
    const complaint = complaintSchema.parse({
      id: 'c-locator',
      sourceId: 'source:public-api',
      sourceRecordId: 'record-1',
      canonicalLocator: 'https://example.com/records/1',
      capturedAt: now,
      publishedAt: null,
      query: 'query',
      product: 'Example product',
      company: 'Example company',
      feature: 'Example feature',
      category: 'workflow gap',
      text: 'A redacted public observation',
      language: 'en',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    })
    expect(complaint.canonicalLocator).toBe('https://example.com/records/1')
    expect(complaintSchema.safeParse({ ...complaint, canonicalLocator: 'not-a-url' }).success).toBe(
      false
    )
    expect(
      complaintSchema.safeParse({ ...complaint, canonicalLocator: 'javascript:alert(1)' }).success
    ).toBe(false)
  })

  it('rejects opportunity scores above 100', () => {
    const result = opportunitySchema.safeParse({
      id: 'o1',
      slug: 'example',
      name: 'Example',
      oneLine: 'Example',
      thesis: 'Example',
      audience: 'Example',
      firstWedge: 'Example',
      complaintCount: 1,
      synthetic: true,
      tags: [],
      complaintIds: [],
      competitors: [],
      scoreSnapshot: {
        score: 101,
        version: 'v1',
        calculatedAt: now,
        factors: {
          complaintVolume: 50,
          painSeverity: 50,
          recurrence: 50,
          willingnessToPay: 50,
          competitiveGap: 50,
          buildFeasibility: 50,
          evidenceQuality: 50,
          contraryEvidencePenalty: 50
        },
        weights: {
          complaintVolume: 20,
          painSeverity: 20,
          recurrence: 15,
          willingnessToPay: 10,
          competitiveGap: 15,
          buildFeasibility: 10,
          evidenceQuality: 10,
          contraryEvidencePenalty: 10
        }
      },
      contraryEvidence: [],
      planFiles: []
    })
    expect(result.success).toBe(false)
  })

  it('accepts a complete fixture persistence boundary', () => {
    expect(fixturePersistenceInputSchema.safeParse(validFixturePersistenceInput).success).toBe(true)
  })

  it('validates private plan approval and export contracts', () => {
    expect(workspacePlanApprovalInputSchema.safeParse({ action: 'reviewed' }).success).toBe(true)
    expect(workspacePlanApprovalInputSchema.safeParse({ action: 'approved' }).success).toBe(true)
    expect(workspacePlanApprovalInputSchema.safeParse({ action: 'unreviewed' }).success).toBe(false)
    const plan = workspacePlanReadModelSchema.parse({
      id: 'plan:one',
      version: 'production-plan-v1',
      files: [{ path: 'README.md', content: 'Plan' }],
      generatedAt: now,
      readinessState: 'ready',
      approvalState: 'approved',
      synthetic: false
    })
    expect(
      workspacePlanExportReadModelSchema.safeParse({ plan, manifestHash: 'a'.repeat(64) }).success
    ).toBe(true)
  })

  it('keeps production output governance states explicit and bounded', () => {
    expect(
      productionAnalysisGovernanceSchema.safeParse({
        reportApprovalState: 'approved',
        planApprovalState: 'reviewed'
      }).success
    ).toBe(true)
    expect(
      productionAnalysisGovernanceSchema.safeParse({
        reportApprovalState: 'unreviewed',
        planApprovalState: 'approved'
      }).success
    ).toBe(false)
    expect(
      productionAnalysisGovernanceSchema.safeParse({
        reportApprovalState: 'approved',
        planApprovalState: 'reviewed',
        sourceText: 'untrusted'
      }).success
    ).toBe(false)
  })

  it('rejects a persisted fixture plan for a different opportunity', () => {
    const mismatched = structuredClone(validFixturePersistenceInput)
    mismatched.planPackage.opportunitySlug = 'another-opportunity'
    const result = fixturePersistenceInputSchema.safeParse(mismatched)

    expect(result.success).toBe(false)
  })

  it.each([
    [
      'API policy',
      (input: typeof validFixturePersistenceInput) =>
        (input.artifact.sourcePolicies[0]!.sourceType = 'api')
    ],
    [
      'unknown commercial use',
      (input: typeof validFixturePersistenceInput) =>
        (input.artifact.sourcePolicies[0]!.commercialUse = 'unknown')
    ],
    [
      'non-synthetic complaint',
      (input: typeof validFixturePersistenceInput) =>
        (input.artifact.complaints[0]!.synthetic = false)
    ],
    [
      'non-synthetic opportunity',
      (input: typeof validFixturePersistenceInput) => (input.artifact.opportunity.synthetic = false)
    ]
  ])('rejects %s at the fixture persistence boundary', (_label, mutate) => {
    const invalid = structuredClone(validFixturePersistenceInput)
    mutate(invalid)
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects plan package path traversal', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.planPackage.files[0]!.path = '../outside.md'
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it.each(['C:/outside.md', '/outside.md', 'folder\\outside.md', 'folder//outside.md'])(
    'rejects unsafe plan package path %s',
    (path) => {
      const invalid = structuredClone(validFixturePersistenceInput)
      invalid.artifact.opportunity.planFiles = [path]
      invalid.planPackage.files[0]!.path = path
      expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
    }
  )

  it('rejects plan paths that collide on case-insensitive filesystems', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.opportunity.planFiles = ['README.md', 'readme.md']
    invalid.planPackage.files = [
      { path: 'README.md', content: '# One' },
      { path: 'readme.md', content: '# Two' }
    ]
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects unsafe nested persistence identifiers', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.complaints[0]!.id = 'Invalid complaint ID'
    invalid.artifact.clusters[0]!.complaintIds = ['Invalid complaint ID']
    invalid.artifact.opportunity.complaintIds = ['Invalid complaint ID']
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it.each([
    [
      'source record ID',
      (input: FixturePersistenceInput) =>
        (input.artifact.complaints[0]!.sourceRecordId = 'x'.repeat(241))
    ],
    [
      'complaint text',
      (input: FixturePersistenceInput) => (input.artifact.complaints[0]!.text = 'x'.repeat(20_001))
    ],
    [
      'language tag',
      (input: FixturePersistenceInput) => (input.artifact.complaints[0]!.language = 'x'.repeat(17))
    ]
  ])('rejects an oversized %s', (_label, mutate) => {
    const invalid = structuredClone(validFixturePersistenceInput)
    mutate(invalid)
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects opportunity complaint references that differ from cluster membership', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.opportunity.complaintIds = ['complaint-missing']
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects persisted scores with more than one decimal place', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.opportunity.scoreSnapshot.score = 50.05
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects non-fixture purposes at the fixture boundary', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.sourcePolicies[0]!.permittedPurposes.push('commercial-research')
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects complaints without a matching source policy', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.artifact.complaints[0]!.sourceId = 'fixture-source-missing'
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects phantom and orphan complaint relationships', () => {
    const phantom = structuredClone(validFixturePersistenceInput)
    phantom.artifact.clusters[0]!.complaintIds = ['complaint-missing']
    phantom.artifact.opportunity.complaintIds = ['complaint-missing']
    expect(fixturePersistenceInputSchema.safeParse(phantom).success).toBe(false)

    const orphan = structuredClone(validFixturePersistenceInput)
    orphan.artifact.complaints.push({
      ...structuredClone(orphan.artifact.complaints[0]!),
      id: 'complaint-orphan',
      sourceRecordId: 'fixture-record-orphan'
    })
    expect(fixturePersistenceInputSchema.safeParse(orphan).success).toBe(false)
  })

  it.each([
    [
      'complaint text',
      (input: FixturePersistenceInput) => (input.artifact.complaints[0]!.text = 'bad\0text')
    ],
    [
      'plan content',
      (input: FixturePersistenceInput) => (input.planPackage.files[0]!.content = 'bad\0content')
    ]
  ])('rejects PostgreSQL-incompatible %s', (_label, mutate) => {
    const invalid = structuredClone(validFixturePersistenceInput)
    mutate(invalid)
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it.each(['CON', 'aux.txt', 'folder/trailing.', 'folder/trailing '])(
    'rejects non-portable plan path %s',
    (path) => {
      const invalid = structuredClone(validFixturePersistenceInput)
      invalid.artifact.opportunity.planFiles = [path]
      invalid.planPackage.files[0]!.path = path
      expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
    }
  )

  it('rejects Unicode-normalization path collisions', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    const composed = 'caf\u00e9.md'
    const decomposed = 'cafe\u0301.md'
    invalid.artifact.opportunity.planFiles = [composed, decomposed]
    invalid.planPackage.files = [
      { path: composed, content: 'one' },
      { path: decomposed, content: 'two' }
    ]
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts nested paths and names beginning with two dots', () => {
    const valid = structuredClone(validFixturePersistenceInput)
    valid.artifact.opportunity.planFiles = ['docs/guide.md', '..notes.md']
    valid.planPackage.files = [
      { path: 'docs/guide.md', content: '# Guide' },
      { path: '..notes.md', content: '# Notes' }
    ]
    expect(fixturePersistenceInputSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects oversized inline plan files', () => {
    const invalid = structuredClone(validFixturePersistenceInput)
    invalid.planPackage.files[0]!.content = 'x'.repeat(262_145)
    expect(fixturePersistenceInputSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts a bounded fixture workflow start request', () => {
    expect(
      fixtureResearchWorkflowStartRequestSchema.safeParse({
        workspaceId: 'workspace-fixture',
        campaignId: 'campaign-fixture',
        runId: 'run-fixture',
        idempotencyKey: 'fixture-workflow-key',
        workflowVersion: 'fixture-research-v1',
        fixtureAt: now,
        budget: {
          currency: 'USD',
          maxSourceItems: 10,
          maxCostMicros: 1_000_000,
          maxActivityAttempts: 3
        }
      }).success
    ).toBe(true)
  })

  it('validates campaign configuration and keeps source readiness visible', () => {
    const configuration = {
      schemaVersion: 'campaign-v1' as const,
      goal: 'Find recurring billing workflow problems.',
      query: 'billing workflow',
      seeds: ['billing', 'invoice failures'],
      sourceIds: ['source:cfpb'],
      languages: ['en'],
      geographies: [],
      dateRange: { from: null, to: null },
      exclusions: ['employment disputes'],
      maxEvidenceCount: 100,
      refreshPolicy: 'weekly' as const,
      sensitiveTopicPolicy: 'review' as const,
      requestedDisplayMode: 'excerpt' as const
    }
    expect(researchCampaignConfigurationSchema.safeParse(configuration).success).toBe(true)
    expect(
      researchCampaignConfigurationSchema.safeParse({
        ...configuration,
        sourceIds: ['source:cfpb', 'source:cfpb']
      }).success
    ).toBe(false)
    expect(
      researchCampaignConfigurationSchema.safeParse({
        ...configuration,
        dateRange: { from: '2026-08-02T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }
      }).success
    ).toBe(false)

    const input = researchCampaignCreateInputSchema.parse({
      campaignId: 'campaign:billing',
      name: 'Billing workflow research',
      purpose: 'opportunity-research',
      configuration,
      budget: {
        currency: 'USD',
        maxSourceItems: 100,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      }
    })
    expect(
      researchCampaignUpdateInputSchema.parse({
        name: 'Billing workflow research v2',
        purpose: input.purpose,
        configuration: input.configuration,
        budget: input.budget
      })
    ).toMatchObject({ name: 'Billing workflow research v2' })
    expect(
      researchCampaignUpdateInputSchema.safeParse({
        campaignId: input.campaignId,
        name: input.name,
        purpose: input.purpose,
        configuration: input.configuration,
        budget: input.budget
      }).success
    ).toBe(false)
    expect(
      researchCampaignReadModelSchema.parse({
        workspaceId: 'workspace:one',
        campaignId: input.campaignId,
        name: input.name,
        purpose: input.purpose,
        state: 'draft',
        configuration: input.configuration,
        budget: input.budget,
        synthetic: false,
        sources: [
          {
            sourceId: 'source:cfpb',
            displayName: 'CFPB',
            sourceType: 'api',
            lifecycleState: 'active',
            policyVersion: 'cfpb-v1',
            policyState: 'pending_review',
            permittedPurposes: ['opportunity-research'],
            displayMode: 'excerpt',
            enabled: false,
            synthetic: false,
            coverageNotes: ['Pending review'],
            reviewedAt: null,
            expiresAt: null
          }
        ],
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({ state: 'draft', sources: [{ enabled: false }] })
    expect(
      researchCampaignRefreshScheduleReadModelSchema.parse({
        state: 'scheduled',
        refreshPolicy: 'weekly',
        nextDueAt: now,
        lastRunId: null,
        lastWorkflowId: null,
        lastStartedAt: null,
        failureCode: null,
        failureSummary: null
      })
    ).toMatchObject({ state: 'scheduled', refreshPolicy: 'weekly' })
    expect(
      researchCampaignRefreshScheduleReadModelSchema.safeParse({
        state: 'scheduled',
        refreshPolicy: 'manual',
        nextDueAt: now,
        lastRunId: null,
        lastWorkflowId: null,
        lastStartedAt: null,
        failureCode: 'APPSEA_REFRESH_NOT_A_REAL_CODE',
        failureSummary: null
      }).success
    ).toBe(false)
    expect(
      researchCampaignRunInputSchema.safeParse({
        runId: 'run:billing',
        idempotencyKey: 'campaign-run-idempotency-key',
        requestedAt: now
      }).success
    ).toBe(true)
    expect(
      researchCampaignRunInputSchema.safeParse({
        runId: 'run:billing',
        idempotencyKey: 'too-short',
        requestedAt: now
      }).success
    ).toBe(false)
    expect(
      researchCampaignRunReadModelSchema.parse({
        campaignId: 'campaign:billing',
        workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        runId: 'run:billing',
        sourceId: 'source:cfpb',
        policyVersion: 'cfpb-v1',
        state: 'running',
        checkpoint: 'initialized',
        activityAttempts: 1,
        consumedSourceItems: 0,
        consumedCostMicros: 0,
        analysisSeedReviewId: null,
        recollectionTombstoneId: null,
        requestedAt: now,
        startedAt: now,
        updatedAt: now,
        finishedAt: null
      }).state
    ).toBe('running')
  })

  it('accepts an explicit approved-seed reference for automatic analysis handoff', () => {
    const parsed = productionCollectionWorkflowStartRequestSchema.safeParse({
      workspaceId: 'workspace-production',
      campaignId: 'campaign-production',
      runId: 'run-production',
      idempotencyKey: 'production-workflow-key',
      workflowVersion: 'production-collection-v1',
      sourceId: 'source-cfpb',
      policyVersion: 'cfpb-v1',
      query: 'billing',
      limit: 10,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt',
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      requestedAt: now,
      analysisSeedReviewId: 'seed-review:billing'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.analysisSeedReviewId).toBe('seed-review:billing')
  })

  it('keeps production workflow admission decisions bounded and identifier-only', () => {
    expect(
      productionWorkflowAdmissionDecisionSchema.safeParse({
        decision: 'admitted',
        retryAfterSeconds: 0,
        reservationExpiresAt: now
      }).success
    ).toBe(true)
    expect(
      productionWorkflowAdmissionDecisionSchema.safeParse({
        decision: 'rate_limited',
        retryAfterSeconds: 86_401,
        reservationExpiresAt: now,
        idempotencyKey: 'must-not-cross-the-admission-boundary'
      }).success
    ).toBe(false)
  })

  it('keeps source collection lease decisions bounded and timestamped', () => {
    expect(
      sourceCollectionLeaseResultSchema.safeParse({
        decision: 'acquired',
        observedAt: now,
        expiresAt: '2026-07-10T00:30:00.000Z'
      }).success
    ).toBe(true)
    expect(
      sourceCollectionLeaseResultSchema.safeParse({
        decision: 'replayed',
        observedAt: now,
        expiresAt: '2026-07-10T00:30:00.000Z',
        inputHash: 'raw-source-text-must-not-cross-the-lease-boundary'
      }).success
    ).toBe(false)
  })

  it('keeps the private analysis handoff status identifier-only and bounded', () => {
    const parsed = productionAnalysisHandoffReadModelSchema.safeParse({
      handoffId: 'handoff:analysis:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      collectionWorkflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      collectionRunId: 'run:production:one',
      seedReviewId: 'seed-review:billing',
      analysisRunId: 'analysis-run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'dispatching',
      attemptCount: 1,
      workflowId: null,
      failureCode: null,
      failureSummary: null,
      requestedAt: now,
      nextAttemptAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now
    })
    expect(parsed.success).toBe(true)
    expect(
      productionAnalysisHandoffReadModelSchema.safeParse({
        ...(parsed.success ? parsed.data : {}),
        idempotencyKey: 'raw-key-must-not-cross-the-status-boundary'
      }).success
    ).toBe(false)
  })

  it('keeps asynchronous analysis status free of workflow hashes and object references', () => {
    const status = productionAnalysisStatusReadModelSchema.parse({
      analysisRunId: 'analysis:one',
      collectionRunId: 'run:one',
      state: 'completed',
      checkpoint: 'completed',
      activityAttempts: 1,
      availabilityState: 'active',
      opportunityId: 'opportunity:one',
      opportunitySlug: 'reviewed-opportunity',
      failureCode: null,
      failureSummary: null,
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      activityAttemptHistory: [
        {
          activityAttempt: 1,
          state: 'completed',
          startedAt: now,
          lastHeartbeatAt: now,
          heartbeatCount: 2,
          finishedAt: now,
          durationMs: 120,
          failureCode: null
        }
      ]
    })
    expect(status.opportunitySlug).toBe('reviewed-opportunity')
    expect(
      productionAnalysisStatusReadModelSchema.safeParse({
        ...status,
        inputHash: 'a'.repeat(64),
        artifactObjectRef: { uri: 'appsea-object://private/workflow-artifact/hash' }
      }).success
    ).toBe(false)
    expect(
      productionAnalysisStatusReadModelSchema.safeParse({
        ...status,
        activityAttemptHistory: Array.from({ length: 11 }, (_, index) => ({
          activityAttempt: index + 1,
          state: 'started',
          startedAt: now,
          lastHeartbeatAt: now,
          heartbeatCount: 1,
          finishedAt: null,
          durationMs: null,
          failureCode: null
        }))
      }).success
    ).toBe(false)
  })

  it('keeps analysis activity attempts bounded and outside the idempotency payload', () => {
    const result = productionAnalysisWorkflowPersistenceActivityResultSchema.safeParse({
      persistence: {
        workspaceId: 'workspace:one',
        collectionRunId: 'run:one',
        analysisRunId: 'analysis:one',
        artifactId: 'artifact:one',
        inputHash: 'a'.repeat(64),
        opportunityId: 'opportunity:one',
        scoreSnapshotId: 'score:one',
        reportId: 'report:one',
        planPackageId: 'plan:one',
        artifactObjectRef: {
          version: 1,
          uri: 'appsea-object://workspace:one/workflow-artifact/' + 'b'.repeat(64),
          workspaceId: 'workspace:one',
          kind: 'workflow-artifact',
          contentHash: 'b'.repeat(64),
          byteLength: 1,
          contentType: 'application/json',
          createdAt: now,
          retentionUntil: now,
          deletionState: 'active',
          deletedAt: null,
          deletionReason: null
        },
        reportObjectRef: {
          version: 1,
          uri: 'appsea-object://workspace:one/report-json/' + 'c'.repeat(64),
          workspaceId: 'workspace:one',
          kind: 'report-json',
          contentHash: 'c'.repeat(64),
          byteLength: 1,
          contentType: 'application/json',
          createdAt: now,
          retentionUntil: now,
          deletionState: 'active',
          deletedAt: null,
          deletionReason: null
        },
        planObjectRef: {
          version: 1,
          uri: 'appsea-object://workspace:one/plan-package/' + 'd'.repeat(64),
          workspaceId: 'workspace:one',
          kind: 'plan-package',
          contentHash: 'd'.repeat(64),
          byteLength: 1,
          contentType: 'application/json',
          createdAt: now,
          retentionUntil: now,
          deletionState: 'active',
          deletedAt: null,
          deletionReason: null
        },
        state: 'completed',
        availabilityState: 'active',
        completedAt: now,
        replayed: false
      },
      activityAttempt: 3
    })
    expect(result.success).toBe(true)
    expect(
      productionAnalysisWorkflowPersistenceActivityResultSchema.safeParse({
        ...(result.success ? result.data : {}),
        activityAttempt: 11
      }).success
    ).toBe(false)
  })

  it('accepts a non-synthetic production collection snapshot', () => {
    const policy = sourcePolicySchema.parse({
      sourceId: 'cfpb-consumer-complaints',
      displayName: 'CFPB Consumer Complaint Database',
      sourceType: 'api',
      enabled: true,
      policyState: 'approved',
      permittedPurposes: ['opportunity-research'],
      commercialUse: 'allowed',
      accessMethod: 'Official API',
      retentionDays: 30,
      deletionRequired: true,
      attributionRequired: true,
      displayMode: 'excerpt',
      coverageNotes: ['Test policy'],
      reviewedAt: now,
      policyDocumentRef: 'https://example.com/policy'
    })
    const result = productionCollectionPersistenceInputSchema.safeParse({
      request: {
        workspaceId: 'workspace-production',
        campaignId: 'campaign-production',
        runId: 'run-production',
        idempotencyKey: 'production-collection-key',
        sourceId: policy.sourceId,
        policyVersion: 'cfpb-v1',
        query: 'credit card',
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
      observedAt: now,
      policy,
      complaints: [
        {
          id: 'source-complaint-1',
          sourceId: policy.sourceId,
          sourceRecordId: '1001',
          capturedAt: now,
          publishedAt: now,
          query: 'credit card',
          product: 'Credit card',
          company: 'Company',
          feature: 'Dispute',
          category: 'Billing',
          text: 'A permitted excerpt',
          language: 'en',
          synthetic: false,
          redacted: true,
          allowedRepresentation: 'excerpt'
        }
      ],
      deletions: [],
      warnings: []
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.costMicros).toBe(0)
    expect(
      productionCollectionPersistenceInputSchema.safeParse({
        ...(result.success ? result.data : {}),
        costMicros: 1_000_000_000_001
      }).success
    ).toBe(false)
    expect(
      productionCollectionPersistenceInputSchema.safeParse({
        ...(result.success ? result.data : {}),
        observedAt: undefined
      }).success
    ).toBe(false)
    expect(
      productionCollectionResultSchema.safeParse({
        workspaceId: 'workspace-production',
        campaignId: 'campaign-production',
        runId: 'run-production',
        artifactId: 'production-collection:abc123',
        sourceId: policy.sourceId,
        policyVersion: 'cfpb-v1',
        sourceItemCount: 1,
        evidenceCount: 1,
        complaintCount: 1,
        deletionCount: 0,
        coverageGaps: ['not a sample'],
        warnings: [],
        state: 'completed',
        completedAt: now,
        replayed: false
      }).success
    ).toBe(true)
  })

  it('bounds explicit tombstone re-collection to one source record', () => {
    const request = {
      workspaceId: 'workspace-production',
      campaignId: 'campaign-production',
      runId: 'run-production-recollect',
      idempotencyKey: 'production-recollection-key',
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-v1',
      query: 'credit card',
      limit: 1,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt' as const,
      budget: {
        currency: 'USD' as const,
        maxSourceItems: 1,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      requestedAt: now,
      recollectionTombstoneId: 'tombstone:source:record'
    }
    expect(productionCollectionRequestSchema.safeParse(request).success).toBe(true)
    expect(productionCollectionRequestSchema.safeParse({ ...request, limit: 2 }).success).toBe(
      false
    )
    const result = productionCollectionResultSchema.parse({
      workspaceId: request.workspaceId,
      campaignId: request.campaignId,
      runId: request.runId,
      artifactId: 'production-collection:recollection',
      sourceId: request.sourceId,
      policyVersion: request.policyVersion,
      sourceItemCount: 1,
      evidenceCount: 1,
      complaintCount: 1,
      deletionCount: 0,
      coverageGaps: [],
      warnings: [],
      state: 'completed',
      completedAt: now,
      replayed: false
    })
    expect(result.recollectionTombstoneId).toBeNull()
  })

  it('rejects synthetic or mismatched production complaints', () => {
    const invalid = {
      request: {
        workspaceId: 'workspace-production',
        campaignId: 'campaign-production',
        runId: 'run-production',
        idempotencyKey: 'production-collection-key',
        sourceId: 'cfpb-consumer-complaints',
        policyVersion: 'cfpb-v1',
        query: '',
        limit: 10,
        purpose: 'opportunity-research',
        requestedDisplayMode: 'excerpt' as const,
        budget: {
          currency: 'USD' as const,
          maxSourceItems: 10,
          maxCostMicros: 0,
          maxActivityAttempts: 3
        },
        requestedAt: now
      },
      observedAt: now,
      policy: sourcePolicySchema.parse({
        sourceId: 'cfpb-consumer-complaints',
        displayName: 'CFPB',
        sourceType: 'api',
        enabled: true,
        policyState: 'approved',
        permittedPurposes: ['opportunity-research'],
        commercialUse: 'allowed',
        accessMethod: 'API',
        retentionDays: 30,
        deletionRequired: true,
        attributionRequired: true,
        displayMode: 'excerpt',
        coverageNotes: ['Test'],
        reviewedAt: now,
        policyDocumentRef: 'https://example.com/policy'
      }),
      complaints: [
        {
          id: 'complaint-1',
          sourceId: 'other-source',
          sourceRecordId: '1',
          capturedAt: now,
          publishedAt: now,
          query: '*',
          product: 'Product',
          company: 'Company',
          feature: 'Feature',
          category: 'Category',
          text: 'Synthetic',
          language: 'en',
          synthetic: true,
          redacted: false,
          allowedRepresentation: 'excerpt' as const
        }
      ],
      deletions: [],
      warnings: []
    }
    expect(productionCollectionPersistenceInputSchema.safeParse(invalid).success).toBe(false)

    const unredacted = structuredClone(invalid)
    unredacted.complaints[0]!.sourceId = 'cfpb-consumer-complaints'
    unredacted.complaints[0]!.synthetic = false
    unredacted.complaints[0]!.redacted = false
    expect(productionCollectionPersistenceInputSchema.safeParse(unredacted).success).toBe(false)
  })

  it('keeps raw idempotency keys outside workflow execution input', () => {
    const result = fixtureResearchWorkflowInputSchema.safeParse({
      workspaceId: 'workspace-fixture',
      campaignId: 'campaign-fixture',
      runId: 'run-fixture',
      idempotencyKey: 'must-not-enter-history',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
      workflowVersion: 'fixture-research-v1',
      fixtureAt: now,
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 1_000_000,
        maxActivityAttempts: 3
      }
    })

    expect(result.success).toBe(false)
  })

  it.each([
    { currency: 'EUR', maxSourceItems: 10, maxCostMicros: 1, maxActivityAttempts: 3 },
    { currency: 'USD', maxSourceItems: -1, maxCostMicros: 1, maxActivityAttempts: 3 },
    { currency: 'USD', maxSourceItems: 10, maxCostMicros: -1, maxActivityAttempts: 3 },
    { currency: 'USD', maxSourceItems: 10, maxCostMicros: 1, maxActivityAttempts: 11 }
  ])('rejects an unsafe workflow budget %#', (budget) => {
    expect(researchJobBudgetSchema.safeParse(budget).success).toBe(false)
  })

  it('bounds workspace cost summaries without exposing decimal ambiguity', () => {
    const summary = {
      workspaceId: 'workspace:one',
      periodStart: now,
      periodEnd: '2026-07-11T00:00:00.000Z',
      asOf: '2026-07-11T00:00:00.000Z',
      entryCount: 2,
      currencies: [
        {
          currency: 'USD',
          entryCount: 2,
          totalCostMicros: '1250000',
          estimatedCostMicros: '250000',
          actualCostMicros: '1000000',
          byCostType: [
            {
              costType: 'source_request',
              entryCount: 2,
              totalCostMicros: '1250000',
              estimatedCostMicros: '250000',
              actualCostMicros: '1000000'
            }
          ]
        }
      ]
    }
    expect(workspaceCostSummaryReadModelSchema.safeParse(summary).success).toBe(true)
    expect(
      workspaceCostSummaryQuerySchema.safeParse({
        from: now,
        to: '2026-07-11T00:00:00.000Z'
      }).success
    ).toBe(true)
    expect(
      workspaceCostSummaryQuerySchema.safeParse({
        from: '2026-07-11T00:00:00.000Z',
        to: now
      }).success
    ).toBe(false)
    expect(
      workspaceCostSummaryReadModelSchema.safeParse({
        ...summary,
        currencies: [
          {
            ...summary.currencies[0],
            totalCostMicros: '1.25'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('keeps deployment cost alerts exact and incomplete for unsupported currencies', () => {
    const observation = {
      currency: 'USD',
      entryCount: 2,
      totalCostMicros: '1250000',
      estimatedCostMicros: '250000',
      actualCostMicros: '1000000'
    }
    expect(workspaceCostAlertObservationSchema.safeParse(observation).success).toBe(true)
    const input = {
      observedAt: now,
      maxWorkspaces: 20,
      maxCurrenciesPerWorkspace: 16,
      periodSeconds: 2_592_000,
      thresholdCurrency: 'USD',
      actualThresholdMicros: '1000000',
      estimatedThresholdMicros: '500000'
    }
    expect(workspaceCostAlertInputSchema.safeParse(input).success).toBe(true)
    const clear = {
      observedAt: now,
      periodStart: '2026-06-11T00:00:00.000Z',
      periodEnd: now,
      periodSeconds: 2_592_000,
      thresholdCurrency: 'USD',
      actualThresholdMicros: '1000000',
      estimatedThresholdMicros: '500000',
      workspacesScanned: 20,
      rowsObserved: 1,
      entriesObserved: 2,
      targetCurrencyRows: 1,
      unsupportedCurrencyRows: 0,
      actualTargetCostMicros: '1000000',
      estimatedTargetCostMicros: '250000',
      workspacesOverActualThreshold: 0,
      workspacesOverEstimatedThreshold: 0,
      alerted: false,
      truncated: false,
      state: 'clear' as const
    }
    expect(workspaceCostAlertResultSchema.safeParse(clear).success).toBe(true)
    expect(
      workspaceCostAlertResultSchema.safeParse({
        ...clear,
        unsupportedCurrencyRows: 1,
        state: 'clear'
      }).success
    ).toBe(false)
    expect(
      workspaceCostAlertResultSchema.safeParse({
        ...clear,
        workspacesOverActualThreshold: 1,
        alerted: true,
        state: 'alert'
      }).success
    ).toBe(true)
  })

  it('keeps quota reconciliation cases explicit and resolution-bound', () => {
    const openCase = {
      workspaceId: 'workspace:one',
      reservationId: 'quota:source:one',
      sourceId: 'source:one',
      policyVersion: 'policy-v1',
      runId: 'run:one',
      requestedRecords: 2,
      requestedCostMicros: 15,
      actualRecords: 2,
      actualCostMicros: 15,
      state: 'open' as const,
      firstSeenAt: now,
      lastSeenAt: now,
      resolutionCode: null,
      linkedRunId: null,
      resolutionActorId: null,
      resolvedAt: null
    }
    expect(sourceQuotaReconciliationCaseSchema.safeParse(openCase).success).toBe(true)
    expect(
      sourceQuotaReconciliationCaseSchema.safeParse({
        ...openCase,
        state: 'resolved',
        resolutionCode: 'linked_result',
        linkedRunId: 'run:one',
        resolutionActorId: 'operator:alice',
        resolvedAt: '2026-07-11T00:00:00.000Z'
      }).success
    ).toBe(true)
    expect(
      sourceQuotaReconciliationResolveInputSchema.safeParse({
        workspaceId: 'workspace:one',
        reservationId: 'quota:source:one',
        resolutionCode: 'linked_result',
        linkedRunId: null,
        actorId: 'operator:alice'
      }).success
    ).toBe(false)
    expect(sourceQuotaReconciliationListQuerySchema.parse({})).toEqual({ limit: 50 })
  })

  it('bounds quota reconciliation alert inspection and coverage state', () => {
    const input = {
      observedAt: now,
      maxWorkspaces: 20,
      maxCasesPerWorkspace: 10,
      alertAfterSeconds: 900
    }
    expect(sourceQuotaReconciliationAlertInputSchema.safeParse(input).success).toBe(true)
    expect(
      sourceQuotaReconciliationAlertInputSchema.safeParse({
        ...input,
        maxCasesPerWorkspace: 0
      }).success
    ).toBe(false)

    const clear = {
      observedAt: now,
      alertAfterSeconds: 900,
      workspacesScanned: 20,
      openCases: 0,
      oldestOpenCaseAgeSeconds: null,
      alerted: false,
      truncated: false,
      state: 'clear' as const
    }
    expect(sourceQuotaReconciliationAlertResultSchema.safeParse(clear).success).toBe(true)
    expect(
      sourceQuotaReconciliationAlertResultSchema.safeParse({
        ...clear,
        truncated: true,
        state: 'clear'
      }).success
    ).toBe(false)
    expect(
      sourceQuotaReconciliationAlertResultSchema.safeParse({
        ...clear,
        openCases: 1,
        oldestOpenCaseAgeSeconds: 901,
        alerted: true,
        state: 'alert'
      }).success
    ).toBe(true)
    expect(
      sourceQuotaReconciliationAlertResultSchema.safeParse({
        ...clear,
        truncated: true,
        state: 'incomplete'
      }).success
    ).toBe(true)
  })

  it('keeps recomputation alert observations bounded and state-consistent', () => {
    const observation = {
      state: 'dispatching' as const,
      attemptCount: 2,
      requestedAt: now,
      nextAttemptAt: now,
      updatedAt: now
    }
    expect(productionAnalysisRecomputeAlertObservationSchema.safeParse(observation).success).toBe(
      true
    )
    expect(
      productionAnalysisRecomputeAlertObservationSchema.safeParse({
        ...observation,
        updatedAt: '2026-07-09T00:00:00.000Z'
      }).success
    ).toBe(false)
    expect(
      productionAnalysisRecomputeAlertInputSchema.safeParse({
        observedAt: now,
        maxWorkspaces: 20,
        maxJobsPerWorkspace: 10,
        alertAfterSeconds: 900
      }).success
    ).toBe(true)

    const clear = {
      observedAt: now,
      alertAfterSeconds: 900,
      workspacesScanned: 20,
      jobsObserved: 0,
      failedJobs: 0,
      blockedJobs: 0,
      staleJobs: 0,
      oldestOpenJobAgeSeconds: null,
      alerted: false,
      truncated: false,
      state: 'clear' as const
    }
    expect(productionAnalysisRecomputeAlertResultSchema.safeParse(clear).success).toBe(true)
    expect(
      productionAnalysisRecomputeAlertResultSchema.safeParse({
        ...clear,
        jobsObserved: 1,
        failedJobs: 1,
        oldestOpenJobAgeSeconds: 60,
        alerted: true,
        state: 'alert'
      }).success
    ).toBe(true)
    expect(
      productionAnalysisRecomputeAlertResultSchema.safeParse({
        ...clear,
        jobsObserved: 1,
        oldestOpenJobAgeSeconds: 60,
        truncated: true,
        state: 'incomplete'
      }).success
    ).toBe(true)
    expect(
      productionAnalysisRecomputeAlertResultSchema.safeParse({
        ...clear,
        jobsObserved: 1,
        failedJobs: 2,
        oldestOpenJobAgeSeconds: 60,
        alerted: true,
        state: 'alert'
      }).success
    ).toBe(false)
  })
})
