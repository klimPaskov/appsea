import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  evidenceRedactionInputSchema,
  evidenceRedactionResultSchema,
  type EvidenceRedactionInput,
  type EvidenceRedactionMask,
  type EvidenceRedactionResult
} from '@appsea/contracts'
import { withAuthenticatedWorkspaceTransaction, withWorkspaceTransaction } from './transaction'

export class EvidenceRedactionPermissionError extends Error {
  constructor() {
    super('Evidence redaction requires an editor or owner actor')
    this.name = 'EvidenceRedactionPermissionError'
  }
}

export class EvidenceRedactionNotFoundError extends Error {
  constructor() {
    super('Evidence redaction target was not found')
    this.name = 'EvidenceRedactionNotFoundError'
  }
}

export class EvidenceRedactionConflictError extends Error {
  constructor() {
    super('Evidence redaction conflicts with existing lineage or lifecycle state')
    this.name = 'EvidenceRedactionConflictError'
  }
}

interface EvidenceRedactionRow extends QueryResultRow {
  redaction_id: string
  evidence_id: string
  fields: string[]
  reason: EvidenceRedactionResult['reason']
  redacted_at: Date | string
  replayed: boolean
}

interface EvidenceRedactionMaskRow extends QueryResultRow {
  evidence_id: string
  fields: EvidenceRedactionMask['fields']
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapResult(row: EvidenceRedactionRow): EvidenceRedactionResult {
  return evidenceRedactionResultSchema.parse({
    redactionId: row.redaction_id,
    evidenceId: row.evidence_id,
    fields: row.fields,
    reason: row.reason,
    redactedAt: iso(row.redacted_at),
    replayed: row.replayed
  })
}

function mapMasks(rows: EvidenceRedactionMaskRow[]): EvidenceRedactionMask[] {
  return rows.map((row) => ({ evidenceId: row.evidence_id, fields: row.fields }))
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function isPermissionError(error: unknown): boolean {
  return isCode(error, '42501')
}

function isNotFoundError(error: unknown): boolean {
  return isCode(error, '23503')
}

function isConflictError(error: unknown): boolean {
  return isCode(error, '23505') || isCode(error, '23514')
}

export class PostgresEvidenceRedactionRepository {
  constructor(private readonly pool: Pool) {}

  async redact(
    userId: string,
    workspaceId: string,
    runId: string,
    complaintId: string,
    evidenceId: string,
    input: EvidenceRedactionInput
  ): Promise<EvidenceRedactionResult> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRunId = appseaIdentifierSchema.parse(runId)
    const parsedComplaintId = appseaIdentifierSchema.parse(complaintId)
    const parsedEvidenceId = appseaIdentifierSchema.parse(evidenceId)
    const parsedInput = evidenceRedactionInputSchema.parse(input)
    const fields = [...parsedInput.fields].sort()
    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const target = await client.query(
            `SELECT 1
               FROM appsea.research_run_source_items run_item
               JOIN appsea.research_run_complaints run_complaint
                 ON run_complaint.workspace_id = run_item.workspace_id
                AND run_complaint.run_id = run_item.run_id
               JOIN appsea.evidence_records evidence
                 ON evidence.workspace_id = run_item.workspace_id
                AND evidence.source_item_id = run_item.source_item_id
              WHERE run_item.workspace_id = $1
                AND run_item.run_id = $2
                AND run_complaint.complaint_id = $3
                AND evidence.evidence_id = $4
              LIMIT 1`,
            [parsedWorkspaceId, parsedRunId, parsedComplaintId, parsedEvidenceId]
          )
          if (!target.rows[0]) throw new EvidenceRedactionNotFoundError()
          const result = await client.query<EvidenceRedactionRow>(
            `SELECT redaction_id, evidence_id, fields, reason, redacted_at, replayed
               FROM appsea.apply_evidence_field_redaction($1, $2, $3, $4::text[], $5)`,
            [
              parsedWorkspaceId,
              parsedEvidenceId,
              parsedInput.redactionId,
              fields,
              parsedInput.reason
            ]
          )
          const row = result.rows[0]
          if (!row) throw new EvidenceRedactionConflictError()
          return mapResult(row)
        },
        { isolationLevel: 'SERIALIZABLE', maxSerializationRetries: 0 }
      )
    } catch (error) {
      if (error instanceof EvidenceRedactionConflictError) throw error
      if (isPermissionError(error)) throw new EvidenceRedactionPermissionError()
      if (isNotFoundError(error)) throw new EvidenceRedactionNotFoundError()
      if (isConflictError(error)) throw new EvidenceRedactionConflictError()
      throw error
    }
  }

  async listForRun(
    workspaceId: string,
    runId: string,
    userId?: string
  ): Promise<EvidenceRedactionMask[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedRunId = appseaIdentifierSchema.parse(runId)
    const operation = (client: PoolClient) =>
      this.listForRunInTransaction(client, parsedWorkspaceId, parsedRunId)
    const rows = userId
      ? await withAuthenticatedWorkspaceTransaction(
          this.pool,
          appseaIdentifierSchema.parse(userId),
          parsedWorkspaceId,
          operation,
          { readOnly: true }
        )
      : await withWorkspaceTransaction(this.pool, parsedWorkspaceId, operation, { readOnly: true })
    return mapMasks(rows)
  }

  async listForAnalysisRun(
    workspaceId: string,
    analysisRunId: string,
    userId?: string
  ): Promise<EvidenceRedactionMask[]> {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedAnalysisRunId = appseaIdentifierSchema.parse(analysisRunId)
    const operation = (client: PoolClient) =>
      this.listForAnalysisRunInTransaction(client, parsedWorkspaceId, parsedAnalysisRunId)
    const rows = userId
      ? await withAuthenticatedWorkspaceTransaction(
          this.pool,
          appseaIdentifierSchema.parse(userId),
          parsedWorkspaceId,
          operation,
          { readOnly: true }
        )
      : await withWorkspaceTransaction(this.pool, parsedWorkspaceId, operation, { readOnly: true })
    return mapMasks(rows)
  }

  private async listForRunInTransaction(
    client: PoolClient,
    workspaceId: string,
    runId: string
  ): Promise<EvidenceRedactionMaskRow[]> {
    const result = await client.query<EvidenceRedactionMaskRow>(
      `SELECT event.evidence_id,
              array_agg(DISTINCT field ORDER BY field)::text[] AS fields
         FROM appsea.evidence_redaction_events event
         JOIN appsea.evidence_records evidence
           ON evidence.workspace_id = event.workspace_id
          AND evidence.evidence_id = event.evidence_id
         JOIN appsea.research_run_source_items run_item
           ON run_item.workspace_id = evidence.workspace_id
          AND run_item.source_item_id = evidence.source_item_id
        CROSS JOIN LATERAL unnest(event.fields) AS event_field(field)
        WHERE event.workspace_id = $1
          AND run_item.run_id = $2
        GROUP BY event.evidence_id`,
      [workspaceId, runId]
    )
    return result.rows
  }

  private async listForAnalysisRunInTransaction(
    client: PoolClient,
    workspaceId: string,
    analysisRunId: string
  ): Promise<EvidenceRedactionMaskRow[]> {
    const result = await client.query<EvidenceRedactionMaskRow>(
      `SELECT event.evidence_id,
              array_agg(DISTINCT field ORDER BY field)::text[] AS fields
         FROM appsea.evidence_redaction_events event
         JOIN appsea.research_analysis_run_evidence analysis_evidence
           ON analysis_evidence.workspace_id = event.workspace_id
          AND analysis_evidence.evidence_id = event.evidence_id
        CROSS JOIN LATERAL unnest(event.fields) AS event_field(field)
        WHERE event.workspace_id = $1
          AND analysis_evidence.analysis_run_id = $2
        GROUP BY event.evidence_id`,
      [workspaceId, analysisRunId]
    )
    return result.rows
  }
}
