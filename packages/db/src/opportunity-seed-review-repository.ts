import {
  appseaIdentifierSchema,
  workspaceOpportunitySeedApprovalInputSchema,
  workspaceOpportunitySeedCreateInputSchema,
  workspaceOpportunitySeedReadModelSchema,
  type WorkspaceOpportunitySeedApprovalInput,
  type WorkspaceOpportunitySeedCreateInput,
  type WorkspaceOpportunitySeedReadModel
} from '@appsea/contracts'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { contentHash } from './hash'
import {
  withAuthenticatedWorkspaceTransaction,
  withWorkspaceTransaction,
  type WorkspaceTransactionOptions
} from './transaction'

interface SeedReviewRow extends QueryResultRow {
  workspace_id: string
  seed_review_id: string
  seed_version: string
  seed_payload: unknown
  content_hash: string
  review_state: 'unreviewed' | 'reviewed' | 'approved' | 'withdrawn'
  created_by: string
  reviewed_by: string | null
  reviewed_at: Date | string | null
  approved_by: string | null
  approved_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

export class OpportunitySeedReviewNotFoundError extends Error {
  constructor() {
    super('Opportunity seed review was not found')
    this.name = 'OpportunitySeedReviewNotFoundError'
  }
}

export class OpportunitySeedReviewPermissionError extends Error {
  constructor() {
    super('Opportunity seed review requires an editor or owner')
    this.name = 'OpportunitySeedReviewPermissionError'
  }
}

export class OpportunitySeedReviewConflictError extends Error {
  constructor() {
    super('Opportunity seed review transition or identifier conflicts with existing state')
    this.name = 'OpportunitySeedReviewConflictError'
  }
}

export class OpportunitySeedReviewLineageError extends Error {
  constructor() {
    super('Opportunity seed review is not an approved immutable workspace record')
    this.name = 'OpportunitySeedReviewLineageError'
  }
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

const selectColumns = `
  SELECT workspace_id, seed_review_id, seed_version, seed_payload, content_hash,
         review_state, created_by, reviewed_by, reviewed_at, approved_by,
         approved_at, created_at, updated_at
    FROM appsea.opportunity_seed_reviews`

function readModel(row: SeedReviewRow): WorkspaceOpportunitySeedReadModel {
  const seed = workspaceOpportunitySeedReadModelSchema.shape.seed.parse(row.seed_payload)
  const expectedHash = contentHash(seed)
  if (row.content_hash !== expectedHash) throw new OpportunitySeedReviewLineageError()
  return workspaceOpportunitySeedReadModelSchema.parse({
    seedReviewId: row.seed_review_id,
    seedVersion: row.seed_version,
    seed,
    contentHash: row.content_hash,
    reviewState: row.review_state,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at === null ? null : asIso(row.reviewed_at),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at === null ? null : asIso(row.approved_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  })
}

async function actorRole(client: PoolClient, workspaceId: string, userId: string): Promise<string> {
  const result = await client.query<{ role: string }>(
    `SELECT role
       FROM appsea.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2
      FOR SHARE`,
    [workspaceId, userId]
  )
  return result.rows[0]?.role ?? ''
}

function writeOptions(): WorkspaceTransactionOptions {
  return { isolationLevel: 'SERIALIZABLE' }
}

export class PostgresOpportunitySeedReviewRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    userId: string,
    workspaceId: string,
    input: WorkspaceOpportunitySeedCreateInput
  ): Promise<WorkspaceOpportunitySeedReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInput = workspaceOpportunitySeedCreateInputSchema.parse(input)
    const seedContentHash = contentHash(parsedInput.seed)
    const now = new Date().toISOString()

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
          if (role !== 'owner' && role !== 'editor') {
            throw new OpportunitySeedReviewPermissionError()
          }
          const workspace = await client.query<{ fixture_only: boolean; visibility: string }>(
            `SELECT fixture_only, visibility
               FROM appsea.workspaces
              WHERE workspace_id = $1
                AND status = 'active'`,
            [parsedWorkspaceId]
          )
          if (
            workspace.rows[0]?.fixture_only !== false ||
            workspace.rows[0]?.visibility !== 'private'
          ) {
            throw new OpportunitySeedReviewPermissionError()
          }
          const inserted = await client.query<SeedReviewRow>(
            `INSERT INTO appsea.opportunity_seed_reviews
               (workspace_id, seed_review_id, seed_version, seed_payload, content_hash,
                review_state, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, 'unreviewed', $6, $7, $7)
             RETURNING workspace_id, seed_review_id, seed_version, seed_payload, content_hash,
                       review_state, created_by, reviewed_by, reviewed_at, approved_by,
                       approved_at, created_at, updated_at`,
            [
              parsedWorkspaceId,
              parsedInput.seedReviewId,
              parsedInput.seedVersion,
              JSON.stringify(parsedInput.seed),
              seedContentHash,
              parsedUserId,
              now
            ]
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('Opportunity seed review was not created')
          return readModel(row)
        },
        writeOptions()
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new OpportunitySeedReviewConflictError()
      throw error
    }
  }

  async readForUser(
    userId: string,
    workspaceId: string,
    seedReviewId: string
  ): Promise<WorkspaceOpportunitySeedReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedSeedReviewId = appseaIdentifierSchema.parse(seedReviewId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<SeedReviewRow>(
          `${selectColumns}
            WHERE workspace_id = $1 AND seed_review_id = $2`,
          [parsedWorkspaceId, parsedSeedReviewId]
        )
        const row = result.rows[0]
        return row ? readModel(row) : null
      },
      { readOnly: true }
    )
  }

  async listForUser(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceOpportunitySeedReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<SeedReviewRow>(
          `${selectColumns}
            WHERE workspace_id = $1
            ORDER BY updated_at DESC, seed_review_id`,
          [parsedWorkspaceId]
        )
        return result.rows.map(readModel)
      },
      { readOnly: true }
    )
  }

  async readApprovedForUser(
    userId: string,
    workspaceId: string,
    seedReviewId: string
  ): Promise<WorkspaceOpportunitySeedReadModel | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedSeedReviewId = appseaIdentifierSchema.parse(seedReviewId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<SeedReviewRow>(
          `${selectColumns}
            WHERE workspace_id = $1
              AND seed_review_id = $2
              AND review_state = 'approved'`,
          [parsedWorkspaceId, parsedSeedReviewId]
        )
        const row = result.rows[0]
        return row ? readModel(row) : null
      },
      { readOnly: true }
    )
  }

  /** Worker-only read used by the durable post-collection handoff. */
  async readApprovedForWorker(
    workspaceId: string,
    seedReviewId: string
  ): Promise<WorkspaceOpportunitySeedReadModel | null> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedSeedReviewId = appseaIdentifierSchema.parse(seedReviewId)
    return withWorkspaceTransaction(
      this.pool,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<SeedReviewRow>(
          `${selectColumns}
            WHERE workspace_id = $1
              AND seed_review_id = $2
              AND review_state = 'approved'`,
          [parsedWorkspaceId, parsedSeedReviewId]
        )
        const row = result.rows[0]
        return row ? readModel(row) : null
      },
      { readOnly: true }
    )
  }

  async updateApproval(
    userId: string,
    workspaceId: string,
    seedReviewId: string,
    input: WorkspaceOpportunitySeedApprovalInput
  ): Promise<WorkspaceOpportunitySeedReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedSeedReviewId = appseaIdentifierSchema.parse(seedReviewId)
    const parsedInput = workspaceOpportunitySeedApprovalInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
          if (
            (parsedInput.action === 'reviewed' && role !== 'owner' && role !== 'editor') ||
            (parsedInput.action !== 'reviewed' && role !== 'owner')
          ) {
            throw new OpportunitySeedReviewPermissionError()
          }
          const existing = await client.query<SeedReviewRow>(
            `${selectColumns}
              WHERE workspace_id = $1 AND seed_review_id = $2
              FOR UPDATE`,
            [parsedWorkspaceId, parsedSeedReviewId]
          )
          const row = existing.rows[0]
          if (!row) throw new OpportunitySeedReviewNotFoundError()
          if (row.review_state === parsedInput.action) return readModel(row)

          const allowed =
            (row.review_state === 'unreviewed' && parsedInput.action === 'reviewed') ||
            (row.review_state === 'reviewed' && parsedInput.action === 'approved') ||
            (row.review_state !== 'withdrawn' && parsedInput.action === 'withdrawn')
          if (!allowed) throw new OpportunitySeedReviewConflictError()

          const updated = await client.query<SeedReviewRow>(
            `UPDATE appsea.opportunity_seed_reviews
                SET review_state = $3,
                    reviewed_by = CASE WHEN $3 = 'reviewed' THEN $4 ELSE reviewed_by END,
                    reviewed_at = CASE WHEN $3 = 'reviewed' THEN clock_timestamp() ELSE reviewed_at END,
                    approved_by = CASE WHEN $3 = 'approved' THEN $4 ELSE approved_by END,
                    approved_at = CASE WHEN $3 = 'approved' THEN clock_timestamp() ELSE approved_at END,
                    updated_at = clock_timestamp()
              WHERE workspace_id = $1 AND seed_review_id = $2
            RETURNING workspace_id, seed_review_id, seed_version, seed_payload, content_hash,
                      review_state, created_by, reviewed_by, reviewed_at, approved_by,
                      approved_at, created_at, updated_at`,
            [parsedWorkspaceId, parsedSeedReviewId, parsedInput.action, parsedUserId]
          )
          const updatedRow = updated.rows[0]
          if (!updatedRow) throw new OpportunitySeedReviewNotFoundError()
          return readModel(updatedRow)
        },
        writeOptions()
      )
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === '23514'
      ) {
        throw new OpportunitySeedReviewConflictError()
      }
      throw error
    }
  }
}
