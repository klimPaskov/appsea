import type { Pool, QueryResultRow } from 'pg'
import { appseaIdentifierSchema, sourcePolicySchema, type SourcePolicy } from '@appsea/contracts'
import { contentHash } from './hash'
import { withDatabaseTransaction } from './transaction'

interface SourcePolicyRow extends QueryResultRow {
  source_id: string
  display_name: string
  source_type: SourcePolicy['sourceType']
  lifecycle_state: string
  current_policy_version: string | null
  policy_version: string | null
  policy_state: SourcePolicy['policyState'] | null
  permitted_purposes: string[] | null
  commercial_use: SourcePolicy['commercialUse'] | null
  access_method: string | null
  retention_days: number | null
  deletion_required: boolean | null
  attribution_required: boolean | null
  display_mode: SourcePolicy['displayMode'] | null
  coverage_notes: string[] | null
  policy_document_ref: string | null
  reviewed_at: Date | string | null
  expires_at: Date | string | null
  policy_payload: unknown | null
  content_hash: string | null
}

export interface SourcePolicyRecord {
  sourceId: string
  displayName: string
  sourceType: SourcePolicy['sourceType']
  lifecycleState: string
  currentPolicyVersion: string | null
  policyVersion: string | null
  policy: SourcePolicy | null
  contentHash: string | null
}

export interface SourcePolicyDraftInput {
  policy: SourcePolicy
  policyVersion: string
  recordedAt: string
}

export interface SourcePolicyApprovalInput {
  sourceId: string
  policyVersion: string
  reviewId: string
  reviewer: string
  approvalReference: string
  notes: string[]
  contentHash: string
  reviewedAt: string
  expiresAt: string | null
  recordedAt: string
}

function policyVersion(value: string): string {
  if (value.length < 1 || value.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new Error('policyVersion is not persistence-safe')
  }
  return value
}

function iso(value: Date | string | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
}

function mapRecord(row: SourcePolicyRow): SourcePolicyRecord {
  let policy: SourcePolicy | null = null
  if (row.policy_payload !== null) {
    const parsed = sourcePolicySchema.safeParse(row.policy_payload)
    if (!parsed.success) throw new Error(`Stored policy ${row.source_id} is malformed`)
    if (row.content_hash !== null && contentHash(parsed.data) !== row.content_hash) {
      throw new Error(`Stored policy ${row.source_id} failed its immutable content hash check`)
    }
    policy = parsed.data
  }
  return {
    sourceId: row.source_id,
    displayName: row.display_name,
    sourceType: row.source_type,
    lifecycleState: row.lifecycle_state,
    currentPolicyVersion: row.current_policy_version,
    policyVersion: row.policy_version,
    policy,
    contentHash: row.content_hash
  }
}

export class PostgresSourcePolicyRepository {
  constructor(private readonly pool: Pool) {}

  /** Read a policy snapshot without granting runtime code any write capability. */
  async read(
    sourceId: string,
    requestedPolicyVersion?: string
  ): Promise<SourcePolicyRecord | null> {
    const validatedSourceId = appseaIdentifierSchema.parse(sourceId)
    const requestedVersion = requestedPolicyVersion ? policyVersion(requestedPolicyVersion) : null
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SourcePolicyRow>(
          `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, source.current_policy_version,
                  policy.policy_version, policy.policy_state,
                  policy.permitted_purposes, policy.commercial_use,
                  policy.access_method, policy.retention_days,
                  policy.deletion_required, policy.attribution_required,
                  policy.display_mode, policy.coverage_notes,
                  policy.policy_document_ref, policy.reviewed_at,
                  policy.expires_at, policy.policy_payload, policy.content_hash
             FROM appsea.sources source
             LEFT JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = COALESCE($2, source.current_policy_version)
            WHERE source.source_id = $1`,
          [validatedSourceId, requestedVersion]
        )
        const row = result.rows[0]
        return row ? mapRecord(row) : null
      },
      { readOnly: true }
    )
  }

  /**
   * Return the effective runtime snapshot only when the database approval gate
   * is active and the policy has not expired. The stored draft payload remains
   * immutable; mutable approval state is taken from the registry columns.
   */
  async readCollectible(
    sourceId: string,
    policyVersionValue?: string
  ): Promise<{
    policy: SourcePolicy
    policyVersion: string
    contentHash: string
  } | null> {
    const validatedSourceId = appseaIdentifierSchema.parse(sourceId)
    const requestedVersion = policyVersionValue ? policyVersion(policyVersionValue) : null
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SourcePolicyRow>(
          `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, source.current_policy_version,
                  policy.policy_version, policy.policy_state,
                  policy.permitted_purposes, policy.commercial_use,
                  policy.access_method, policy.retention_days,
                  policy.deletion_required, policy.attribution_required,
                  policy.display_mode, policy.coverage_notes,
                  policy.policy_document_ref, policy.reviewed_at,
                  policy.expires_at, policy.policy_payload, policy.content_hash
             FROM appsea.sources source
             JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = COALESCE($2, source.current_policy_version)
            WHERE source.source_id = $1
              AND source.source_type <> 'fixture'
              AND source.lifecycle_state = 'active'
              AND source.current_policy_version = policy.policy_version
              AND policy.policy_state = 'approved'
              AND policy.reviewed_at IS NOT NULL
              AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())`,
          [validatedSourceId, requestedVersion]
        )
        const row = result.rows[0]
        if (!row) return null
        const record = mapRecord(row)
        if (!record.policy || !record.policyVersion || !record.contentHash) return null
        const effective = sourcePolicySchema.parse({
          ...record.policy,
          displayName: record.displayName,
          enabled: true,
          policyState: 'approved',
          reviewedAt: iso(row.reviewed_at),
          expiresAt: iso(row.expires_at),
          policyDocumentRef: row.policy_document_ref ?? record.policy.policyDocumentRef
        })
        return {
          policy: effective,
          policyVersion: record.policyVersion,
          contentHash: record.contentHash
        }
      },
      { readOnly: true }
    )
  }

  /** Operator-only operation; the database function rejects runtime service roles. */
  async registerDraft(input: SourcePolicyDraftInput): Promise<void> {
    const policy = sourcePolicySchema.parse(input.policy)
    if (
      policy.sourceType === 'fixture' ||
      policy.enabled ||
      policy.policyState !== 'pending_review'
    ) {
      throw new Error('Only disabled non-fixture policy drafts may be registered')
    }
    const version = policyVersion(input.policyVersion)
    const hash = contentHash(policy)
    await withDatabaseTransaction(this.pool, async (client) => {
      await client.query(
        `SELECT appsea.register_source_policy_draft(
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14::timestamptz, $15::jsonb, $16, $17::timestamptz
         )`,
        [
          policy.sourceId,
          policy.displayName,
          policy.sourceType,
          version,
          policy.permittedPurposes,
          policy.commercialUse,
          policy.accessMethod,
          policy.retentionDays,
          policy.deletionRequired,
          policy.attributionRequired,
          policy.displayMode,
          policy.coverageNotes,
          policy.policyDocumentRef,
          policy.expiresAt,
          JSON.stringify(policy),
          hash,
          input.recordedAt
        ]
      )
    })
  }

  /** Operator-only operation; creates immutable approval evidence and activates exactly one version. */
  async approve(input: SourcePolicyApprovalInput): Promise<void> {
    const sourceId = appseaIdentifierSchema.parse(input.sourceId)
    const version = policyVersion(input.policyVersion)
    await withDatabaseTransaction(this.pool, async (client) => {
      await client.query(
        `SELECT appsea.approve_source_policy(
           $1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
           $9::timestamptz, $10::timestamptz
         )`,
        [
          sourceId,
          version,
          input.reviewId,
          input.reviewer,
          input.approvalReference,
          input.notes,
          input.contentHash,
          input.reviewedAt,
          input.expiresAt,
          input.recordedAt
        ]
      )
    })
  }
}
