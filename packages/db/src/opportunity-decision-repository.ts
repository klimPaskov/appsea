import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  workspaceOpportunityDecisionEvidenceSnapshotSchema,
  workspaceOpportunityDecisionInputSchema,
  workspaceOpportunityDecisionReadModelSchema,
  type WorkspaceOpportunityDecisionEvidenceSnapshot,
  type WorkspaceOpportunityDecisionInput,
  type WorkspaceOpportunityDecisionReadModel,
  type WorkspaceOpportunityState
} from '@appsea/contracts'
import { contentHash } from './hash'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

interface DecisionRow extends QueryResultRow {
  decision_id: string
  opportunity_id: string
  actor_id: string
  decision: WorkspaceOpportunityDecisionReadModel['decision']
  previous_state: WorkspaceOpportunityState
  next_state: WorkspaceOpportunityState
  reason: string
  evidence_snapshot: unknown
  created_at: Date | string
}

interface OpportunityRow extends QueryResultRow {
  opportunity_id: string
  state: WorkspaceOpportunityState
  synthetic: boolean
  source_run_id: string
  current_score_snapshot_id: string | null
  current_plan_package_id: string | null
  current_report_id: string | null
  deep_research_gate_id: string | null
  coverage_gaps: string[]
}

export class OpportunityDecisionNotFoundError extends Error {
  constructor() {
    super('The opportunity was not found')
    this.name = 'OpportunityDecisionNotFoundError'
  }
}

export class OpportunityDecisionPermissionError extends Error {
  constructor() {
    super('Opportunity decisions require an editor or owner')
    this.name = 'OpportunityDecisionPermissionError'
  }
}

export class OpportunityDecisionConflictError extends Error {
  constructor(message = 'The opportunity decision conflicts with the current state') {
    super(message)
    this.name = 'OpportunityDecisionConflictError'
  }
}

export class OpportunityDecisionBlockedError extends Error {
  constructor(message = 'The opportunity is not eligible for this decision') {
    super(message)
    this.name = 'OpportunityDecisionBlockedError'
  }
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime()))
    throw new Error('Stored opportunity decision time is invalid')
  return date.toISOString()
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

function parseDecision(row: DecisionRow): WorkspaceOpportunityDecisionReadModel {
  return workspaceOpportunityDecisionReadModelSchema.parse({
    decisionId: row.decision_id,
    opportunityId: row.opportunity_id,
    actorId: row.actor_id,
    decision: row.decision,
    previousState: row.previous_state,
    nextState: row.next_state,
    reason: row.reason,
    evidenceSnapshot: workspaceOpportunityDecisionEvidenceSnapshotSchema.parse(
      row.evidence_snapshot
    ),
    createdAt: iso(row.created_at)
  })
}

function nextState(
  decision: WorkspaceOpportunityDecisionInput['decision']
): WorkspaceOpportunityState {
  if (decision === 'approve') return 'approved'
  if (decision === 'watch') return 'monitoring'
  return 'archived'
}

function decisionId(workspaceId: string, opportunityId: string, idempotencyKey: string): string {
  return `opportunity-decision:${contentHash({ workspaceId, opportunityId, idempotencyKey }).slice(0, 32)}`
}

function requestHash(opportunityId: string, input: WorkspaceOpportunityDecisionInput): string {
  return contentHash({ opportunityId, ...input })
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

async function currentOpportunity(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<OpportunityRow | null> {
  const result = await client.query<OpportunityRow>(
    `SELECT opportunity.opportunity_id, opportunity.state, opportunity.synthetic,
            opportunity.source_run_id, opportunity.current_score_snapshot_id,
            opportunity.current_plan_package_id, run.coverage_gaps,
            report.report_id AS current_report_id,
            gate.gate_id AS deep_research_gate_id
       FROM appsea.opportunities opportunity
       JOIN appsea.research_runs run
         ON run.workspace_id = opportunity.workspace_id
        AND run.run_id = opportunity.source_run_id
       LEFT JOIN LATERAL (
         SELECT report_id
           FROM appsea.report_versions report
          WHERE report.workspace_id = opportunity.workspace_id
            AND report.opportunity_id = opportunity.opportunity_id
            AND report.approval_state <> 'withdrawn'
            AND report.deletion_state = 'active'
          ORDER BY report.generated_at DESC, report.report_id DESC
          LIMIT 1
       ) report ON true
       LEFT JOIN LATERAL (
         SELECT gate_id
           FROM appsea.deep_research_gate_reviews gate
           JOIN appsea.production_analysis_runs analysis
             ON analysis.workspace_id = gate.workspace_id
            AND analysis.analysis_run_id = gate.analysis_run_id
            AND analysis.opportunity_id = gate.opportunity_id
            AND analysis.collection_run_id = opportunity.source_run_id
            AND analysis.artifact_id = gate.artifact_id
            AND analysis.state = 'completed'
            AND analysis.availability_state = 'active'
            AND analysis.analysis_run_id = (
              SELECT current_analysis.analysis_run_id
                FROM appsea.production_analysis_runs current_analysis
               WHERE current_analysis.workspace_id = opportunity.workspace_id
                 AND current_analysis.opportunity_id = opportunity.opportunity_id
                 AND current_analysis.collection_run_id = opportunity.source_run_id
                 AND current_analysis.state = 'completed'
                 AND current_analysis.availability_state = 'active'
               ORDER BY current_analysis.completed_at DESC, current_analysis.analysis_run_id DESC
               LIMIT 1
            )
          WHERE gate.workspace_id = opportunity.workspace_id
            AND gate.opportunity_id = opportunity.opportunity_id
            AND gate.status = 'passed'
          ORDER BY gate.updated_at DESC, gate.gate_id DESC
          LIMIT 1
       ) gate ON true
      WHERE opportunity.workspace_id = $1
        AND opportunity.opportunity_id = $2
        AND opportunity.availability_state = 'active'
      FOR UPDATE OF opportunity`,
    [workspaceId, opportunityId]
  )
  return result.rows[0] ?? null
}

async function evidenceIds(
  client: PoolClient,
  workspaceId: string,
  sourceRunId: string
): Promise<string[]> {
  const result = await client.query<{ evidence_id: string }>(
    `SELECT DISTINCT complaint.evidence_id
       FROM appsea.research_run_complaints run_complaint
       JOIN appsea.complaint_observations complaint
         ON complaint.workspace_id = run_complaint.workspace_id
        AND complaint.complaint_id = run_complaint.complaint_id
       JOIN appsea.evidence_records evidence
         ON evidence.workspace_id = complaint.workspace_id
        AND evidence.evidence_id = complaint.evidence_id
        AND evidence.deletion_state = 'active'
      WHERE run_complaint.workspace_id = $1
        AND run_complaint.run_id = $2
      ORDER BY complaint.evidence_id
      LIMIT 5000`,
    [workspaceId, sourceRunId]
  )
  return result.rows.map((row) => row.evidence_id)
}

async function buildEvidenceSnapshot(
  client: PoolClient,
  workspaceId: string,
  opportunity: OpportunityRow
): Promise<WorkspaceOpportunityDecisionEvidenceSnapshot> {
  const material = {
    opportunityId: opportunity.opportunity_id,
    sourceRunId: opportunity.source_run_id,
    previousState: opportunity.state,
    scoreSnapshotId: opportunity.current_score_snapshot_id,
    reportId: opportunity.current_report_id,
    planPackageId: opportunity.current_plan_package_id,
    deepResearchGateId: opportunity.deep_research_gate_id,
    evidenceIds: await evidenceIds(client, workspaceId, opportunity.source_run_id),
    coverageGapCount: opportunity.coverage_gaps.length
  }
  return workspaceOpportunityDecisionEvidenceSnapshotSchema.parse({
    ...material,
    snapshotHash: contentHash(material),
    capturedAt: new Date().toISOString()
  })
}

async function readHistory(
  client: PoolClient,
  workspaceId: string,
  opportunityId: string
): Promise<WorkspaceOpportunityDecisionReadModel[]> {
  const result = await client.query<DecisionRow>(
    `SELECT decision_id, opportunity_id, actor_id, decision,
            previous_state, next_state, reason, evidence_snapshot, created_at
       FROM appsea.opportunity_decisions
      WHERE workspace_id = $1 AND opportunity_id = $2
      ORDER BY created_at DESC, decision_id DESC
      LIMIT 200`,
    [workspaceId, opportunityId]
  )
  return result.rows.map(parseDecision)
}

export class PostgresOpportunityDecisionRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string
  ): Promise<WorkspaceOpportunityDecisionReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => readHistory(client, parsedWorkspaceId, parsedOpportunityId),
      { readOnly: true }
    )
  }

  async createForUser(
    userId: string,
    workspaceId: string,
    opportunityId: string,
    input: WorkspaceOpportunityDecisionInput,
    idempotencyKey: string
  ): Promise<WorkspaceOpportunityDecisionReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedOpportunityId = appseaIdentifierSchema.parse(opportunityId)
    const parsedInput = workspaceOpportunityDecisionInputSchema.parse(input)
    const parsedIdempotencyKey = idempotencyKey.trim()
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(parsedIdempotencyKey)) {
      throw new OpportunityDecisionConflictError('A valid idempotency key is required')
    }
    const requestDigest = requestHash(parsedOpportunityId, parsedInput)
    const id = decisionId(parsedWorkspaceId, parsedOpportunityId, parsedIdempotencyKey)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const role = await actorRole(client, parsedWorkspaceId, parsedUserId)
          if (role !== 'owner' && role !== 'editor') throw new OpportunityDecisionPermissionError()

          const existing = await client.query<
            DecisionRow & { request_hash: string; actor_id: string }
          >(
            `SELECT decision_id, opportunity_id, actor_id, decision,
                    previous_state, next_state, reason, evidence_snapshot,
                    created_at, request_hash
               FROM appsea.opportunity_decisions
              WHERE workspace_id = $1 AND idempotency_key = $2`,
            [parsedWorkspaceId, parsedIdempotencyKey]
          )
          if (existing.rows[0]) {
            const row = existing.rows[0]
            if (row.actor_id !== parsedUserId || row.request_hash !== requestDigest) {
              throw new OpportunityDecisionConflictError(
                'The idempotency key is already bound to a different decision'
              )
            }
            return parseDecision(row)
          }

          const opportunity = await currentOpportunity(
            client,
            parsedWorkspaceId,
            parsedOpportunityId
          )
          if (!opportunity) throw new OpportunityDecisionNotFoundError()
          if (opportunity.state !== parsedInput.expectedState) {
            throw new OpportunityDecisionConflictError(
              'The opportunity state has changed; refresh and try again'
            )
          }
          if (parsedInput.decision === 'approve') {
            if (opportunity.synthetic || opportunity.state !== 'planned') {
              throw new OpportunityDecisionBlockedError(
                'Only a planned, source-backed opportunity can be approved'
              )
            }
            if (!opportunity.current_report_id || !opportunity.current_plan_package_id) {
              throw new OpportunityDecisionBlockedError(
                'An approved report and plan are required before approval'
              )
            }
            if (!opportunity.deep_research_gate_id) {
              throw new OpportunityDecisionBlockedError(
                'A passed deep-research gate is required before approval'
              )
            }
          }

          const snapshot = await buildEvidenceSnapshot(client, parsedWorkspaceId, opportunity)
          const inserted = await client.query<DecisionRow>(
            `INSERT INTO appsea.opportunity_decisions
               (workspace_id, decision_id, opportunity_id, idempotency_key,
                request_hash, actor_id, decision, previous_state, next_state,
                reason, evidence_snapshot, evidence_snapshot_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, clock_timestamp())
             RETURNING decision_id, opportunity_id, actor_id, decision,
                       previous_state, next_state, reason, evidence_snapshot, created_at`,
            [
              parsedWorkspaceId,
              id,
              parsedOpportunityId,
              parsedIdempotencyKey,
              requestDigest,
              parsedUserId,
              parsedInput.decision,
              opportunity.state,
              nextState(parsedInput.decision),
              parsedInput.reason,
              JSON.stringify(snapshot),
              snapshot.snapshotHash
            ]
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('Opportunity decision was not created')
          return parseDecision(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OpportunityDecisionConflictError('The idempotency key is already in use')
      }
      if (isSerializationConflict(error)) {
        throw new OpportunityDecisionConflictError('The opportunity changed; refresh and try again')
      }
      if (isPolicyViolation(error)) throw new OpportunityDecisionPermissionError()
      throw error
    }
  }
}
