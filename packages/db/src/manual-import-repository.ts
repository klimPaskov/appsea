import { createHash } from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  manualImportBatchCreateInputSchema,
  manualImportBatchReadModelSchema,
  manualImportRecordSchema,
  manualImportDeletionResultSchema,
  researchCampaignConfigurationSchema,
  type ManualImportBatchCreateInput,
  type ManualImportBatchReadModel,
  type ManualImportDeletionResult,
  type ManualImportRecord
} from '@appsea/contracts'
import { contentHash } from './hash'
import {
  withAuthenticatedWorkspaceTransaction,
  withServiceWorkspaceTransaction
} from './transaction'

export class ManualImportPermissionError extends Error {
  constructor(message = 'Only an authenticated workspace owner may manage manual imports') {
    super(message)
    this.name = 'ManualImportPermissionError'
  }
}

export class ManualImportConflictError extends Error {
  constructor(message = 'Manual import batch conflicts with an existing batch') {
    super(message)
    this.name = 'ManualImportConflictError'
  }
}

export class ManualImportUnavailableError extends Error {
  constructor(message = 'Manual import batch is not available for collection') {
    super(message)
    this.name = 'ManualImportUnavailableError'
  }
}

interface BatchRow extends QueryResultRow {
  workspace_id: string
  batch_id: string
  campaign_id: string
  source_id: string
  policy_version: string
  format: 'csv' | 'json'
  filename: string
  record_count: number | string
  warning_count: number | string
  state: 'staged' | 'consumed' | 'deleted' | 'failed'
  content_hash: string
  idempotency_digest: string
  input_hash: string
  run_id: string | null
  created_at: Date | string
  consumed_at: Date | string | null
  deleted_at: Date | string | null
}

interface RecordRow extends QueryResultRow {
  record_ordinal: number | string
  source_record_id: string
  record_payload: unknown
  content_hash: string
}

function asIso(value: Date | string | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
}

function hashIdentifier(prefix: string, value: unknown): string {
  return `${prefix}:${contentHash(value).slice(0, 32)}`
}

/** Must remain byte-for-byte compatible with the manual connector's source ID projection. */
function scopedSourceRecordId(batchId: string, sourceRecordId: string): string {
  const candidate = `manual:${batchId}:${sourceRecordId}`
  if (candidate.length <= 240) return candidate
  const digest = createHash('sha256').update(sourceRecordId).digest('hex').slice(0, 32)
  return `manual:${batchId}:${digest}`.slice(0, 240)
}

function batchReadModel(row: BatchRow): ManualImportBatchReadModel {
  return manualImportBatchReadModelSchema.parse({
    batchId: row.batch_id,
    campaignId: row.campaign_id,
    sourceId: row.source_id,
    policyVersion: row.policy_version,
    format: row.format,
    filename: row.filename,
    recordCount: Number(row.record_count),
    warningCount: Number(row.warning_count),
    state: row.state,
    contentHash: row.content_hash,
    runId: row.run_id,
    createdAt: asIso(row.created_at),
    consumedAt: asIso(row.consumed_at),
    deletedAt: asIso(row.deleted_at)
  })
}

async function assertOwner(client: PoolClient, userId: string, workspaceId: string): Promise<void> {
  const membership = await client.query<{ role: string }>(
    `SELECT role
       FROM appsea.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2
      FOR SHARE`,
    [workspaceId, userId]
  )
  if (membership.rows[0]?.role !== 'owner') throw new ManualImportPermissionError()
}

async function assertCampaign(
  client: PoolClient,
  input: ManualImportBatchCreateInput
): Promise<void> {
  const result = await client.query<{
    synthetic: boolean
    configuration: unknown
    purpose: string
    campaign_state: string
    fixture_only: boolean
    workspace_status: string
    visibility: string
  }>(
    `SELECT campaign.synthetic, campaign.configuration, campaign.purpose,
            campaign.state AS campaign_state, workspace.fixture_only,
            workspace.status AS workspace_status, workspace.visibility
       FROM appsea.research_campaigns campaign
       JOIN appsea.workspaces workspace ON workspace.workspace_id = campaign.workspace_id
      WHERE campaign.workspace_id = $1 AND campaign.campaign_id = $2
      FOR SHARE`,
    [input.workspaceId, input.campaignId]
  )
  const campaign = result.rows[0]
  if (
    !campaign ||
    campaign.synthetic ||
    campaign.fixture_only ||
    campaign.workspace_status !== 'active' ||
    campaign.visibility !== 'private' ||
    campaign.campaign_state === 'archived'
  ) {
    throw new ManualImportConflictError(
      'Manual imports require an active private production campaign'
    )
  }
  const configuration = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
  if (!configuration.success || !configuration.data.sourceIds.includes(input.sourceId)) {
    throw new ManualImportConflictError(
      'The campaign must explicitly include the owner-authorized manual source'
    )
  }
  if (configuration.data.requestedDisplayMode !== input.requestedDisplayMode) {
    throw new ManualImportConflictError(
      'The campaign display mode does not match the manual source policy'
    )
  }
  if (campaign.purpose !== input.purpose) {
    throw new ManualImportConflictError('The campaign purpose does not match the import purpose')
  }
  const policy = await client.query<{ collectible: boolean }>(
    `SELECT appsea.manual_import_source_policy_collectible($1, $2, $3, $4) AS collectible`,
    [input.sourceId, input.policyVersion, input.purpose, input.requestedDisplayMode]
  )
  if (policy.rows[0]?.collectible !== true) {
    throw new ManualImportConflictError('The owner-import source policy is not collectible')
  }
}

async function readBatchRow(
  client: PoolClient,
  workspaceId: string,
  batchId: string,
  lock = false
): Promise<BatchRow | null> {
  const result = await client.query<BatchRow>(
    `SELECT workspace_id, batch_id, campaign_id, source_id, policy_version,
            format, filename, record_count, warning_count, state, content_hash,
            idempotency_digest, input_hash, run_id, created_at, consumed_at, deleted_at
       FROM appsea.manual_import_batches
      WHERE workspace_id = $1 AND batch_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [workspaceId, batchId]
  )
  return result.rows[0] ?? null
}

export interface ManualImportCollectionRead {
  records: ManualImportRecord[]
  warnings: string[]
}

export interface ManualImportBatchConsumeInput {
  workspaceId: string
  batchId: string
  campaignId: string
  policyVersion: string
  runId: string
  observedAt: string
}

/** Called by the production persistence transaction after evidence is durable. */
export async function consumeManualImportBatchInTransaction(
  client: PoolClient,
  input: ManualImportBatchConsumeInput
): Promise<void> {
  const row = await readBatchRow(client, input.workspaceId, input.batchId, true)
  if (!row) throw new ManualImportUnavailableError()
  if (
    row.campaign_id !== input.campaignId ||
    row.source_id !== 'manual-owner-import' ||
    row.policy_version !== input.policyVersion
  ) {
    throw new ManualImportConflictError('Manual batch lineage does not match the collection run')
  }
  if (row.state === 'consumed' && row.run_id === input.runId) return
  if (row.state !== 'staged' || row.run_id !== null) {
    throw new ManualImportUnavailableError('Manual import batch was already consumed or deleted')
  }
  await client.query(
    `UPDATE appsea.manual_import_batches
        SET state = 'consumed', run_id = $3, consumed_at = $4
      WHERE workspace_id = $1 AND batch_id = $2`,
    [input.workspaceId, input.batchId, input.runId, input.observedAt]
  )
}

export class PostgresManualImportRepository {
  constructor(private readonly pool: Pool) {}

  async createForUser(
    userId: string,
    input: ManualImportBatchCreateInput
  ): Promise<ManualImportBatchReadModel> {
    const parsed = manualImportBatchCreateInputSchema.parse(input)
    const recordContentHash = contentHash(parsed.records)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      parsed.workspaceId,
      async (client) => {
        await assertOwner(client, userId, parsed.workspaceId)
        await assertCampaign(client, parsed)
        const existing = await client.query<BatchRow>(
          `SELECT workspace_id, batch_id, campaign_id, source_id, policy_version,
                  format, filename, record_count, warning_count, state, content_hash,
                  idempotency_digest, input_hash, run_id, created_at, consumed_at, deleted_at
             FROM appsea.manual_import_batches
            WHERE workspace_id = $1
              AND (batch_id = $2 OR idempotency_digest = $3)
            FOR UPDATE`,
          [parsed.workspaceId, parsed.batchId, parsed.idempotencyDigest]
        )
        const prior = existing.rows[0]
        if (prior) {
          if (
            prior.input_hash !== parsed.inputHash ||
            prior.content_hash !== recordContentHash ||
            prior.campaign_id !== parsed.campaignId ||
            prior.record_count !== parsed.records.length
          ) {
            throw new ManualImportConflictError()
          }
          return batchReadModel(prior)
        }
        await client.query(
          `INSERT INTO appsea.manual_import_batches
             (workspace_id, batch_id, campaign_id, source_id, policy_version, purpose,
              requested_display_mode, idempotency_digest, input_hash, format, filename,
              record_count, warning_count, warnings, authorization_attested, attested_by,
              attested_at, state, content_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   true, $15, $16, 'staged', $17, $16)`,
          [
            parsed.workspaceId,
            parsed.batchId,
            parsed.campaignId,
            parsed.sourceId,
            parsed.policyVersion,
            parsed.purpose,
            parsed.requestedDisplayMode,
            parsed.idempotencyDigest,
            parsed.inputHash,
            parsed.format,
            parsed.filename,
            parsed.records.length,
            parsed.warnings.length,
            parsed.warnings,
            parsed.attestedBy,
            parsed.attestedAt,
            recordContentHash
          ]
        )
        for (const [index, record] of parsed.records.entries()) {
          await client.query(
            `INSERT INTO appsea.manual_import_records
               (workspace_id, batch_id, record_ordinal, source_record_id,
                record_payload, content_hash, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [
              parsed.workspaceId,
              parsed.batchId,
              index + 1,
              record.sourceRecordId,
              JSON.stringify(record),
              contentHash(record),
              parsed.createdAt
            ]
          )
        }
        await client.query(
          `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
              target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.manual_import.staged',
                   'manual_import_batch', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
          [
            parsed.workspaceId,
            hashIdentifier('audit', { batchId: parsed.batchId, action: 'staged' }),
            userId,
            parsed.batchId,
            JSON.stringify({
              recordCount: parsed.records.length,
              format: parsed.format,
              rawBytesRetained: false,
              authorizationAttested: true
            }),
            parsed.createdAt
          ]
        )
        const created = await readBatchRow(client, parsed.workspaceId, parsed.batchId)
        if (!created) throw new Error('Manual import batch was not persisted')
        return batchReadModel(created)
      }
    )
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    batchId: string
  ): Promise<ManualImportBatchReadModel | null> {
    const validatedBatchId = appseaIdentifierSchema.parse(batchId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const row = await readBatchRow(client, workspaceId, validatedBatchId)
        return row ? batchReadModel(row) : null
      },
      { readOnly: true }
    )
  }

  async listForUser(
    userId: string,
    workspaceId: string,
    campaignId?: string
  ): Promise<ManualImportBatchReadModel[]> {
    const validatedCampaignId = campaignId ? appseaIdentifierSchema.parse(campaignId) : null
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const result = await client.query<BatchRow>(
          `SELECT workspace_id, batch_id, campaign_id, source_id, policy_version,
                  format, filename, record_count, warning_count, state, content_hash,
                  idempotency_digest, input_hash, run_id, created_at, consumed_at, deleted_at
             FROM appsea.manual_import_batches
            WHERE workspace_id = $1
              AND ($2::text IS NULL OR campaign_id = $2)
            ORDER BY created_at DESC, batch_id DESC
            LIMIT 100`,
          [workspaceId, validatedCampaignId]
        )
        return result.rows.map(batchReadModel)
      },
      { readOnly: true }
    )
  }

  async readForCollection(input: {
    workspaceId: string
    batchId: string
    policyVersion: string
    runId: string
    limit: number
  }): Promise<ManualImportCollectionRead> {
    const workspaceId = appseaIdentifierSchema.parse(input.workspaceId)
    const batchId = appseaIdentifierSchema.parse(input.batchId)
    return withServiceWorkspaceTransaction(this.pool, workspaceId, async (client) => {
      const batch = await readBatchRow(client, workspaceId, batchId, true)
      if (
        !batch ||
        batch.state !== 'staged' ||
        batch.source_id !== 'manual-owner-import' ||
        batch.policy_version !== input.policyVersion
      ) {
        throw new ManualImportUnavailableError()
      }
      const rows = await client.query<RecordRow>(
        `SELECT record_ordinal, source_record_id, record_payload, content_hash
           FROM appsea.manual_import_records
          WHERE workspace_id = $1 AND batch_id = $2 AND record_payload IS NOT NULL
          ORDER BY record_ordinal ASC
          LIMIT $3`,
        [workspaceId, batchId, Math.min(input.limit, 5_000)]
      )
      const records: ManualImportRecord[] = []
      for (const row of rows.rows) {
        const parsed = manualImportRecordSchema.safeParse(row.record_payload)
        if (!parsed.success || contentHash(parsed.data) !== row.content_hash) {
          throw new ManualImportUnavailableError(
            'Staged manual record failed its immutable content hash check'
          )
        }
        records.push(parsed.data)
      }
      if (records.length === 0)
        throw new ManualImportUnavailableError('Manual import batch has no staged records')
      return { records, warnings: [] }
    })
  }

  async requestDeletionForUser(
    userId: string,
    workspaceId: string,
    batchId: string,
    occurredAt: string
  ): Promise<ManualImportDeletionResult> {
    const validatedBatchId = appseaIdentifierSchema.parse(batchId)
    return withAuthenticatedWorkspaceTransaction(this.pool, userId, workspaceId, async (client) => {
      await assertOwner(client, userId, workspaceId)
      const batch = await readBatchRow(client, workspaceId, validatedBatchId, true)
      if (!batch) throw new ManualImportUnavailableError('Manual import batch was not found')
      if (batch.state === 'deleted') {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
               FROM appsea.deletion_tombstones
              WHERE workspace_id = $1 AND reason = 'owner-import-batch-deleted'
                AND source_id = 'manual-owner-import'
                AND source_record_id LIKE $2`,
          [workspaceId, `manual:${validatedBatchId}:%`]
        )
        return manualImportDeletionResultSchema.parse({
          batchId: validatedBatchId,
          state: 'deleted',
          tombstoneCount: Number(count.rows[0]?.count ?? 0),
          replayed: true
        })
      }
      if (!['staged', 'consumed'].includes(batch.state)) {
        throw new ManualImportUnavailableError(
          'Manual import batch cannot be deleted in its current state'
        )
      }
      const records = await client.query<Pick<RecordRow, 'source_record_id'>>(
        `SELECT source_record_id
             FROM appsea.manual_import_records
            WHERE workspace_id = $1 AND batch_id = $2
            ORDER BY record_ordinal ASC
            FOR UPDATE`,
        [workspaceId, validatedBatchId]
      )
      let tombstoneCount = 0
      for (const record of records.rows) {
        const sourceRecordId = scopedSourceRecordId(validatedBatchId, record.source_record_id)
        const tombstoneId = hashIdentifier('manual-tombstone', {
          sourceId: 'manual-owner-import',
          sourceRecordId,
          reason: 'owner-import-batch-deleted'
        })
        await client.query(
          `INSERT INTO appsea.deletion_tombstones
               (workspace_id, tombstone_id, source_id, source_record_id, reason, state, received_at)
             VALUES ($1, $2, 'manual-owner-import', $3, 'owner-import-batch-deleted', 'pending', $4)
             ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING`,
          [workspaceId, tombstoneId, sourceRecordId, occurredAt]
        )
        tombstoneCount += 1
      }
      // Clear normalized staged payloads before changing the batch state; the
      // record trigger therefore still sees the pre-deletion state.
      await client.query(
        `UPDATE appsea.manual_import_records
              SET record_payload = NULL, deleted_at = $3
            WHERE workspace_id = $1 AND batch_id = $2`,
        [workspaceId, validatedBatchId, occurredAt]
      )
      await client.query(
        `UPDATE appsea.manual_import_batches
              SET state = 'deleted', deleted_at = $3
            WHERE workspace_id = $1 AND batch_id = $2`,
        [workspaceId, validatedBatchId, occurredAt]
      )
      await client.query(
        `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
              target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'user', $3, 'research.manual_import.deleted',
                   'manual_import_batch', $4, $4, $5::jsonb, $6)
           ON CONFLICT DO NOTHING`,
        [
          workspaceId,
          hashIdentifier('audit', { batchId: validatedBatchId, action: 'deleted' }),
          userId,
          validatedBatchId,
          JSON.stringify({ tombstoneCount, stagedPayloadPurged: true }),
          occurredAt
        ]
      )
      return manualImportDeletionResultSchema.parse({
        batchId: validatedBatchId,
        state: 'deleted',
        tombstoneCount,
        replayed: false
      })
    })
  }
}
