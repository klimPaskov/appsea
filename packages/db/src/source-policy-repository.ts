import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourcePolicyApprovalInputSchema,
  sourcePolicySchema,
  workspaceSourceReadModelSchema,
  type SourcePolicy,
  type SourcePolicyApprovalInput as SourcePolicyApprovalInputContract
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction, withDatabaseTransaction } from './transaction'

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

interface SourcePolicyRegistryRow extends SourcePolicyRow {
  enabled: boolean
  collectible: boolean
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

export type SourcePolicyApprovalInput = SourcePolicyApprovalInputContract

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

function mapWorkspaceSource(row: SourcePolicyRegistryRow) {
  const record = mapRecord(row)
  const policy = record.policy
  if (
    policy &&
    (policy.sourceId !== row.source_id ||
      policy.displayName !== row.display_name ||
      policy.sourceType !== row.source_type)
  ) {
    throw new Error(`Stored policy ${row.source_id} failed its source identity check`)
  }
  return workspaceSourceReadModelSchema.parse({
    sourceId: record.sourceId,
    displayName: record.displayName,
    sourceType: record.sourceType,
    lifecycleState: record.lifecycleState,
    currentPolicyVersion: record.currentPolicyVersion,
    policyVersion: record.policyVersion,
    policyState: row.policy_state,
    permittedPurposes: row.permitted_purposes ?? [],
    commercialUse: row.commercial_use,
    accessMethod: row.access_method,
    retentionDays: row.retention_days,
    deletionRequired: row.deletion_required,
    attributionRequired: row.attribution_required,
    displayMode: row.display_mode,
    coverageNotes: row.coverage_notes ?? [],
    policyDocumentRef: row.policy_document_ref,
    reviewedAt: iso(row.reviewed_at),
    expiresAt: iso(row.expires_at),
    quota: policy?.quota ?? null,
    deletion: policy?.deletion ?? null,
    enabled: row.enabled,
    synthetic: row.source_type === 'fixture' || policy?.displayMode === 'fixture',
    collectible: row.collectible
  })
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
              AND EXISTS (
                SELECT 1
                  FROM appsea.source_policy_reviews review
                 WHERE review.source_id = policy.source_id
                   AND review.policy_version = policy.policy_version
                   AND review.decision = 'approved'
                   AND review.content_hash = policy.content_hash
                   AND review.independence_attested
              )
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

  /**
   * Read the private source registry through the user/workspace transaction.
   * This projection intentionally exposes policy readiness and coverage gaps,
   * but never policy payloads, hashes, reviewer identities, or activation
   * capabilities. Collectibility is recomputed from the same database gate as
   * production collection instead of trusting a mutable payload flag.
   */
  async listForUser(userId: string, workspaceId: string) {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<SourcePolicyRegistryRow>(
          `SELECT source.source_id, source.display_name, source.source_type,
                  source.lifecycle_state, source.current_policy_version,
                  policy.policy_version, policy.policy_state,
                  policy.permitted_purposes, policy.commercial_use,
                  policy.access_method, policy.retention_days,
                  policy.deletion_required, policy.attribution_required,
                  policy.display_mode, policy.coverage_notes,
                  policy.policy_document_ref, policy.reviewed_at,
                  policy.expires_at, policy.policy_payload, policy.content_hash,
                  COALESCE((
                    source.lifecycle_state = 'active'
                    AND policy.policy_version = source.current_policy_version
                    AND policy.policy_state = 'approved'
                    AND policy.reviewed_at IS NOT NULL
                    AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
                    AND (
                      source.source_type = 'fixture'
                      OR EXISTS (
                        SELECT 1
                          FROM appsea.source_policy_reviews review
                         WHERE review.source_id = policy.source_id
                           AND review.policy_version = policy.policy_version
                           AND review.decision = 'approved'
                           AND review.content_hash = policy.content_hash
                           AND review.independence_attested
                      )
                    )
                  ), false) AS enabled,
                  COALESCE((
                    source.source_type <> 'fixture'
                    AND source.lifecycle_state = 'active'
                    AND policy.policy_version = source.current_policy_version
                    AND policy.policy_state = 'approved'
                    AND policy.reviewed_at IS NOT NULL
                    AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
                    AND EXISTS (
                      SELECT 1
                        FROM appsea.source_policy_reviews review
                       WHERE review.source_id = policy.source_id
                         AND review.policy_version = policy.policy_version
                         AND review.decision = 'approved'
                         AND review.content_hash = policy.content_hash
                         AND review.independence_attested
                    )
                  ), false) AS collectible
             FROM appsea.sources source
             LEFT JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = source.current_policy_version
            ORDER BY source.display_name, source.source_id`
        )
        return result.rows.map(mapWorkspaceSource)
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
    const parsed = sourcePolicyApprovalInputSchema.parse(input)
    const sourceId = appseaIdentifierSchema.parse(parsed.sourceId)
    const version = policyVersion(parsed.policyVersion)
    await withDatabaseTransaction(this.pool, async (client) => {
      await client.query(
        `SELECT appsea.approve_source_policy(
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12::timestamptz, $13::timestamptz, $14::timestamptz
         )`,
        [
          sourceId,
          version,
          parsed.reviewId,
          parsed.reviewer,
          parsed.reviewerIdentity,
          parsed.reviewerRole,
          parsed.independenceAttested,
          parsed.approvalReference,
          parsed.notes,
          parsed.contentHash,
          parsed.reviewedAt,
          parsed.expiresAt,
          parsed.recordedAt
        ]
      )
    })
  }
}
