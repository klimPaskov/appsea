import type { Pool, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourceHealthAlertObservationSchema,
  sourcePolicyApprovalProgressSchema,
  sourcePolicyApprovalInputSchema,
  sourcePolicySchema,
  workspaceSourceReadModelSchema,
  type SourcePolicy,
  type SourcePolicyApprovalInput as SourcePolicyApprovalInputContract,
  type SourcePolicyApprovalProgress as SourcePolicyApprovalProgressContract,
  type SourceHealthAlertObservation,
  type WorkspaceSourceHealthReadModel
} from '@appsea/contracts'
import { contentHash } from './hash'
import { deriveSourceFreshness } from './source-freshness'
import { deriveSourceQuotaHeadroom } from './source-quota-headroom'
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
  health_last_observed_at: Date | string | null
  health_last_successful_collection_at: Date | string | null
  health_last_failure_code: string | null
  health_last_record_count: number | string | null
  health_active_record_count: number | string | null
  health_last_cost_micros: number | string | null
  health_open_deletion_count: number | string | null
  health_note: string
  quota_window_started_at: Date | string | null
  quota_window_ends_at: Date | string | null
  quota_requests_used: number | string | null
  quota_requests_remaining: number | string | null
}

interface SourceHealthAlertObservationRow extends QueryResultRow {
  source_id: string
  collectible: boolean
  health_state: string
  health_last_attempt_at: Date | string | null
  freshness_state: string
  freshness_age_hours: number | string | null
  quota_state: string
}

interface SourcePolicyApprovalProgressRow extends QueryResultRow {
  source_id: string
  display_name: string
  source_type: SourcePolicy['sourceType']
  lifecycle_state: string
  current_policy_version: string | null
  policy_version: string
  policy_state: SourcePolicy['policyState']
  content_hash: string
  expires_at: Date | string | null
  required_reviewer_roles: string[]
  approved_reviewer_roles: string[]
  missing_reviewer_roles: string[]
  permission_evidence_required: boolean
  permission_evidence_present: boolean
  complete: boolean
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

export type SourcePolicyApprovalProgress = SourcePolicyApprovalProgressContract

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
  const healthState = row.health_state ?? 'unknown'
  const synthetic = row.source_type === 'fixture' || policy?.displayMode === 'fixture'
  const lastObservedAt = iso(row.health_last_observed_at ?? null)
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
    freshness: policy?.freshness ?? null,
    quota: policy?.quota ?? null,
    deletion: policy?.deletion ?? null,
    enabled: row.enabled,
    synthetic,
    collectible: row.collectible,
    health: {
      state: healthState,
      lastAttemptAt: iso(row.health_last_attempt_at ?? null),
      lastSuccessfulCollectionAt: iso(row.health_last_successful_collection_at ?? null),
      lastFailureCode: row.health_last_failure_code ?? null,
      lastRecordCount: boundedInteger(row.health_last_record_count, 5_000),
      activeRecordCount: boundedInteger(row.health_active_record_count, 5_000_000),
      lastCostMicros: boundedInteger(row.health_last_cost_micros, 1_000_000_000_000),
      openDeletionCount: boundedInteger(row.health_open_deletion_count, 1_000_000),
      note: safeHealthNote(row.health_note ?? null),
      quota: deriveSourceQuotaHeadroom({
        policyQuota: policy?.quota ?? null,
        enabled: row.enabled,
        collectible: row.collectible,
        synthetic,
        windowStartedAt: iso(row.quota_window_started_at ?? null),
        windowEndsAt: iso(row.quota_window_ends_at ?? null),
        requestsUsed: row.quota_requests_used ?? null,
        requestsRemaining: row.quota_requests_remaining ?? null
      }),
      freshness: deriveSourceFreshness({
        policy,
        healthState,
        collectible: row.collectible,
        synthetic,
        lastObservedAt
      })
    }
  })
}

export class PostgresSourcePolicyRepository {
  constructor(private readonly pool: Pool) {}

  /** Operator-only scalar approval status; the database function hides review identities and references. */
  async readApprovalProgress(
    sourceId: string,
    policyVersionValue: string
  ): Promise<SourcePolicyApprovalProgress | null> {
    const validatedSourceId = appseaIdentifierSchema.parse(sourceId)
    const requestedVersion = policyVersion(policyVersionValue)
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SourcePolicyApprovalProgressRow>(
          `SELECT source_id, display_name, source_type, lifecycle_state,
                  current_policy_version, policy_version, policy_state,
                  content_hash, expires_at, required_reviewer_roles,
                  approved_reviewer_roles, missing_reviewer_roles,
                  permission_evidence_required, permission_evidence_present,
                  complete, collectible
             FROM appsea.read_source_policy_review_progress($1, $2)`,
          [validatedSourceId, requestedVersion]
        )
        const row = result.rows[0]
        if (!row) return null
        return sourcePolicyApprovalProgressSchema.parse({
          sourceId: row.source_id,
          displayName: row.display_name,
          sourceType: row.source_type,
          lifecycleState: row.lifecycle_state,
          currentPolicyVersion: row.current_policy_version,
          policyVersion: row.policy_version,
          policyState: row.policy_state,
          contentHash: row.content_hash,
          expiresAt: iso(row.expires_at),
          requiredReviewerRoles: row.required_reviewer_roles,
          approvedReviewerRoles: row.approved_reviewer_roles,
          missingReviewerRoles: row.missing_reviewer_roles,
          permissionEvidenceRequired: row.permission_evidence_required,
          permissionEvidencePresent: row.permission_evidence_present,
          complete: row.complete,
          collectible: row.collectible
        })
      },
      { readOnly: true }
    )
  }

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
    reviewedPolicy: SourcePolicy
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
              AND appsea.source_policy_has_complete_reviews(
                policy.source_id, policy.policy_version, policy.content_hash
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
          // Keep the immutable JSON payload available to the worker boundary.
          // Activation fields on `effective` are database-owned and may differ
          // from the reviewed payload without changing its contract.
          reviewedPolicy: record.policy,
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
                  quota_headroom.window_started_at AS quota_window_started_at,
                  quota_headroom.window_ends_at AS quota_window_ends_at,
                  quota_headroom.requests_used AS quota_requests_used,
                  quota_headroom.requests_remaining AS quota_requests_remaining,
                  COALESCE((
                    source.lifecycle_state = 'active'
                    AND policy.policy_version = source.current_policy_version
                    AND policy.policy_state = 'approved'
                    AND policy.reviewed_at IS NOT NULL
                    AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
                    AND (
                      source.source_type = 'fixture'
                      OR appsea.source_policy_has_complete_reviews(
                        policy.source_id, policy.policy_version, policy.content_hash
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
                    AND appsea.source_policy_has_complete_reviews(
                      policy.source_id, policy.policy_version, policy.content_hash
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
                  source_observation.last_observed_at AS health_last_observed_at,
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
             LEFT JOIN LATERAL (
                SELECT headroom.window_started_at,
                       headroom.window_ends_at,
                       headroom.requests_used,
                       headroom.requests_remaining
                  FROM appsea.read_source_quota_headroom(
                    source.source_id,
                    policy.policy_version
                  ) headroom
             ) quota_headroom ON true
            ORDER BY source.display_name, source.source_id`
        )
        return result.rows.map(mapWorkspaceSource)
      },
      { readOnly: true }
    )
  }

  /**
   * Read the maintenance-only scalar source-health projection. The SQL
   * security-definer function owns the cross-workspace authorization boundary;
   * this repository never selects source payloads, policy JSON, or complaint
   * text for an alert scan.
   */
  async listSourceHealthAlertObservations(
    workspaceId: string,
    limit = 100
  ): Promise<SourceHealthAlertObservation[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('source health alert limit must be between 1 and 100')
    }
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SourceHealthAlertObservationRow>(
          `SELECT source_id,
                  collectible,
                  health_state,
                  health_last_attempt_at,
                  freshness_state,
                  freshness_age_hours,
                  quota_state
             FROM appsea.read_source_health_alert_observations($1, $2)`,
          [parsedWorkspaceId, limit]
        )
        return result.rows.map((row) =>
          sourceHealthAlertObservationSchema.parse({
            sourceId: row.source_id,
            collectible: row.collectible,
            healthState: row.health_state,
            healthLastAttemptAt: iso(row.health_last_attempt_at),
            freshnessState: row.freshness_state,
            freshnessAgeHours:
              row.freshness_age_hours === null ? null : Number(row.freshness_age_hours),
            quotaState: row.quota_state
          })
        )
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
          parsed.permissionEvidenceReference,
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
