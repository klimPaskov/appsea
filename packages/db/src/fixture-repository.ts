import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  fixturePersistenceInputSchema,
  fixturePersistenceReadModelSchema,
  fixturePersistenceResultSchema,
  fixtureResearchArtifactSchema,
  opportunitySchema,
  planPackageSchema,
  type FixturePersistenceInput,
  type FixturePersistenceReadModel,
  type FixturePersistenceResult,
  type Opportunity
} from '@appsea/contracts'
import { assertDeterministicScoreSnapshot } from '@appsea/scoring'
import { generateOpportunityReport } from '@appsea/reports'
import { contentHash } from './hash'
import { withWorkspaceTransaction } from './transaction'

const fixtureNormalizerVersion = 'fixture-normalizer-v1'
const fixtureExtractionVersion = 'fixture-extractor-v1'
const fixtureClusterVersion = 'fixture-cluster-v1'
const fixturePlanVersion = 'fixture-plan-v1'

export class ImmutableRecordConflictError extends Error {
  constructor(recordType: string, identifier: string) {
    super(`${recordType} ${identifier} already exists with different immutable content`)
    this.name = 'ImmutableRecordConflictError'
  }
}

export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used for different input`)
    this.name = 'IdempotencyConflictError'
  }
}

function asIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function hashedIdentifier(prefix: string, value: unknown): string {
  return `${prefix}:${contentHash(value).slice(0, 32)}`
}

function workspaceSlug(workspaceId: string): string {
  return workspaceId
    .replace(/[_:]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function assertStoredHash(
  client: PoolClient,
  sql: string,
  parameters: unknown[],
  expectedHash: string,
  recordType: string,
  identifier: string
): Promise<void> {
  const result = await client.query<{ content_hash: string }>(sql, parameters)
  const stored = result.rows[0]
  if (!stored || stored.content_hash !== expectedHash) {
    throw new ImmutableRecordConflictError(recordType, identifier)
  }
}

interface ExistingRunRow extends QueryResultRow {
  run_id: string
  input_hash: string
  state: string
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    [
      'research_runs_workspace_id_idempotency_key_key',
      'research_runs_pkey',
      'workspaces_slug_key'
    ].includes(String(error.constraint))
  )
}

interface CurrentIdentifiersRow extends QueryResultRow {
  opportunity_id: string
  score_snapshot_id: string
  plan_package_id: string
}

interface CountRow extends QueryResultRow {
  count: string
}

interface CompletedRunRow extends QueryResultRow {
  artifact_id: string
  completed_at: Date | string
}

export interface CompletedFixtureRunIdentity {
  campaignId: string
  idempotencyKey: string
  inputHash: string
}

async function countRows(client: PoolClient, sql: string, parameters: unknown[]): Promise<number> {
  const result = await client.query<CountRow>(sql, parameters)
  return Number(result.rows[0]?.count ?? 0)
}

async function buildPersistenceResult(
  client: PoolClient,
  workspaceId: string,
  campaignId: string,
  runId: string,
  replayed: boolean
): Promise<FixturePersistenceResult> {
  const run = await client.query<CompletedRunRow>(
    `SELECT artifact_id, completed_at
       FROM appsea.research_runs
      WHERE workspace_id = $1 AND run_id = $2 AND state = 'completed'`,
    [workspaceId, runId]
  )
  const completedRun = run.rows[0]
  if (!completedRun) throw new Error(`Completed fixture run ${runId} was not found`)

  const identifiers = await client.query<CurrentIdentifiersRow>(
    `SELECT run_opportunity.opportunity_id,
            run_score.score_snapshot_id,
            run_plan.plan_package_id
       FROM appsea.research_run_opportunities run_opportunity
       JOIN appsea.research_run_score_snapshots run_score
         ON run_score.workspace_id = run_opportunity.workspace_id
        AND run_score.run_id = run_opportunity.run_id
        AND run_score.opportunity_id = run_opportunity.opportunity_id
       JOIN appsea.research_run_plan_packages run_plan
         ON run_plan.workspace_id = run_opportunity.workspace_id
        AND run_plan.run_id = run_opportunity.run_id
        AND run_plan.opportunity_id = run_opportunity.opportunity_id
      WHERE run_opportunity.workspace_id = $1 AND run_opportunity.run_id = $2`,
    [workspaceId, runId]
  )
  const current = identifiers.rows[0]
  if (!current?.score_snapshot_id || !current.plan_package_id) {
    throw new Error(`Fixture opportunity for run ${runId} is incomplete`)
  }

  const sourceItemCount = await countRows(
    client,
    `SELECT count(*)::text AS count
       FROM appsea.research_run_source_items
      WHERE workspace_id = $1 AND run_id = $2`,
    [workspaceId, runId]
  )
  const evidenceCount = await countRows(
    client,
    `SELECT count(*)::text AS count
       FROM appsea.evidence_records evidence
       JOIN appsea.research_run_source_items run_item
         ON run_item.workspace_id = evidence.workspace_id
        AND run_item.source_item_id = evidence.source_item_id
      WHERE run_item.workspace_id = $1 AND run_item.run_id = $2`,
    [workspaceId, runId]
  )
  const complaintCount = await countRows(
    client,
    `SELECT count(*)::text AS count
       FROM appsea.research_run_complaints
      WHERE workspace_id = $1 AND run_id = $2`,
    [workspaceId, runId]
  )
  const clusterCount = await countRows(
    client,
    `SELECT count(*)::text AS count
       FROM appsea.research_run_cluster_versions
      WHERE workspace_id = $1 AND run_id = $2`,
    [workspaceId, runId]
  )
  const competitorCount = await countRows(
    client,
    `SELECT count(*)::text AS count
       FROM appsea.research_run_competitors
      WHERE workspace_id = $1 AND run_id = $2 AND opportunity_id = $3`,
    [workspaceId, runId, current.opportunity_id]
  )

  return fixturePersistenceResultSchema.parse({
    workspaceId,
    campaignId,
    runId,
    artifactId: completedRun.artifact_id,
    opportunityId: current.opportunity_id,
    scoreSnapshotId: current.score_snapshot_id,
    planPackageId: current.plan_package_id,
    sourceItemCount,
    evidenceCount,
    complaintCount,
    clusterCount,
    competitorCount,
    state: 'completed',
    completedAt: asIsoString(completedRun.completed_at),
    replayed
  })
}

function validateFixtureReferences(input: FixturePersistenceInput): void {
  const sourceIds = new Set(input.artifact.sourcePolicies.map((policy) => policy.sourceId))
  const complaintIds = new Set(input.artifact.complaints.map((complaint) => complaint.id))

  for (const complaint of input.artifact.complaints) {
    if (!sourceIds.has(complaint.sourceId)) {
      throw new Error(`Complaint ${complaint.id} references an absent source policy`)
    }
  }
  for (const cluster of input.artifact.clusters) {
    for (const complaintId of cluster.complaintIds) {
      if (!complaintIds.has(complaintId)) {
        throw new Error(`Cluster ${cluster.id} references absent complaint ${complaintId}`)
      }
    }
  }
}

export class PostgresFixtureResearchRepository {
  constructor(private readonly pool: Pool) {}

  async persist(input: FixturePersistenceInput): Promise<FixturePersistenceResult> {
    const parsed = fixturePersistenceInputSchema.parse(input)
    assertDeterministicScoreSnapshot(parsed.artifact.opportunity.scoreSnapshot)
    validateFixtureReferences(parsed)
    const inputHash = contentHash(parsed)

    try {
      return await withWorkspaceTransaction(
        this.pool,
        parsed.workspaceId,
        async (client) => {
          const existingRun = await client.query<ExistingRunRow>(
            `SELECT run_id, input_hash, state
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND idempotency_key = $2`,
            [parsed.workspaceId, parsed.idempotencyKey]
          )
          const existing = existingRun.rows[0]
          if (existing) {
            if (existing.input_hash !== inputHash) {
              throw new IdempotencyConflictError(parsed.idempotencyKey)
            }
            if (existing.state !== 'completed') {
              throw new Error(`Fixture run ${existing.run_id} is ${existing.state}, not completed`)
            }
            return buildPersistenceResult(
              client,
              parsed.workspaceId,
              parsed.campaignId,
              existing.run_id,
              true
            )
          }

          await client.query(
            `INSERT INTO appsea.workspaces
             (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'private', true, 'active', $4, $4)
           ON CONFLICT (workspace_id) DO UPDATE
             SET updated_at = GREATEST(appsea.workspaces.updated_at, EXCLUDED.updated_at)`,
            [
              parsed.workspaceId,
              workspaceSlug(parsed.workspaceId),
              'Fixture research workspace',
              parsed.requestedAt
            ]
          )

          await client.query(
            `INSERT INTO appsea.research_campaigns
             (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic, created_at, updated_at)
           VALUES ($1, $2, $3, 'internal_quality', 'running', $4::jsonb, $5::jsonb, true, $6, $6)
           ON CONFLICT (workspace_id, campaign_id) DO UPDATE
             SET state = 'running', configuration = EXCLUDED.configuration, updated_at = EXCLUDED.updated_at`,
            [
              parsed.workspaceId,
              parsed.campaignId,
              'Deterministic fixture persistence campaign',
              JSON.stringify({ mode: 'fixture', artifactId: parsed.artifact.id }),
              JSON.stringify({
                currency: 'USD',
                hardLimit: 0,
                maxItems: parsed.artifact.complaints.length
              }),
              parsed.requestedAt
            ]
          )

          for (const policy of parsed.artifact.sourcePolicies) {
            const policyHash = contentHash(policy)
            const policyVersion = `fixture-${policyHash.slice(0, 12)}`
            await client.query(
              `SELECT appsea.register_fixture_source_policy(
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13
             )`,
              [
                policy.sourceId,
                policy.displayName,
                policyVersion,
                policy.permittedPurposes,
                policy.accessMethod,
                policy.retentionDays,
                policy.deletionRequired,
                policy.attributionRequired,
                policy.coverageNotes,
                policy.reviewedAt,
                JSON.stringify(policy),
                policyHash,
                parsed.requestedAt
              ]
            )
          }

          await client.query(
            `INSERT INTO appsea.research_runs
             (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
              input_hash, artifact_snapshot, coverage_gaps, warnings, requested_at, started_at)
           VALUES ($1, $2, $3, $4, 'fixture', 'running', $5, $6, $7::jsonb, $8, $9, $10, $10)`,
            [
              parsed.workspaceId,
              parsed.runId,
              parsed.campaignId,
              parsed.idempotencyKey,
              parsed.artifact.id,
              inputHash,
              JSON.stringify(parsed.artifact),
              parsed.artifact.coverageGaps,
              parsed.artifact.warnings,
              parsed.requestedAt
            ]
          )

          const policyVersions = new Map(
            parsed.artifact.sourcePolicies.map((policy) => {
              const hash = contentHash(policy)
              return [policy.sourceId, `fixture-${hash.slice(0, 12)}`]
            })
          )

          for (const [sourceId, policyVersion] of policyVersions) {
            await client.query(
              `INSERT INTO appsea.research_run_source_policies
               (workspace_id, run_id, source_id, policy_version, linked_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, parsed.runId, sourceId, policyVersion, parsed.requestedAt]
            )
          }

          for (const complaint of parsed.artifact.complaints) {
            const analysis = parsed.artifact.analyses.find(
              (candidate) => candidate.complaintId === complaint.id
            )
            if (!analysis) throw new Error(`Missing complaint analysis for ${complaint.id}`)
            const sourceItemId = hashedIdentifier('source-item', {
              sourceId: complaint.sourceId,
              sourceRecordId: complaint.sourceRecordId
            })
            const sourceItemHash = contentHash({
              sourceId: complaint.sourceId,
              sourceRecordId: complaint.sourceRecordId,
              capturedAt: complaint.capturedAt,
              publishedAt: complaint.publishedAt,
              query: complaint.query,
              text: complaint.text,
              synthetic: complaint.synthetic
            })
            const policyVersion = policyVersions.get(complaint.sourceId)
            if (!policyVersion) throw new Error(`Missing policy version for ${complaint.sourceId}`)

            await client.query(
              `INSERT INTO appsea.source_items
               (workspace_id, source_item_id, source_id, source_policy_version, source_record_id,
                query_route, content_hash, captured_at, published_at, synthetic, created_at,
                collection_purpose, requested_display_mode)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $8, 'testing', 'fixture')
             ON CONFLICT (workspace_id, source_id, source_record_id)
               WHERE deletion_state = 'active' DO NOTHING`,
              [
                parsed.workspaceId,
                sourceItemId,
                complaint.sourceId,
                policyVersion,
                complaint.sourceRecordId,
                complaint.query,
                sourceItemHash,
                complaint.capturedAt,
                complaint.publishedAt,
                complaint.synthetic
              ]
            )
            await assertStoredHash(
              client,
              `SELECT content_hash FROM appsea.source_items
              WHERE workspace_id = $1 AND source_id = $2 AND source_record_id = $3`,
              [parsed.workspaceId, complaint.sourceId, complaint.sourceRecordId],
              sourceItemHash,
              'source item',
              `${complaint.sourceId}:${complaint.sourceRecordId}`
            )
            const storedSourceItem = await client.query<{ source_policy_version: string }>(
              `SELECT source_policy_version
               FROM appsea.source_items
              WHERE workspace_id = $1 AND source_id = $2 AND source_record_id = $3`,
              [parsed.workspaceId, complaint.sourceId, complaint.sourceRecordId]
            )
            const acquisitionPolicyVersion = storedSourceItem.rows[0]?.source_policy_version
            if (!acquisitionPolicyVersion) {
              throw new Error(`Stored source item is missing for ${complaint.sourceId}`)
            }
            await client.query(
              `INSERT INTO appsea.research_run_source_policies
               (workspace_id, run_id, source_id, policy_version, linked_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.runId,
                complaint.sourceId,
                acquisitionPolicyVersion,
                parsed.requestedAt
              ]
            )
            await client.query(
              `INSERT INTO appsea.research_run_source_items
               (workspace_id, run_id, source_item_id, source_id, source_policy_version)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.runId,
                sourceItemId,
                complaint.sourceId,
                acquisitionPolicyVersion
              ]
            )

            const evidenceId = `evidence:${complaint.id}`
            const evidenceHash = contentHash({
              sourceItemHash,
              text: complaint.text,
              language: complaint.language,
              allowedRepresentation: complaint.allowedRepresentation,
              redacted: complaint.redacted,
              product: complaint.product,
              company: complaint.company,
              feature: complaint.feature,
              category: complaint.category,
              normalizerVersion: fixtureNormalizerVersion
            })
            await client.query(
              `INSERT INTO appsea.evidence_records
               (workspace_id, evidence_id, source_item_id, normalized_text, language,
                allowed_representation, redacted, synthetic, normalization_version, content_hash,
                product_candidate, company_candidate, feature_candidate, category_candidate,
                policy_flags, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
             ON CONFLICT (workspace_id, evidence_id) DO NOTHING`,
              [
                parsed.workspaceId,
                evidenceId,
                sourceItemId,
                complaint.text,
                complaint.language,
                complaint.allowedRepresentation,
                complaint.redacted,
                complaint.synthetic,
                fixtureNormalizerVersion,
                evidenceHash,
                complaint.product,
                complaint.company,
                complaint.feature,
                complaint.category,
                JSON.stringify({ fixture: true }),
                parsed.requestedAt
              ]
            )
            await assertStoredHash(
              client,
              `SELECT content_hash FROM appsea.evidence_records
              WHERE workspace_id = $1 AND evidence_id = $2`,
              [parsed.workspaceId, evidenceId],
              evidenceHash,
              'evidence record',
              evidenceId
            )

            const complaintHash = contentHash({
              evidenceHash,
              complaint,
              analysis,
              extractionVersion: fixtureExtractionVersion
            })
            await client.query(
              `INSERT INTO appsea.complaint_observations
               (workspace_id, complaint_id, evidence_id, classification, complaint_type,
                problem_statement, affected_workflow, target_product, target_company, target_feature,
                severity, confidence, review_state, extraction_version, synthetic, content_hash,
                analysis_snapshot, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                     $15, $16, $17::jsonb, $18)
             ON CONFLICT (workspace_id, complaint_id) DO NOTHING`,
              [
                parsed.workspaceId,
                complaint.id,
                evidenceId,
                analysis.classification,
                analysis.complaintType,
                analysis.problemStatement,
                analysis.affectedWorkflow,
                analysis.entities.product.canonicalName ?? complaint.product,
                analysis.entities.company.canonicalName ?? complaint.company,
                analysis.entities.feature.canonicalName ?? complaint.feature,
                analysis.severity,
                analysis.classificationConfidence,
                analysis.reviewState,
                analysis.extractionVersion,
                complaint.synthetic,
                complaintHash,
                JSON.stringify(analysis),
                parsed.requestedAt
              ]
            )
            await assertStoredHash(
              client,
              `SELECT content_hash FROM appsea.complaint_observations
              WHERE workspace_id = $1 AND complaint_id = $2`,
              [parsed.workspaceId, complaint.id],
              complaintHash,
              'complaint observation',
              complaint.id
            )
            await client.query(
              `INSERT INTO appsea.research_run_complaints (workspace_id, run_id, complaint_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, parsed.runId, complaint.id]
            )
          }

          const clusterVersionIds: string[] = []
          for (const cluster of parsed.artifact.clusters) {
            const clusterVersionId = `cluster:${contentHash({ runId: parsed.runId, cluster }).slice(0, 32)}`
            const clusterHash = contentHash({ cluster, version: fixtureClusterVersion })
            clusterVersionIds.push(clusterVersionId)
            await client.query(
              `INSERT INTO appsea.complaint_cluster_versions
               (workspace_id, cluster_version_id, cluster_id, run_id, cluster_version,
                working_label, problem_statement, product, category, complaint_count,
                unique_observation_count, source_count, confidence, review_state, input_hash,
                synthetic, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     'provisional', $14, true, $15)`,
              [
                parsed.workspaceId,
                clusterVersionId,
                cluster.id,
                parsed.runId,
                fixtureClusterVersion,
                cluster.title,
                cluster.summary,
                cluster.product,
                cluster.category,
                cluster.complaintIds.length,
                cluster.uniqueObservationCount,
                cluster.sourceCount,
                cluster.confidence,
                clusterHash,
                parsed.requestedAt
              ]
            )
            for (const complaintId of cluster.complaintIds) {
              await client.query(
                `INSERT INTO appsea.cluster_memberships
                 (workspace_id, cluster_version_id, complaint_id, membership_confidence,
                  inclusion_reason, review_state)
               VALUES ($1, $2, $3, $4, $5, 'unreviewed')`,
                [
                  parsed.workspaceId,
                  clusterVersionId,
                  complaintId,
                  cluster.confidence,
                  `Fixture grouping by ${cluster.product} and ${cluster.category}`
                ]
              )
            }
          }

          const opportunity = parsed.artifact.opportunity
          await client.query(
            `INSERT INTO appsea.opportunities
             (workspace_id, opportunity_id, slug, name, one_line, thesis, audience, first_wedge,
              complaint_count, synthetic, tags, contrary_evidence, state, source_run_id,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   'researched', $13, $14, $14)
           ON CONFLICT (workspace_id, opportunity_id) DO UPDATE
             SET slug = EXCLUDED.slug,
                 name = EXCLUDED.name,
                 one_line = EXCLUDED.one_line,
                 thesis = EXCLUDED.thesis,
                 audience = EXCLUDED.audience,
                 first_wedge = EXCLUDED.first_wedge,
                 complaint_count = EXCLUDED.complaint_count,
                 tags = EXCLUDED.tags,
                 contrary_evidence = EXCLUDED.contrary_evidence,
                 source_run_id = EXCLUDED.source_run_id,
                 updated_at = EXCLUDED.updated_at`,
            [
              parsed.workspaceId,
              opportunity.id,
              opportunity.slug,
              opportunity.name,
              opportunity.oneLine,
              opportunity.thesis,
              opportunity.audience,
              opportunity.firstWedge,
              opportunity.complaintCount,
              opportunity.synthetic,
              opportunity.tags,
              opportunity.contraryEvidence,
              parsed.runId,
              parsed.requestedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.research_run_opportunities
             (workspace_id, run_id, opportunity_id, linked_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
            [parsed.workspaceId, parsed.runId, opportunity.id, parsed.requestedAt]
          )

          await client.query(
            `DELETE FROM appsea.opportunity_clusters
            WHERE workspace_id = $1 AND opportunity_id = $2`,
            [parsed.workspaceId, opportunity.id]
          )
          await client.query(
            `DELETE FROM appsea.opportunity_competitors
            WHERE workspace_id = $1 AND opportunity_id = $2`,
            [parsed.workspaceId, opportunity.id]
          )

          for (const clusterVersionId of clusterVersionIds) {
            await client.query(
              `INSERT INTO appsea.opportunity_clusters
               (workspace_id, opportunity_id, cluster_version_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, opportunity.id, clusterVersionId]
            )
            await client.query(
              `INSERT INTO appsea.research_run_cluster_versions
               (workspace_id, run_id, opportunity_id, cluster_version_id, linked_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.runId,
                opportunity.id,
                clusterVersionId,
                parsed.requestedAt
              ]
            )
          }

          for (const competitor of opportunity.competitors) {
            const competitorId = hashedIdentifier('competitor', {
              name: competitor.name,
              type: competitor.type
            })
            const competitorHash = contentHash(competitor)
            await client.query(
              `INSERT INTO appsea.competitors
               (workspace_id, competitor_id, name, competitor_type, positioning, strengths,
                weaknesses, related_complaint_categories, synthetic, content_hash, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
             ON CONFLICT (workspace_id, competitor_id) DO NOTHING`,
              [
                parsed.workspaceId,
                competitorId,
                competitor.name,
                competitor.type,
                competitor.positioning,
                competitor.strengths,
                competitor.weaknesses,
                competitor.relatedComplaintCategories,
                competitorHash,
                parsed.requestedAt
              ]
            )
            await assertStoredHash(
              client,
              `SELECT content_hash FROM appsea.competitors
              WHERE workspace_id = $1 AND competitor_id = $2`,
              [parsed.workspaceId, competitorId],
              competitorHash,
              'competitor',
              competitorId
            )
            await client.query(
              `INSERT INTO appsea.opportunity_competitors
               (workspace_id, opportunity_id, competitor_id, relation_type, confidence)
             VALUES ($1, $2, $3, $4, 0.7000)
             ON CONFLICT DO NOTHING`,
              [parsed.workspaceId, opportunity.id, competitorId, competitor.type]
            )
            await client.query(
              `INSERT INTO appsea.research_run_competitors
               (workspace_id, run_id, opportunity_id, competitor_id, relation_type,
                confidence, linked_at)
             VALUES ($1, $2, $3, $4, $5, 0.7000, $6)
             ON CONFLICT DO NOTHING`,
              [
                parsed.workspaceId,
                parsed.runId,
                opportunity.id,
                competitorId,
                competitor.type,
                parsed.requestedAt
              ]
            )
          }

          const scoreInputHash = contentHash({
            runId: parsed.runId,
            complaintIds: opportunity.complaintIds,
            clusterVersionIds,
            scoreSnapshot: opportunity.scoreSnapshot
          })
          const scoreSnapshotId = `score:${scoreInputHash.slice(0, 32)}`
          await client.query(
            `INSERT INTO appsea.opportunity_score_snapshots
             (workspace_id, score_snapshot_id, opportunity_id, scoring_version, score,
              factors, weights, input_hash, explanation, calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10)
           ON CONFLICT (workspace_id, score_snapshot_id) DO NOTHING`,
            [
              parsed.workspaceId,
              scoreSnapshotId,
              opportunity.id,
              opportunity.scoreSnapshot.version,
              opportunity.scoreSnapshot.score,
              JSON.stringify(opportunity.scoreSnapshot.factors),
              JSON.stringify(opportunity.scoreSnapshot.weights),
              scoreInputHash,
              JSON.stringify({ fixture: true, contraryEvidence: opportunity.contraryEvidence }),
              opportunity.scoreSnapshot.calculatedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT input_hash AS content_hash FROM appsea.opportunity_score_snapshots
            WHERE workspace_id = $1 AND score_snapshot_id = $2`,
            [parsed.workspaceId, scoreSnapshotId],
            scoreInputHash,
            'score snapshot',
            scoreSnapshotId
          )
          await client.query(
            `INSERT INTO appsea.research_run_score_snapshots
             (workspace_id, run_id, opportunity_id, score_snapshot_id, linked_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
            [parsed.workspaceId, parsed.runId, opportunity.id, scoreSnapshotId, parsed.requestedAt]
          )

          const report = generateOpportunityReport(parsed.artifact, parsed.requestedAt)
          const reportManifestHash = contentHash(report)
          const reportId = hashedIdentifier('report', {
            opportunityId: opportunity.id,
            manifestHash: reportManifestHash
          })
          await client.query(
            `INSERT INTO appsea.report_versions
             (workspace_id, report_id, opportunity_id, version, evidence_snapshot_ref,
              structured_report, manifest_hash, approval_state, generated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'draft', $8)
            ON CONFLICT (workspace_id, report_id) DO NOTHING`,
            [
              parsed.workspaceId,
              reportId,
              opportunity.id,
              'fixture-report-v1',
              `research-run:${parsed.runId}`,
              JSON.stringify(report),
              reportManifestHash,
              parsed.requestedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT manifest_hash AS content_hash FROM appsea.report_versions
              WHERE workspace_id = $1 AND report_id = $2`,
            [parsed.workspaceId, reportId],
            reportManifestHash,
            'report',
            reportId
          )

          const planManifestHash = contentHash(parsed.planPackage)
          const planPackageId = hashedIdentifier('plan', {
            opportunityId: opportunity.id,
            manifestHash: planManifestHash
          })
          await client.query(
            `INSERT INTO appsea.plan_package_versions
             (workspace_id, plan_package_id, opportunity_id, run_id, report_id, version,
               manifest_hash, fixture_files, readiness_state, approval_state, synthetic, generated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'ready', 'unreviewed', true, $9)
            ON CONFLICT (workspace_id, plan_package_id) DO NOTHING`,
            [
              parsed.workspaceId,
              planPackageId,
              opportunity.id,
              parsed.runId,
              reportId,
              fixturePlanVersion,
              planManifestHash,
              JSON.stringify(parsed.planPackage.files),
              parsed.planPackage.generatedAt
            ]
          )
          await assertStoredHash(
            client,
            `SELECT manifest_hash AS content_hash FROM appsea.plan_package_versions
            WHERE workspace_id = $1 AND plan_package_id = $2`,
            [parsed.workspaceId, planPackageId],
            planManifestHash,
            'plan package',
            planPackageId
          )
          await client.query(
            `INSERT INTO appsea.research_run_plan_packages
             (workspace_id, run_id, opportunity_id, plan_package_id, linked_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
            [parsed.workspaceId, parsed.runId, opportunity.id, planPackageId, parsed.requestedAt]
          )

          await client.query(
            `UPDATE appsea.opportunities
              SET current_score_snapshot_id = $3,
                  current_plan_package_id = $4,
                  updated_at = $5
            WHERE workspace_id = $1 AND opportunity_id = $2`,
            [parsed.workspaceId, opportunity.id, scoreSnapshotId, planPackageId, parsed.requestedAt]
          )

          await client.query(
            `UPDATE appsea.research_campaigns
              SET state = 'completed', updated_at = $3
            WHERE workspace_id = $1 AND campaign_id = $2`,
            [parsed.workspaceId, parsed.campaignId, parsed.requestedAt]
          )
          await client.query(
            `UPDATE appsea.research_runs
              SET state = 'completed', completed_at = $3, finished_at = $3
            WHERE workspace_id = $1 AND run_id = $2`,
            [parsed.workspaceId, parsed.runId, parsed.requestedAt]
          )

          await client.query(
            `INSERT INTO appsea.audit_events
             (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
              target_id, correlation_id, metadata, occurred_at)
           VALUES ($1, $2, 'system', 'fixture-worker', 'research.run.completed', 'research_run',
                   $3, $3, $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              hashedIdentifier('audit', { runId: parsed.runId, action: 'completed' }),
              parsed.runId,
              JSON.stringify({ synthetic: true, inputHash }),
              parsed.requestedAt
            ]
          )
          await client.query(
            `INSERT INTO appsea.outbox_events
             (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
              schema_version, correlation_id, payload, occurred_at)
           VALUES ($1, $2, 'research.run.completed', 'research_run', $3, '1.0.0', $3,
                   $4::jsonb, $5)
           ON CONFLICT DO NOTHING`,
            [
              parsed.workspaceId,
              hashedIdentifier('outbox', { runId: parsed.runId, event: 'completed' }),
              parsed.runId,
              JSON.stringify({
                workspaceId: parsed.workspaceId,
                runId: parsed.runId,
                opportunityId: opportunity.id,
                synthetic: true
              }),
              parsed.requestedAt
            ]
          )

          return buildPersistenceResult(
            client,
            parsed.workspaceId,
            parsed.campaignId,
            parsed.runId,
            false
          )
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (!isIdempotencyUniqueViolation(error)) throw error
      return withWorkspaceTransaction(
        this.pool,
        parsed.workspaceId,
        async (client) => {
          const existingRun = await client.query<ExistingRunRow>(
            `SELECT run_id, input_hash, state
               FROM appsea.research_runs
              WHERE workspace_id = $1 AND idempotency_key = $2`,
            [parsed.workspaceId, parsed.idempotencyKey]
          )
          const existing = existingRun.rows[0]
          if (!existing) throw error
          if (existing.input_hash !== inputHash) {
            throw new IdempotencyConflictError(parsed.idempotencyKey)
          }
          if (existing.state !== 'completed') {
            throw new Error(`Fixture run ${existing.run_id} is ${existing.state}, not completed`)
          }
          return buildPersistenceResult(
            client,
            parsed.workspaceId,
            parsed.campaignId,
            existing.run_id,
            true
          )
        },
        { isolationLevel: 'READ COMMITTED' }
      )
    }
  }

  async read(workspaceId: string, runId: string): Promise<FixturePersistenceReadModel | undefined> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const run = await client.query<
          QueryResultRow & {
            campaign_id: string
            artifact_snapshot: unknown
          }
        >(
          `SELECT campaign_id, artifact_snapshot
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2 AND mode = 'fixture' AND state = 'completed'`,
          [workspaceId, runId]
        )
        const storedRun = run.rows[0]
        if (!storedRun) return undefined

        const artifact = fixtureResearchArtifactSchema.parse(storedRun.artifact_snapshot)
        const plan = await client.query<
          QueryResultRow & { generated_at: Date | string; fixture_files: unknown }
        >(
          `SELECT plan.generated_at, plan.fixture_files
             FROM appsea.research_run_plan_packages run_plan
            JOIN appsea.plan_package_versions plan
              ON plan.workspace_id = run_plan.workspace_id
              AND plan.plan_package_id = run_plan.plan_package_id
            WHERE run_plan.workspace_id = $1
              AND run_plan.run_id = $2
              AND plan.deletion_state = 'active'`,
          [workspaceId, runId]
        )
        const storedPlan = plan.rows[0]
        if (!storedPlan) throw new Error(`Plan package for fixture run ${runId} was not found`)
        const planPackage = planPackageSchema.parse({
          opportunitySlug: artifact.opportunity.slug,
          generatedAt: asIsoString(storedPlan.generated_at),
          files: storedPlan.fixture_files
        })
        const result = await buildPersistenceResult(
          client,
          workspaceId,
          storedRun.campaign_id,
          runId,
          true
        )
        return fixturePersistenceReadModelSchema.parse({ result, artifact, planPackage })
      },
      { readOnly: true }
    )
  }

  async readCompletedRunIdentity(
    workspaceId: string,
    runId: string
  ): Promise<CompletedFixtureRunIdentity | undefined> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const result = await client.query<
          QueryResultRow & { campaign_id: string; idempotency_key: string; input_hash: string }
        >(
          `SELECT campaign_id, idempotency_key, input_hash
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2 AND mode = 'fixture' AND state = 'completed'`,
          [workspaceId, runId]
        )
        const row = result.rows[0]
        return row
          ? {
              campaignId: row.campaign_id,
              idempotencyKey: row.idempotency_key,
              inputHash: row.input_hash
            }
          : undefined
      },
      { readOnly: true }
    )
  }

  async listOpportunities(workspaceId: string): Promise<Opportunity[]> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId,
      async (client) => {
        const rows = await client.query<
          QueryResultRow & {
            opportunity_id: string
            slug: string
            name: string
            one_line: string
            thesis: string
            audience: string
            first_wedge: string
            complaint_count: number
            synthetic: boolean
            source_run_id: string
            tags: string[]
            contrary_evidence: string[]
            score: string
            scoring_version: string
            factors: unknown
            weights: unknown
            calculated_at: Date | string
            fixture_files: unknown
          }
        >(
          `SELECT opportunity.opportunity_id, opportunity.slug, opportunity.name,
                  opportunity.one_line, opportunity.thesis, opportunity.audience,
                  opportunity.first_wedge, opportunity.complaint_count, opportunity.synthetic,
                  opportunity.source_run_id, opportunity.tags, opportunity.contrary_evidence,
                  score.score::text, score.scoring_version, score.factors, score.weights,
                  score.calculated_at, plan.fixture_files
             FROM appsea.opportunities opportunity
             JOIN appsea.opportunity_score_snapshots score
               ON score.workspace_id = opportunity.workspace_id
              AND score.opportunity_id = opportunity.opportunity_id
              AND score.score_snapshot_id = opportunity.current_score_snapshot_id
             LEFT JOIN appsea.plan_package_versions plan
               ON plan.workspace_id = opportunity.workspace_id
             AND plan.opportunity_id = opportunity.opportunity_id
              AND plan.plan_package_id = opportunity.current_plan_package_id
              AND plan.deletion_state = 'active'
            WHERE opportunity.workspace_id = $1
            ORDER BY score.score DESC, opportunity.complaint_count DESC, opportunity.slug`,
          [workspaceId]
        )

        const opportunities: Opportunity[] = []
        for (const row of rows.rows) {
          const complaintIds = await client.query<QueryResultRow & { complaint_id: string }>(
            `SELECT DISTINCT membership.complaint_id
               FROM appsea.research_run_cluster_versions relation
               JOIN appsea.cluster_memberships membership
                 ON membership.workspace_id = relation.workspace_id
                AND membership.cluster_version_id = relation.cluster_version_id
              WHERE relation.workspace_id = $1
                AND relation.opportunity_id = $2
                AND relation.run_id = $3
              ORDER BY membership.complaint_id`,
            [workspaceId, row.opportunity_id, row.source_run_id]
          )
          const competitors = await client.query<
            QueryResultRow & {
              name: string
              competitor_type: string
              positioning: string
              strengths: string[]
              weaknesses: string[]
              related_complaint_categories: string[]
            }
          >(
            `SELECT competitor.name, competitor.competitor_type, competitor.positioning,
                    competitor.strengths, competitor.weaknesses,
                    competitor.related_complaint_categories
               FROM appsea.research_run_competitors relation
               JOIN appsea.competitors competitor
                 ON competitor.workspace_id = relation.workspace_id
                AND competitor.competitor_id = relation.competitor_id
              WHERE relation.workspace_id = $1
                AND relation.opportunity_id = $2
                AND relation.run_id = $3
              ORDER BY competitor.name`,
            [workspaceId, row.opportunity_id, row.source_run_id]
          )
          const fixtureFiles = planPackageSchema.shape.files.safeParse(row.fixture_files)

          opportunities.push(
            opportunitySchema.parse({
              id: row.opportunity_id,
              slug: row.slug,
              name: row.name,
              oneLine: row.one_line,
              thesis: row.thesis,
              audience: row.audience,
              firstWedge: row.first_wedge,
              complaintCount: Number(row.complaint_count),
              synthetic: row.synthetic,
              tags: row.tags,
              complaintIds: complaintIds.rows.map((entry) => entry.complaint_id),
              competitors: competitors.rows.map((competitor) => ({
                name: competitor.name,
                type: competitor.competitor_type,
                positioning: competitor.positioning,
                strengths: competitor.strengths,
                weaknesses: competitor.weaknesses,
                relatedComplaintCategories: competitor.related_complaint_categories
              })),
              scoreSnapshot: {
                score: Number(row.score),
                version: row.scoring_version,
                calculatedAt: asIsoString(row.calculated_at),
                factors: row.factors,
                weights: row.weights
              },
              contraryEvidence: row.contrary_evidence,
              planFiles: fixtureFiles.success ? fixtureFiles.data.map((file) => file.path) : []
            })
          )
        }
        return opportunities
      },
      { readOnly: true }
    )
  }
}
