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
  complaintSchema,
  fixturePersistenceInputSchema,
  fixtureResearchWorkflowInputSchema,
  fixtureResearchWorkflowStartRequestSchema,
  opportunitySchema,
  productionAnalysisHandoffReadModelSchema,
  productionCollectionPersistenceInputSchema,
  productionCollectionResultSchema,
  productionCollectionWorkflowStartRequestSchema,
  researchJobBudgetSchema,
  sourcePolicySchema,
  sourceMaintenanceInputSchema,
  sourceMaintenanceResultSchema,
  workspaceOpportunityReadModelSchema,
  workspaceOpportunityDetailReadModelSchema,
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
  it('rejects a source without a reviewed policy', () => {
    const result = sourcePolicySchema.safeParse({ sourceId: 'missing-fields' })
    expect(result.success).toBe(false)
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
    const sourceInput = {
      jobId: 'maintenance:source:123',
      occurredAt: now,
      quotaBatchSize: 100,
      deletionBatchSize: 25,
      retentionBatchSize: 25,
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
        retentionTombstonesQueued: 5,
        deletionTombstonesProcessed: 6,
        deletionObjectsAffected: 7
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
        retentionTombstonesQueued: 5,
        deletionTombstonesProcessed: 5,
        deletionObjectsAffected: 10_000_001
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
      coverageGaps: ['No live source is enabled.'],
      sourceCoverage: [],
      report: null,
      plan: null
    })
    expect(result.success).toBe(true)
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
})
