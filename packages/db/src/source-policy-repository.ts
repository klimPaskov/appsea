import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourcePolicyApprovalInputSchema,
  sourcePolicySchema,
  workspaceSourceReadModelSchema,
  type SourcePolicy,
  type SourcePolicyApprovalInput as SourcePolicyApprovalInputContract,
  type WorkspaceSourceHealthReadModel
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
  health_state: WorkspaceSourceHealthReadModel['state']
  health_last_attempt_at: Date | string | null
  health_last_successful_collection_at: Date | string | null
  health_last_failure_code: string | null
  health_last_record_count: number | string | null
  health_active_record_count: number | string | null
  health_last_cost_micros: number | string | null
  health_open_deletion_count: number | string | null
  health_note: string
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

function boundedInteger(value: number | string | null, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error('Stored source health counter is outside the supported range')
  }
  return parsed
}

const sourceHealthNotes = new Set([
  'Synthetic fixture is available locally; it is not market evidence.',
  'Collection is blocked until the current source policy is active and approved.',
  'A completed collection or retained private observation is available.',
  'The latest collection attempt is still running or did not complete successfully.',
  'No completed collection has been observed for this workspace.'
])

function safeHealthNote(value: string | null): string {
  return value && sourceHealthNotes.has(value)
    ? value
    : 'No completed collection has been observed for this workspace.'
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
    collectible: row.collectible,
    health: {
      state: row.health_state ?? 'unknown',
      lastAttemptAt: iso(row.health_last_attempt_at ?? null),
      lastSuccessfulCollectionAt: iso(row.health_last_successful_collection_at ?? null),
      lastFailureCode: row.health_last_failure_code ?? null,
      lastRecordCount: boundedInteger(row.health_last_record_count, 5_000),
      activeRecordCount: boundedInteger(row.health_active_record_count, 5_000_000),
      lastCostMicros: boundedInteger(row.health_last_cost_micros, 1_000_000_000_000),
      openDeletionCount: boundedInteger(row.health_open_deletion_count, 1_000_000),
      note: safeHealthNote(row.health_note ?? null)
    }
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
                  ), false) AS collectible,
                  CASE
                    WHEN source.source_type = 'fixture' AND source.lifecycle_state = 'active'
                      THEN 'healthy'
                    WHEN source.lifecycle_state <> 'active'
                      OR policy.policy_state IS DISTINCT FROM 'approved'
                      OR policy.reviewed_at IS NULL
                      OR (policy.expires_at IS NOT NULL AND policy.expires_at <= clock_timestamp())
                      THEN 'blocked'
                    WHEN health_job.state = 'completed'
                      OR source_observation.last_observed_at IS NOT NULL
                      THEN 'healthy'
                    WHEN health_job.state IS NOT NULL
                      THEN 'degraded'
                    ELSE 'unknown'
                  END AS health_state,
                  health_job.last_attempt_at AS health_last_attempt_at,
                  COALESCE(health_job.last_success_at, source_observation.last_observed_at)
                    AS health_last_successful_collection_at,
                  health_job.failure_code AS health_last_failure_code,
                  COALESCE(health_job.record_count, 0) AS health_last_record_count,
                  COALESCE(source_observation.active_record_count, 0) AS health_active_record_count,
                  COALESCE(health_job.cost_micros, 0) AS health_last_cost_micros,
                  COALESCE(deletion_backlog.open_deletion_count, 0) AS health_open_deletion_count,
                  CASE
                    WHEN source.source_type = 'fixture' AND source.lifecycle_state = 'active'
                      THEN 'Synthetic fixture is available locally; it is not market evidence.'
                    WHEN source.lifecycle_state <> 'active'
                      OR policy.policy_state IS DISTINCT FROM 'approved'
                      OR policy.reviewed_at IS NULL
                      OR (policy.expires_at IS NOT NULL AND policy.expires_at <= clock_timestamp())
                      THEN 'Collection is blocked until the current source policy is active and approved.'
                    WHEN health_job.state = 'completed'
                      OR source_observation.last_observed_at IS NOT NULL
                      THEN 'A completed collection or retained private observation is available.'
                    WHEN health_job.state IS NOT NULL
                      THEN 'The latest collection attempt is still running or did not complete successfully.'
                    ELSE 'No completed collection has been observed for this workspace.'
                  END AS health_note
             FROM appsea.sources source
             LEFT JOIN appsea.source_policy_versions policy
               ON policy.source_id = source.source_id
              AND policy.policy_version = source.current_policy_version
             LEFT JOIN LATERAL (
                SELECT job.state,
                       job.updated_at AS last_attempt_at,
                       CASE WHEN job.state = 'completed' THEN job.finished_at END AS last_success_at,
                       job.failure_code,
                       CASE WHEN job.state = 'completed' THEN job.consumed_source_items ELSE 0 END
                         AS record_count,
                       CASE WHEN job.state = 'completed' THEN job.consumed_cost_micros ELSE 0 END
                         AS cost_micros
                  FROM appsea.production_collection_workflow_jobs job
                 WHERE job.workspace_id = appsea.current_workspace_id()
                   AND job.source_id = source.source_id
                 ORDER BY job.updated_at DESC, job.workflow_id DESC
                 LIMIT 1
             ) health_job ON true
             LEFT JOIN LATERAL (
                SELECT MAX(item.captured_at) AS last_observed_at,
                       LEAST(COUNT(*)::bigint, 5000000::bigint) AS active_record_count
                  FROM appsea.source_items item
                 WHERE item.workspace_id = appsea.current_workspace_id()
                   AND item.source_id = source.source_id
                   AND item.deletion_state = 'active'
             ) source_observation ON true
             LEFT JOIN LATERAL (
                SELECT COUNT(*)::bigint AS open_deletion_count
                  FROM appsea.deletion_tombstones tombstone
                 WHERE tombstone.workspace_id = appsea.current_workspace_id()
                   AND tombstone.source_id = source.source_id
                   AND tombstone.state IN ('pending', 'processing')
             ) deletion_backlog ON true
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
