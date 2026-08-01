import { randomBytes } from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  sourceSnapshotReconciliationInputSchema,
  sourceSnapshotReconciliationReadModelSchema,
  type SourceSnapshotReconciliationFailureCode,
  type SourceSnapshotReconciliationInput,
  type SourceSnapshotReconciliationReadModel,
  type SourceSnapshotReconciliationState
} from '@appsea/contracts'
import { contentHash, sha256 } from './hash'
import { withDatabaseTransaction, withWorkspaceTransaction } from './transaction'

const claimTtlSeconds = 20 * 60
const maximumAttempts = 10
const maximumPageSize = 1_000
const maximumCoverageEntries = 50
const maximumTextLength = 500

export interface SourceSnapshotReconciliationLease {
  leaseId: string
  inputHash: string
}

export interface SourceSnapshotReconciliationPageInput {
  offset: number
  pageSize: number
  sourceRecordCount: number
  sourceRecordIds: readonly string[]
  shortPage: boolean
  warnings: readonly string[]
}

export interface SourceSnapshotReconciliationFinishInput {
  workspaceId: string
  reconciliationId: string
  claimToken: string
  fullSnapshot: boolean
  coverageGaps: readonly string[]
  warnings: readonly string[]
  lease: SourceSnapshotReconciliationLease
}

export interface SourceSnapshotReconciliationClaim extends SourceSnapshotReconciliationReadModel {
  claimToken: string
}

export class SourceSnapshotReconciliationConflictError extends Error {
  constructor(message = 'Source snapshot reconciliation conflicts with a previous request') {
    super(message)
    this.name = 'SourceSnapshotReconciliationConflictError'
  }
}

export class SourceSnapshotReconciliationClaimError extends Error {
  constructor(message = 'Source snapshot reconciliation claim is not active') {
    super(message)
    this.name = 'SourceSnapshotReconciliationClaimError'
  }
}

export class SourceSnapshotReconciliationPolicyDeniedError extends Error {
  constructor() {
    super('Source snapshot reconciliation requires an approved, active deletion policy')
    this.name = 'SourceSnapshotReconciliationPolicyDeniedError'
  }
}

export class SourceSnapshotReconciliationStateError extends Error {
  constructor(reconciliationId: string, state: string) {
    super(`Source snapshot reconciliation ${reconciliationId} is not processable (${state})`)
    this.name = 'SourceSnapshotReconciliationStateError'
  }
}

export class SourceSnapshotReconciliationIncompleteError extends Error {
  constructor() {
    super('Source snapshot reconciliation did not observe a complete short page')
    this.name = 'SourceSnapshotReconciliationIncompleteError'
  }
}

interface SnapshotJobRow extends QueryResultRow {
  workspace_id: string
  reconciliation_id: string
  source_id: string
  policy_version: string
  idempotency_key: string
  input_hash: string
  page_size: number | string
  max_records: number | string
  requested_at: Date | string
  state: SourceSnapshotReconciliationState
  attempt_count: number | string
  claim_token_hash: string | null
  claim_expires_at: Date | string | null
  observed_at: Date | string | null
  next_offset: number | string
  pages_scanned: number | string
  source_record_count: number | string
  deletion_count: number | string
  coverage_gaps: string[]
  warnings: string[]
  failure_code: SourceSnapshotReconciliationFailureCode | null
  failure_summary: string | null
  finished_at: Date | string | null
  next_attempt_at: Date | string
  updated_at: Date | string
}

interface SnapshotPageRow extends QueryResultRow {
  page_hash: string
  source_record_count: number | string
  short_page: boolean
}

const snapshotJobColumns = `
  workspace_id, reconciliation_id, source_id, policy_version, idempotency_key,
  input_hash, page_size, max_records, requested_at, state, attempt_count,
  claim_token_hash, claim_expires_at, observed_at, next_offset, pages_scanned,
  source_record_count, deletion_count, coverage_gaps, warnings, failure_code,
  failure_summary, finished_at, next_attempt_at, updated_at`

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function identifier(value: string, label: string): string {
  try {
    return appseaIdentifierSchema.parse(value)
  } catch {
    throw new Error(`${label} is not a persistence-safe identifier`)
  }
}

function reconciliationId(value: string): string {
  const parsed = identifier(value, 'reconciliationId')
  if (!/^reconciliation:source:[a-f0-9]{32}$/.test(parsed)) {
    throw new Error('reconciliationId must be a deterministic source reconciliation identifier')
  }
  return parsed
}

function policyVersion(value: string): string {
  if (value.length < 1 || value.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new Error('policyVersion is not persistence-safe')
  }
  return value
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return value
}

function claimToken(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('claimToken is not valid')
  return value
}

function boundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is outside the supported range`)
  }
  return value
}

function boundedPositiveInteger(value: number, label: string, maximum: number): number {
  const parsed = boundedInteger(value, label, maximum)
  if (parsed < 1) throw new Error(`${label} must be positive`)
  return parsed
}

function boundedTextArray(values: readonly string[], label: string): string[] {
  if (values.length > maximumCoverageEntries) {
    throw new Error(`${label} contains too many entries`)
  }
  return values.map((value) => {
    if (value.length < 1 || value.length > maximumTextLength) {
      throw new Error(`${label} contains an entry outside the supported range`)
    }
    return value
  })
}

function mapRow(row: SnapshotJobRow): SourceSnapshotReconciliationReadModel {
  return sourceSnapshotReconciliationReadModelSchema.parse({
    workspaceId: row.workspace_id,
    reconciliationId: row.reconciliation_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    inputHash: row.input_hash,
    idempotencyKey: row.idempotency_key,
    pageSize: Number(row.page_size),
    maxRecords: Number(row.max_records),
    requestedAt: iso(row.requested_at),
    state: row.state,
    attemptCount: Number(row.attempt_count),
    pagesScanned: Number(row.pages_scanned),
    sourceRecordCount: Number(row.source_record_count),
    deletionCount: Number(row.deletion_count),
    coverageGaps: row.coverage_gaps,
    warnings: row.warnings,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    observedAt: iso(row.observed_at),
    finishedAt: iso(row.finished_at),
    nextOffset: Number(row.next_offset),
    nextAttemptAt: iso(row.next_attempt_at),
    updatedAt: iso(row.updated_at)
  })
}

function newClaimToken(): string {
  return randomBytes(32).toString('hex')
}

function uniqueSourceRecordIds(values: readonly string[]): string[] {
  return [...new Set(values)]
    .map((value) => {
      if (value.length < 1 || value.length > 240) {
        throw new Error('sourceRecordIds contain an entry outside the supported range')
      }
      return value
    })
    .sort()
}

function databaseError(error: unknown, code: string, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  if ((error as { code?: unknown }).code !== code) return false
  if (!constraint) return true
  return (
    'constraint' in error && String((error as { constraint?: unknown }).constraint) === constraint
  )
}

function policyDeniedError(error: unknown): boolean {
  if (!databaseError(error, '42501')) return false
  return (
    'message' in (error as object) &&
    String((error as { message?: unknown }).message).includes('snapshot reconciliation')
  )
}

function validateInput(
  input: SourceSnapshotReconciliationInput
): SourceSnapshotReconciliationInput {
  const parsed = sourceSnapshotReconciliationInputSchema.parse(input)
  reconciliationId(parsed.reconciliationId)
  identifier(parsed.workspaceId, 'workspaceId')
  identifier(parsed.sourceId, 'sourceId')
  policyVersion(parsed.policyVersion)
  return { ...parsed, requestedAt: new Date(parsed.requestedAt).toISOString() }
}

export class PostgresSourceSnapshotReconciliationRepository {
  constructor(private readonly pool: Pool) {}

  /** Enqueue one policy-gated reconciliation, replaying identical input safely. */
  async enqueue(
    input: SourceSnapshotReconciliationInput
  ): Promise<SourceSnapshotReconciliationReadModel> {
    const parsed = validateInput(input)
    const inputHash = contentHash(parsed)
    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsed.workspaceId,
        async (client) => {
          const inserted = await client.query<SnapshotJobRow>(
            `INSERT INTO appsea.source_snapshot_reconciliation_jobs
               (workspace_id, reconciliation_id, source_id, policy_version,
                idempotency_key, input_hash, page_size, max_records, requested_at,
                state, next_attempt_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz,
                     'queued', clock_timestamp(), clock_timestamp())
             ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
             RETURNING ${snapshotJobColumns}`,
            [
              parsed.workspaceId,
              parsed.reconciliationId,
              parsed.sourceId,
              parsed.policyVersion,
              parsed.idempotencyKey,
              inputHash,
              parsed.pageSize,
              parsed.maxRecords,
              parsed.requestedAt
            ]
          )
          if (inserted.rows[0]) return mapRow(inserted.rows[0])
          const existing = await client.query<SnapshotJobRow>(
            `SELECT ${snapshotJobColumns}
               FROM appsea.source_snapshot_reconciliation_jobs
              WHERE workspace_id = $1 AND idempotency_key = $2`,
            [parsed.workspaceId, parsed.idempotencyKey]
          )
          const row = existing.rows[0]
          if (!row) throw new Error('Source snapshot reconciliation enqueue was not persisted')
          if (
            row.input_hash !== inputHash ||
            row.reconciliation_id !== parsed.reconciliationId ||
            row.source_id !== parsed.sourceId ||
            row.policy_version !== parsed.policyVersion
          ) {
            throw new SourceSnapshotReconciliationConflictError()
          }
          return mapRow(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (policyDeniedError(error)) {
        throw new SourceSnapshotReconciliationPolicyDeniedError()
      }
      if (databaseError(error, '23505')) {
        throw new SourceSnapshotReconciliationConflictError()
      }
      throw error
    }
  }

  listActiveWorkspaceIds(): Promise<string[]> {
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM appsea.list_active_workspaces_for_maintenance()`
        )
        return result.rows.map((row) => identifier(row.workspace_id, 'workspaceId'))
      },
      { readOnly: true }
    )
  }

  /** Claim a specific queued or stale-running job without exposing the claim token in SQL. */
  async claimById(
    workspaceId: string,
    reconciliationIdValue: string
  ): Promise<SourceSnapshotReconciliationClaim | null> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(reconciliationIdValue)
    return this.claim(parsedWorkspaceId, parsedReconciliationId, true)
  }

  /** Claim the oldest due job for a scheduler or bounded maintenance worker. */
  async claimNext(
    workspaceId: string,
    sourceIdValue = 'cfpb-consumer-complaints'
  ): Promise<SourceSnapshotReconciliationClaim | null> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedSourceId = identifier(sourceIdValue, 'sourceId')
    return this.claim(parsedWorkspaceId, null, false, parsedSourceId)
  }

  private async claim(
    workspaceId: string,
    reconciliationIdValue: string | null,
    exact: boolean,
    sourceIdValue: string | null = null
  ): Promise<SourceSnapshotReconciliationClaim | null> {
    const token = newClaimToken()
    const tokenHash = sha256(token)
    return withWorkspaceTransaction(this.pool, workspaceId, async (client) => {
      const conditions = exact
        ? `job.workspace_id = $1 AND job.reconciliation_id = $2`
        : sourceIdValue
          ? `job.workspace_id = $1 AND job.source_id = $2`
          : `job.workspace_id = $1`
      const parameters = exact
        ? [workspaceId, reconciliationIdValue, tokenHash]
        : sourceIdValue
          ? [workspaceId, sourceIdValue, tokenHash]
          : [workspaceId, tokenHash]
      const tokenParameter = exact || sourceIdValue ? '$3' : '$2'
      const claimed = await client.query<SnapshotJobRow>(
        `WITH candidate AS (
           SELECT job.workspace_id, job.reconciliation_id
             FROM appsea.source_snapshot_reconciliation_jobs job
            WHERE ${conditions}
              AND job.next_attempt_at <= clock_timestamp()
              AND (
                job.state = 'queued'
                OR (job.state = 'running' AND job.claim_expires_at <= clock_timestamp())
              )
            ORDER BY job.next_attempt_at, job.reconciliation_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE appsea.source_snapshot_reconciliation_jobs job
            SET state = 'running',
                attempt_count = job.attempt_count + 1,
                claim_token_hash = ${tokenParameter},
                claim_expires_at = clock_timestamp() + (${claimTtlSeconds}) * interval '1 second',
                observed_at = COALESCE(job.observed_at, clock_timestamp()),
                failure_code = NULL,
                failure_summary = NULL,
                finished_at = NULL,
                next_attempt_at = clock_timestamp(),
                updated_at = clock_timestamp()
           FROM candidate
          WHERE job.workspace_id = candidate.workspace_id
            AND job.reconciliation_id = candidate.reconciliation_id
         RETURNING ${snapshotJobColumns}`,
        parameters
      )
      const row = claimed.rows[0]
      return row ? { ...mapRow(row), claimToken: token } : null
    })
  }

  /** Append one identifier-only page, treating a repeated page checkpoint as a no-op. */
  async appendPage(
    workspaceId: string,
    reconciliationIdValue: string,
    tokenValue: string,
    page: SourceSnapshotReconciliationPageInput
  ): Promise<SourceSnapshotReconciliationReadModel> {
    const parsedWorkspaceId = identifier(workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(reconciliationIdValue)
    const token = claimToken(tokenValue)
    const offset = boundedInteger(page.offset, 'offset', maximumPageSize)
    const pageSize = boundedPositiveInteger(page.pageSize, 'pageSize', maximumPageSize)
    const sourceRecordCount = boundedInteger(
      page.sourceRecordCount,
      'sourceRecordCount',
      maximumPageSize
    )
    if (sourceRecordCount > pageSize) {
      throw new Error('sourceRecordCount cannot exceed pageSize')
    }
    const sourceRecordIds = uniqueSourceRecordIds(page.sourceRecordIds)
    const warnings = boundedTextArray(page.warnings, 'warnings')
    if (sourceRecordIds.length > sourceRecordCount) {
      throw new Error('sourceRecordIds cannot exceed sourceRecordCount')
    }
    if (page.shortPage !== sourceRecordCount < pageSize) {
      throw new Error('shortPage must match sourceRecordCount')
    }
    const pageHash = contentHash({
      offset,
      pageSize,
      sourceRecordCount,
      sourceRecordIds,
      shortPage: page.shortPage,
      warnings
    })
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const job = await this.assertClaimInTransaction(
          client,
          parsedWorkspaceId,
          parsedReconciliationId,
          token
        )
        if (offset !== Number(job.next_offset)) {
          const existing = await client.query<SnapshotPageRow>(
            `SELECT page_hash, source_record_count, short_page
               FROM appsea.source_snapshot_reconciliation_pages
              WHERE workspace_id = $1 AND reconciliation_id = $2 AND page_offset = $3`,
            [parsedWorkspaceId, parsedReconciliationId, offset]
          )
          if (existing.rows[0]?.page_hash === pageHash) return mapRow(job)
          throw new SourceSnapshotReconciliationConflictError(
            'Snapshot page offset does not match the durable checkpoint'
          )
        }
        if (offset + sourceRecordCount > Number(job.max_records)) {
          throw new Error('Snapshot page exceeds the reconciliation record budget')
        }
        const insertedPage = await client.query<SnapshotPageRow>(
          `INSERT INTO appsea.source_snapshot_reconciliation_pages
             (workspace_id, reconciliation_id, page_offset, page_size,
              source_record_count, page_hash, short_page, warnings,
              observed_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   $8::text[], $9::timestamptz, clock_timestamp())
           ON CONFLICT (workspace_id, reconciliation_id, page_offset) DO NOTHING
           RETURNING page_hash, source_record_count, short_page`,
          [
            parsedWorkspaceId,
            parsedReconciliationId,
            offset,
            pageSize,
            sourceRecordCount,
            pageHash,
            page.shortPage,
            warnings,
            job.observed_at
          ]
        )
        if (!insertedPage.rows[0]) {
          const existing = await client.query<SnapshotPageRow>(
            `SELECT page_hash, source_record_count, short_page
               FROM appsea.source_snapshot_reconciliation_pages
              WHERE workspace_id = $1 AND reconciliation_id = $2 AND page_offset = $3`,
            [parsedWorkspaceId, parsedReconciliationId, offset]
          )
          if (existing.rows[0]?.page_hash === pageHash) return mapRow(job)
          throw new SourceSnapshotReconciliationConflictError('Snapshot page checkpoint conflicts')
        }
        if (sourceRecordIds.length > 0) {
          await client.query(
            `INSERT INTO appsea.source_snapshot_reconciliation_items
               (workspace_id, reconciliation_id, source_record_id, observed_at)
             SELECT $1, $2, value, $3::timestamptz
               FROM unnest($4::text[]) AS value
             ON CONFLICT (workspace_id, reconciliation_id, source_record_id) DO NOTHING`,
            [parsedWorkspaceId, parsedReconciliationId, job.observed_at, sourceRecordIds]
          )
        }
        const updated = await client.query<SnapshotJobRow>(
          `UPDATE appsea.source_snapshot_reconciliation_jobs
              SET next_offset = next_offset + $3,
                  pages_scanned = pages_scanned + 1,
                  source_record_count = source_record_count + $3,
                  warnings = (
                    SELECT COALESCE(array_agg(DISTINCT value ORDER BY value), '{}'::text[])
                      FROM unnest(warnings || $4::text[]) AS warning(value)
                  ),
                  updated_at = clock_timestamp()
            WHERE workspace_id = $1 AND reconciliation_id = $2
          RETURNING ${snapshotJobColumns}`,
          [parsedWorkspaceId, parsedReconciliationId, sourceRecordCount, warnings]
        )
        if (!updated.rows[0]) throw new Error('Snapshot reconciliation page was not persisted')
        return mapRow(updated.rows[0])
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  /** Finish only after the source lease is locked in the same transaction. */
  async finish(
    input: SourceSnapshotReconciliationFinishInput
  ): Promise<SourceSnapshotReconciliationReadModel> {
    const workspaceId = identifier(input.workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(input.reconciliationId)
    const token = claimToken(input.claimToken)
    const leaseId = identifier(input.lease.leaseId, 'leaseId')
    const leaseInputHash = digest(input.lease.inputHash, 'lease inputHash')
    const coverageGaps = boundedTextArray(input.coverageGaps, 'coverageGaps')
    const warnings = boundedTextArray(input.warnings, 'warnings')
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const job = await this.assertClaimInTransaction(
          client,
          workspaceId,
          parsedReconciliationId,
          token
        )
        const finalWarnings = [...new Set([...job.warnings, ...warnings])].slice(
          0,
          maximumCoverageEntries
        )
        if (leaseInputHash !== job.input_hash) {
          throw new SourceSnapshotReconciliationConflictError(
            'Source collection lease does not match the reconciliation input'
          )
        }
        const lease = await client.query<{ active: boolean }>(
          `SELECT appsea.assert_source_collection_lease($1, $2, $3) AS active`,
          [workspaceId, leaseId, leaseInputHash]
        )
        if (!lease.rows[0]?.active) throw new SourceSnapshotReconciliationClaimError()

        let deletionCount = 0
        if (input.fullSnapshot && finalWarnings.length > 0) {
          throw new SourceSnapshotReconciliationIncompleteError()
        }
        if (input.fullSnapshot) {
          const completePage = await client.query<{ exists: boolean }>(
            `SELECT EXISTS (
               SELECT 1
                 FROM appsea.source_snapshot_reconciliation_pages
                WHERE workspace_id = $1
                  AND reconciliation_id = $2
                  AND short_page = true
             ) AS exists`,
            [workspaceId, parsedReconciliationId]
          )
          if (!completePage.rows[0]?.exists) throw new SourceSnapshotReconciliationIncompleteError()
          const inserted = await client.query(
            `INSERT INTO appsea.deletion_tombstones
               (workspace_id, tombstone_id, source_id, source_record_id,
                reason, state, received_at)
             SELECT item.workspace_id,
                    'tombstone:full-snapshot:' || md5(
                      item.workspace_id || ':' || item.source_id || ':' ||
                      item.source_record_id || ':full-snapshot-reconciliation'
                    ),
                    item.source_id,
                    item.source_record_id,
                    'full-snapshot-reconciliation',
                    'pending',
                    $4::timestamptz
              FROM appsea.source_items item
              WHERE item.workspace_id = $1
                AND item.source_id = $3
                AND item.deletion_state = 'active'
                AND NOT EXISTS (
                  SELECT 1
                    FROM appsea.source_snapshot_reconciliation_items seen
                   WHERE seen.workspace_id = item.workspace_id
                     AND seen.reconciliation_id = $2
                     AND seen.source_record_id = item.source_record_id
                )
             ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING`,
            [workspaceId, parsedReconciliationId, job.source_id, job.observed_at]
          )
          deletionCount = inserted.rowCount ?? inserted.rows.length
        }
        const finalState = input.fullSnapshot ? 'completed' : 'incomplete'
        const finalFailureCode = input.fullSnapshot ? null : 'snapshot_incomplete'
        const finalFailureSummary = input.fullSnapshot
          ? null
          : 'The bounded source traversal did not prove a complete full snapshot.'
        const finalGaps = input.fullSnapshot
          ? coverageGaps
          : [
              ...new Set([
                ...coverageGaps,
                'The source traversal was incomplete; no deletion absence was inferred.'
              ])
            ]
        const updated = await client.query<SnapshotJobRow>(
          `UPDATE appsea.source_snapshot_reconciliation_jobs
              SET state = $3,
                  deletion_count = deletion_count + $4,
                  coverage_gaps = $5::text[],
                  warnings = $6::text[],
                  failure_code = $7,
                  failure_summary = $8,
                  claim_token_hash = NULL,
                  claim_expires_at = NULL,
                  finished_at = clock_timestamp(),
                  next_attempt_at = clock_timestamp(),
                  updated_at = clock_timestamp()
            WHERE workspace_id = $1 AND reconciliation_id = $2
          RETURNING ${snapshotJobColumns}`,
          [
            workspaceId,
            parsedReconciliationId,
            finalState,
            deletionCount,
            finalGaps,
            finalWarnings,
            finalFailureCode,
            finalFailureSummary
          ]
        )
        if (!updated.rows[0]) throw new Error('Snapshot reconciliation result was not persisted')
        return mapRow(updated.rows[0])
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
  }

  /** Retry a transient source or persistence failure without losing checkpoints. */
  async reschedule(
    workspaceId: string,
    reconciliationIdValue: string,
    tokenValue: string,
    failureCode: Extract<
      SourceSnapshotReconciliationFailureCode,
      'source_request_failed' | 'reconciliation_failed'
    >,
    failureSummary: string,
    delaySeconds = 30
  ): Promise<SourceSnapshotReconciliationReadModel> {
    const workspace = identifier(workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(reconciliationIdValue)
    const token = claimToken(tokenValue)
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('failureSummary is outside the supported range')
    }
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 86_400) {
      throw new Error('retry delay is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, workspace, async (client) => {
      const job = await this.assertClaimInTransaction(
        client,
        workspace,
        parsedReconciliationId,
        token
      )
      const terminal = Number(job.attempt_count) >= maximumAttempts
      const updated = await client.query<SnapshotJobRow>(
        `UPDATE appsea.source_snapshot_reconciliation_jobs
            SET state = $3,
                failure_code = $4,
                failure_summary = $5,
                claim_token_hash = NULL,
                claim_expires_at = NULL,
                finished_at = CASE WHEN $3 = 'failed' THEN clock_timestamp() ELSE NULL END,
                next_attempt_at = CASE
                  WHEN $3 = 'failed' THEN clock_timestamp()
                  ELSE clock_timestamp() + ($6::text || ' seconds')::interval
                END,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND reconciliation_id = $2
        RETURNING ${snapshotJobColumns}`,
        [
          workspace,
          parsedReconciliationId,
          terminal ? 'failed' : 'queued',
          failureCode,
          failureSummary,
          delaySeconds
        ]
      )
      if (!updated.rows[0]) throw new Error('Snapshot reconciliation retry was not persisted')
      return mapRow(updated.rows[0])
    })
  }

  /** Mark a policy or unrecoverable reconciliation failure terminally. */
  async fail(
    workspaceId: string,
    reconciliationIdValue: string,
    tokenValue: string,
    failureCode: Extract<
      SourceSnapshotReconciliationFailureCode,
      'policy_denied' | 'reconciliation_failed'
    >,
    failureSummary: string
  ): Promise<SourceSnapshotReconciliationReadModel> {
    const workspace = identifier(workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(reconciliationIdValue)
    const token = claimToken(tokenValue)
    if (failureSummary.length < 1 || failureSummary.length > 240) {
      throw new Error('failureSummary is outside the supported range')
    }
    return withWorkspaceTransaction(this.pool, workspace, async (client) => {
      await this.assertClaimInTransaction(client, workspace, parsedReconciliationId, token)
      const updated = await client.query<SnapshotJobRow>(
        `UPDATE appsea.source_snapshot_reconciliation_jobs
            SET state = 'failed', failure_code = $3, failure_summary = $4,
                claim_token_hash = NULL, claim_expires_at = NULL,
                finished_at = clock_timestamp(), next_attempt_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND reconciliation_id = $2
        RETURNING ${snapshotJobColumns}`,
        [workspace, parsedReconciliationId, failureCode, failureSummary]
      )
      if (!updated.rows[0]) throw new Error('Snapshot reconciliation failure was not persisted')
      return mapRow(updated.rows[0])
    })
  }

  async read(
    workspaceId: string,
    reconciliationIdValue: string
  ): Promise<SourceSnapshotReconciliationReadModel | null> {
    const workspace = identifier(workspaceId, 'workspaceId')
    const parsedReconciliationId = reconciliationId(reconciliationIdValue)
    return withWorkspaceTransaction(
      this.pool,
      workspace,
      (client) => this.readInTransaction(client, workspace, parsedReconciliationId),
      { readOnly: true }
    )
  }

  private async readInTransaction(
    client: PoolClient,
    workspaceId: string,
    reconciliationIdValue: string
  ): Promise<SourceSnapshotReconciliationReadModel | null> {
    const result = await client.query<SnapshotJobRow>(
      `SELECT ${snapshotJobColumns}
         FROM appsea.source_snapshot_reconciliation_jobs
        WHERE workspace_id = $1 AND reconciliation_id = $2`,
      [workspaceId, reconciliationIdValue]
    )
    return result.rows[0] ? mapRow(result.rows[0]) : null
  }

  private async assertClaimInTransaction(
    client: PoolClient,
    workspaceId: string,
    reconciliationIdValue: string,
    token: string
  ): Promise<SnapshotJobRow> {
    const result = await client.query<SnapshotJobRow>(
      `SELECT ${snapshotJobColumns}
         FROM appsea.source_snapshot_reconciliation_jobs
        WHERE workspace_id = $1 AND reconciliation_id = $2
        FOR UPDATE`,
      [workspaceId, reconciliationIdValue]
    )
    const row = result.rows[0]
    if (!row)
      throw new Error(`Source snapshot reconciliation ${reconciliationIdValue} was not found`)
    if (row.state !== 'running') {
      throw new SourceSnapshotReconciliationStateError(reconciliationIdValue, row.state)
    }
    if (row.claim_token_hash !== sha256(token)) throw new SourceSnapshotReconciliationClaimError()
    if (!row.claim_expires_at || Date.parse(iso(row.claim_expires_at)!) <= Date.now()) {
      throw new SourceSnapshotReconciliationClaimError(
        'Source snapshot reconciliation claim expired'
      )
    }
    return row
  }
}
