import type { Pool, PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { contentHash } from './hash'
import { PostgresSourcePolicyRepository } from './source-policy-repository'

const now = '2026-07-25T00:00:00.000Z'
const draft = {
  sourceId: 'cfpb-consumer-complaints',
  displayName: 'CFPB Consumer Complaint Database',
  sourceType: 'api' as const,
  enabled: false,
  policyState: 'pending_review' as const,
  permittedPurposes: ['opportunity-research'],
  commercialUse: 'allowed' as const,
  accessMethod: 'Official API',
  retentionDays: 30,
  deletionRequired: true,
  attributionRequired: true,
  displayMode: 'excerpt' as const,
  coverageNotes: ['Engineering draft'],
  reviewedAt: now,
  policyOwner: 'review queue',
  policyDocumentRef: 'https://example.com/policy',
  expiresAt: '2026-10-25T00:00:00.000Z',
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
    retentionAction: 'redact' as const
  }
}

class FakeClient {
  readonly statements: Array<{ text: string; values: unknown[] }> = []

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.statements.push({ text, values })
    if (text.includes('FROM appsea.sources source')) {
      return {
        rows: [
          {
            source_id: draft.sourceId,
            display_name: draft.displayName,
            source_type: draft.sourceType,
            lifecycle_state: 'active',
            current_policy_version: 'cfpb-v1',
            policy_version: 'cfpb-v1',
            policy_state: 'approved',
            permitted_purposes: draft.permittedPurposes,
            commercial_use: draft.commercialUse,
            access_method: draft.accessMethod,
            retention_days: draft.retentionDays,
            deletion_required: draft.deletionRequired,
            attribution_required: draft.attributionRequired,
            display_mode: draft.displayMode,
            coverage_notes: draft.coverageNotes,
            policy_document_ref: draft.policyDocumentRef,
            reviewed_at: now,
            expires_at: draft.expiresAt,
            policy_payload: draft,
            content_hash: contentHash(draft)
          }
        ]
      } as unknown as { rows: T[] }
    }
    return {
      rows: [
        {
          policy_state: 'approved',
          reviewed_at: now,
          expires_at: draft.expiresAt,
          policy_document_ref: draft.policyDocumentRef
        }
      ]
    } as unknown as { rows: T[] }
  }

  release(): void {}
}

function fakePool(client: FakeClient): Pool {
  return { connect: async () => client as unknown as PoolClient } as unknown as Pool
}

describe('source policy repository', () => {
  it('returns an effective approved policy while retaining the immutable draft hash', async () => {
    const client = new FakeClient()
    const repository = new PostgresSourcePolicyRepository(fakePool(client))
    const result = await repository.readCollectible(draft.sourceId, 'cfpb-v1')
    expect(result?.policy.enabled).toBe(true)
    expect(result?.policy.policyState).toBe('approved')
    expect(result?.policy.displayName).toBe(draft.displayName)
    expect(result?.reviewedPolicy).toEqual(draft)
    expect(result?.policyVersion).toBe('cfpb-v1')
    expect(result?.contentHash).toBe(contentHash(draft))
  })

  it('keeps policy draft registration operator-only at the application boundary', async () => {
    const repository = new PostgresSourcePolicyRepository(fakePool(new FakeClient()))
    await expect(
      repository.registerDraft({
        policy: { ...draft, enabled: true, policyState: 'approved' },
        policyVersion: 'cfpb-v1',
        recordedAt: now
      })
    ).rejects.toThrow(/disabled non-fixture policy drafts/)
  })

  it('binds approvals to an independent canonical reviewer identity', async () => {
    const client = new FakeClient()
    const repository = new PostgresSourcePolicyRepository(fakePool(client))
    await repository.approve({
      sourceId: draft.sourceId,
      policyVersion: 'cfpb-v1',
      reviewId: 'review:cfpb:v1',
      reviewer: 'Privacy review queue',
      reviewerIdentity: 'privacy-reviewer@example.invalid',
      reviewerRole: 'privacy',
      independenceAttested: true,
      approvalReference: 'ticket:cfpb:v1',
      notes: ['Reviewed intended use.'],
      contentHash: contentHash(draft),
      reviewedAt: now,
      expiresAt: draft.expiresAt,
      recordedAt: now
    })
    const statement = client.statements.find((entry) =>
      entry.text.includes('appsea.approve_source_policy')
    )
    expect(statement?.values).toContain('privacy-reviewer@example.invalid')
    expect(statement?.values).toContain('privacy')
    expect(statement?.values).toContain(true)
    await expect(
      repository.approve({
        sourceId: draft.sourceId,
        policyVersion: 'cfpb-v1',
        reviewId: 'review:cfpb:v2',
        reviewer: 'Policy owner',
        reviewerIdentity: 'Review Queue',
        reviewerRole: 'privacy',
        independenceAttested: true,
        approvalReference: 'ticket:cfpb:v2',
        notes: [],
        contentHash: contentHash(draft),
        reviewedAt: now,
        expiresAt: draft.expiresAt,
        recordedAt: now
      })
    ).rejects.toThrow(/lowercase/)
  })
})
