import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  evidenceRedactionMarker,
  workspaceClusterReadModelSchema,
  workspaceClusterReviewInputSchema,
  workspaceClusterReviewReadModelSchema,
  workspaceClusterReviewSnapshotSchema,
  type WorkspaceClusterReadModel,
  type WorkspaceClusterReviewInput,
  type WorkspaceClusterReviewReadModel
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

interface ClusterRow extends QueryResultRow {
  cluster_version_id: string
  cluster_id: string
  opportunity_id: string
  run_id: string
  cluster_version: string
  working_label: string
  problem_statement: string
  product: string
  category: string
  complaint_count: number | string
  unique_observation_count: number | string
  source_count: number | string
  confidence: number | string
  review_state: WorkspaceClusterReadModel['reviewState']
  input_hash: string
  synthetic: boolean
  redacted: boolean
}

interface MembershipRow extends QueryResultRow {
  cluster_version_id: string
  complaint_id: string
  membership_confidence: number | string
  inclusion_reason: string
  review_state: WorkspaceClusterReadModel['memberships'][number]['reviewState']
}

interface ReviewRow extends QueryResultRow {
  review_id: string
  cluster_version_id: string
  opportunity_id: string
  action: WorkspaceClusterReviewReadModel['action']
  previous_state: WorkspaceClusterReviewReadModel['previousReviewState']
  next_state: WorkspaceClusterReviewReadModel['nextReviewState']
  note: string
  related_cluster_version_ids: string[]
  actor_id: string
  review_snapshot: unknown
  created_at: Date | string
  request_hash?: string
}

interface CurrentClusterRow extends QueryResultRow {
  cluster_version_id: string
  cluster_id: string
  opportunity_id: string
  run_id: string
  review_state: WorkspaceClusterReadModel['reviewState']
  input_hash: string
  synthetic: boolean
}

export class ClusterReviewNotFoundError extends Error {
  constructor() {
    super('The complaint cluster was not found')
    this.name = 'ClusterReviewNotFoundError'
  }
}

export class ClusterReviewPermissionError extends Error {
  constructor() {
    super('Cluster reviews require an editor or owner')
    this.name = 'ClusterReviewPermissionError'
  }
}

export class ClusterReviewConflictError extends Error {
  constructor(message = 'The cluster review conflicts with the current snapshot') {
    super(message)
    this.name = 'ClusterReviewConflictError'
  }
}

export class ClusterReviewBlockedError extends Error {
  constructor(message = 'This cluster cannot be curated') {
    super(message)
    this.name = 'ClusterReviewBlockedError'
  }
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Stored cluster review time is invalid')
  return date.toISOString()
}

function numberValue(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function bounded(value: string, max: number): string {
  const result = value.trim().slice(0, max)
  return result || evidenceRedactionMarker
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '40001'
}

function isPolicyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42501'
}

function isIntegrityViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23514'
}

function parseReview(row: ReviewRow): WorkspaceClusterReviewReadModel {
  return workspaceClusterReviewReadModelSchema.parse({
    reviewId: row.review_id,
    clusterVersionId: row.cluster_version_id,
    opportunityId: row.opportunity_id,
    action: row.action,
    previousReviewState: row.previous_state,
    nextReviewState: row.next_state,
    note: row.note,
    relatedClusterVersionIds: row.related_cluster_version_ids,
    actorId: row.actor_id,
    snapshot: workspaceClusterReviewSnapshotSchema.parse(row.review_snapshot),
    createdAt: iso(row.created_at)
  })
}

function reviewSelect(): string {
  return `SELECT review_id, cluster_version_id, opportunity_id, action,
                 previous_state, next_state, note, related_cluster_version_ids,
                 actor_id, review_snapshot, created_at`
}

async function actorRole(client: PoolClient, workspaceId: string, userId: string): Promise<string> {
  const result = await client.query<{ role: string }>(
    `SELECT role
       FROM appsea.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  )
  return result.rows[0]?.role ?? ''
}

async function readClusters(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<WorkspaceClusterReadModel[]> {
  const clusters = await client.query<ClusterRow>(
    `SELECT cluster.cluster_version_id, cluster.cluster_id,
            relation.opportunity_id, cluster.run_id, cluster.cluster_version,
            cluster.working_label, cluster.problem_statement, cluster.product,
            cluster.category, cluster.complaint_count,
            cluster.unique_observation_count, cluster.source_count,
            cluster.confidence, cluster.review_state, cluster.input_hash,
            cluster.synthetic,
            EXISTS (
              SELECT 1
                FROM appsea.cluster_memberships membership
                JOIN appsea.complaint_observations complaint
                  ON complaint.workspace_id = membership.workspace_id
                 AND complaint.complaint_id = membership.complaint_id
                JOIN appsea.evidence_records evidence
                  ON evidence.workspace_id = complaint.workspace_id
                 AND evidence.evidence_id = complaint.evidence_id
                JOIN appsea.source_items source_item
                  ON source_item.workspace_id = evidence.workspace_id
                 AND source_item.source_item_id = evidence.source_item_id
               WHERE membership.workspace_id = cluster.workspace_id
                 AND membership.cluster_version_id = cluster.cluster_version_id
                 AND (evidence.redacted
                      OR evidence.redacted_fields && ARRAY['text','product','company','feature','category']::text[]
                      OR source_item.redacted_fields && ARRAY['text','product','company','feature','category']::text[])
            ) AS redacted
       FROM appsea.opportunity_clusters relation
       JOIN appsea.opportunities opportunity
         ON opportunity.workspace_id = relation.workspace_id
        AND opportunity.opportunity_id = relation.opportunity_id
       JOIN appsea.complaint_cluster_versions cluster
         ON cluster.workspace_id = relation.workspace_id
        AND cluster.cluster_version_id = relation.cluster_version_id
        AND cluster.run_id = opportunity.source_run_id
      WHERE relation.workspace_id = $1
        AND relation.opportunity_id = $2
      ORDER BY cluster.created_at, cluster.cluster_version_id
      LIMIT 2_000`,
    [workspaceId, opportunityId]
  )
  if (clusters.rows.length === 0) return []
  const ids = clusters.rows.map((row) => row.cluster_version_id)
  const memberships = await client.query<MembershipRow>(
    `SELECT cluster_version_id, complaint_id, membership_confidence,
            inclusion_reason, review_state
       FROM appsea.cluster_memberships
      WHERE workspace_id = $1
        AND cluster_version_id = ANY($2::text[])
      ORDER BY cluster_version_id, complaint_id
      LIMIT 100000`,
    [workspaceId, ids]
  )
  const reviews = await client.query<ReviewRow>(
    `${reviewSelect()}
       FROM appsea.cluster_review_events
      WHERE workspace_id = $1
        AND cluster_version_id = ANY($2::text[])
      ORDER BY created_at DESC, review_id DESC
      LIMIT 100000`,
    [workspaceId, ids]
  )
  const membershipByCluster = new Map<string, WorkspaceClusterReadModel['memberships']>()
  for (const row of memberships.rows) {
    const list = membershipByCluster.get(row.cluster_version_id) ?? []
    list.push({
      complaintId: row.complaint_id,
      membershipConfidence: numberValue(row.membership_confidence),
      inclusionReason: bounded(row.inclusion_reason, 2_000),
      reviewState: row.review_state
    })
    membershipByCluster.set(row.cluster_version_id, list)
  }
  const historyByCluster = new Map<string, WorkspaceClusterReviewReadModel[]>()
  for (const row of reviews.rows) {
    const list = historyByCluster.get(row.cluster_version_id) ?? []
    list.push(parseReview(row))
    historyByCluster.set(row.cluster_version_id, list)
  }
  return clusters.rows.map((row) => {
    const redacted = Boolean(row.redacted)
    return workspaceClusterReadModelSchema.parse({
      clusterVersionId: row.cluster_version_id,
      clusterId: row.cluster_id,
      opportunityId: row.opportunity_id,
      runId: row.run_id,
      clusterVersion: bounded(row.cluster_version, 80),
      workingLabel: redacted ? evidenceRedactionMarker : bounded(row.working_label, 2_000),
      problemStatement: redacted ? evidenceRedactionMarker : bounded(row.problem_statement, 20_000),
      product: redacted ? evidenceRedactionMarker : bounded(row.product, 240),
      category: redacted ? evidenceRedactionMarker : bounded(row.category, 240),
      complaintCount: numberValue(row.complaint_count),
      uniqueObservationCount: numberValue(row.unique_observation_count),
      sourceCount: numberValue(row.source_count),
      confidence: numberValue(row.confidence),
      reviewState: row.review_state,
      inputHash: row.input_hash,
      synthetic: row.synthetic,
      redacted,
      memberships: membershipByCluster.get(row.cluster_version_id) ?? [],
      reviewHistory: historyByCluster.get(row.cluster_version_id) ?? []
    })
  })
}

export class PostgresClusterReviewRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<WorkspaceClusterReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      (client) => readClusters(client, parsedWorkspaceId, parsedOpportunityId),
      { readOnly: true }
    )
  }

  async createForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string,
    clusterVersionId: string,
    input: WorkspaceClusterReviewInput,
    idempotencyKey: string
  ): Promise<WorkspaceClusterReviewReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    const parsedClusterVersionId = appseaIdentifierSchema.parse(clusterVersionId)
    const parsedInput = workspaceClusterReviewInputSchema.parse(input)
    const parsedIdempotencyKey = idempotencyKey.trim()
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(parsedIdempotencyKey)) {
      throw new ClusterReviewConflictError('A valid idempotency key is required')
    }
    const requestDigest = contentHash({
      workspaceId: parsedWorkspaceId,
      opportunityId: parsedOpportunityId,
      clusterVersionId: parsedClusterVersionId,
      ...parsedInput
    })
    const reviewId = `cluster-review:${contentHash({ parsedWorkspaceId, parsedOpportunityId, parsedClusterVersionId, parsedIdempotencyKey }).slice(0, 32)}`

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
          if (role !== 'owner' && role !== 'editor') throw new ClusterReviewPermissionError()

          const existing = await client.query<ReviewRow>(
            `${reviewSelect()}, request_hash
               FROM appsea.cluster_review_events
              WHERE workspace_id = $1 AND idempotency_key = $2`,
            [parsedWorkspaceId, parsedIdempotencyKey]
          )
          if (existing.rows[0]) {
            const row = existing.rows[0]
            if (row.actor_id !== parsedUserId || row.request_hash !== requestDigest) {
              throw new ClusterReviewConflictError(
                'The idempotency key is already bound to a different cluster review'
              )
            }
            return parseReview(row)
          }

          const current = await client.query<CurrentClusterRow>(
            `SELECT cluster.cluster_version_id, cluster.cluster_id,
                    relation.opportunity_id, cluster.run_id, cluster.review_state,
                    cluster.input_hash, cluster.synthetic
               FROM appsea.opportunity_clusters relation
               JOIN appsea.opportunities opportunity
                 ON opportunity.workspace_id = relation.workspace_id
                AND opportunity.opportunity_id = relation.opportunity_id
               JOIN appsea.complaint_cluster_versions cluster
                 ON cluster.workspace_id = relation.workspace_id
                AND cluster.cluster_version_id = relation.cluster_version_id
                AND cluster.run_id = opportunity.source_run_id
              WHERE relation.workspace_id = $1
                AND relation.opportunity_id = $2
                AND relation.cluster_version_id = $3
                AND opportunity.availability_state = 'active'
              FOR UPDATE OF cluster`,
            [parsedWorkspaceId, parsedOpportunityId, parsedClusterVersionId]
          )
          const cluster = current.rows[0]
          if (!cluster) throw new ClusterReviewNotFoundError()
          if (cluster.synthetic)
            throw new ClusterReviewBlockedError('Fixture clusters are read-only')
          if (cluster.review_state !== 'provisional' && cluster.review_state !== 'reviewed') {
            throw new ClusterReviewBlockedError(
              'This cluster has already reached a terminal review state'
            )
          }
          if (cluster.input_hash !== parsedInput.expectedInputHash) {
            throw new ClusterReviewConflictError('The cluster changed; refresh before reviewing it')
          }
          const nextState = {
            confirm: 'confirmed',
            reject: 'rejected',
            split: 'split',
            merge: 'merged'
          }[parsedInput.action] as WorkspaceClusterReviewReadModel['nextReviewState']
          const membershipResult = await client.query<
            QueryResultRow & {
              complaint_id: string
              review_state: WorkspaceClusterReadModel['memberships'][number]['reviewState']
            }
          >(
            `SELECT complaint_id, review_state
               FROM appsea.cluster_memberships
              WHERE workspace_id = $1 AND cluster_version_id = $2
              ORDER BY complaint_id
              LIMIT 5_000`,
            [parsedWorkspaceId, parsedClusterVersionId]
          )
          if (parsedInput.action === 'split' || parsedInput.action === 'merge') {
            const related = await client.query<{ cluster_version_id: string }>(
              `SELECT cluster_version_id
                 FROM appsea.research_run_cluster_versions
                WHERE workspace_id = $1
                  AND opportunity_id = $2
                  AND run_id = $3
                  AND cluster_version_id = ANY($4::text[])
                ORDER BY cluster_version_id`,
              [
                parsedWorkspaceId,
                parsedOpportunityId,
                cluster.run_id,
                parsedInput.relatedClusterVersionIds
              ]
            )
            if (related.rows.length !== parsedInput.relatedClusterVersionIds.length) {
              throw new ClusterReviewConflictError(
                'Every related cluster must belong to the same opportunity run'
              )
            }
          }
          const snapshotMaterial = {
            workspaceId: parsedWorkspaceId,
            clusterVersionId: parsedClusterVersionId,
            clusterId: cluster.cluster_id,
            opportunityId: parsedOpportunityId,
            runId: cluster.run_id,
            previousReviewState: cluster.review_state,
            nextReviewState: nextState,
            inputHash: cluster.input_hash,
            complaintIds: membershipResult.rows.map((row) => row.complaint_id),
            membershipReviewStates: membershipResult.rows.map((row) => ({
              complaintId: row.complaint_id,
              reviewState: row.review_state
            })),
            relatedClusterVersionIds: parsedInput.relatedClusterVersionIds
          }
          const snapshot = workspaceClusterReviewSnapshotSchema.parse({
            ...snapshotMaterial,
            snapshotHash: contentHash(snapshotMaterial),
            capturedAt: new Date().toISOString()
          })
          const inserted = await client.query<ReviewRow>(
            `INSERT INTO appsea.cluster_review_events
               (workspace_id, review_id, opportunity_id, cluster_version_id,
                idempotency_key, request_hash, actor_id, action, previous_state,
                next_state, expected_input_hash, note,
                related_cluster_version_ids, review_snapshot,
                review_snapshot_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14::jsonb, $15, clock_timestamp())
             RETURNING ${reviewSelect()}`,
            [
              parsedWorkspaceId,
              reviewId,
              parsedOpportunityId,
              parsedClusterVersionId,
              parsedIdempotencyKey,
              requestDigest,
              parsedUserId,
              parsedInput.action,
              cluster.review_state,
              nextState,
              cluster.input_hash,
              parsedInput.note,
              parsedInput.relatedClusterVersionIds,
              JSON.stringify(snapshot),
              snapshot.snapshotHash
            ]
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('Cluster review was not created')
          return parseReview(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new ClusterReviewConflictError()
      if (isSerializationConflict(error)) {
        throw new ClusterReviewConflictError('The cluster changed; refresh before reviewing it')
      }
      if (isPolicyViolation(error)) throw new ClusterReviewPermissionError()
      if (isIntegrityViolation(error)) throw new ClusterReviewConflictError()
      throw error
    }
  }
}
