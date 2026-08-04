import {
  appseaIdentifierSchema,
  auditEventHistoryPageQuerySchema,
  auditEventHistoryPageSchema,
  auditEventMetadataSchema,
  auditEventReadModelSchema,
  type AuditEventHistoryPage,
  type AuditEventHistoryPageQuery,
  type AuditEventReadModel
} from '@appsea/contracts'
import type { Pool } from 'pg'
import {
  decodeAuditEventHistoryCursor,
  encodeAuditEventHistoryCursor
} from './audit-event-pagination'
import { withAuthenticatedWorkspaceTransaction } from './transaction'

interface AuditEventRow {
  audit_event_id: string
  actor_type: 'user' | 'service' | 'system'
  actor_id: string
  action: string
  target_type: string
  target_id: string
  correlation_id: string
  metadata: unknown
  occurred_at: Date | string
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Audit metadata is an untrusted projection boundary. Nested values and values
 * outside the bounded scalar contract are intentionally hidden rather than
 * serialized into a private response.
 */
function safeMetadata(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const projected: Record<string, unknown> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (Object.keys(projected).length >= 24) break
    const parsed = auditEventMetadataSchema.safeParse({ [key]: candidate })
    if (parsed.success) projected[key] = candidate
  }
  return auditEventMetadataSchema.parse(projected)
}

function mapRow(row: AuditEventRow): AuditEventReadModel {
  return auditEventReadModelSchema.parse({
    auditEventId: row.audit_event_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    correlationId: row.correlation_id,
    metadata: safeMetadata(row.metadata),
    occurredAt: timestamp(row.occurred_at)
  })
}

export class PostgresAuditEventRepository {
  constructor(private readonly pool: Pool) {}

  async listPageForUser(
    userId: string,
    workspaceId: string,
    query: Partial<AuditEventHistoryPageQuery> = {}
  ): Promise<AuditEventHistoryPage> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedQuery = auditEventHistoryPageQuerySchema.parse(query)
    const cursor = parsedQuery.cursor
      ? decodeAuditEventHistoryCursor(parsedQuery.cursor, parsedWorkspaceId)
      : null

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<AuditEventRow>(
          `SELECT audit_event_id, actor_type, actor_id, action, target_type,
                  target_id, correlation_id, metadata, occurred_at
             FROM appsea.audit_events
            WHERE workspace_id = $1
              AND (
                $2::timestamptz IS NULL
                OR occurred_at < $2::timestamptz
                OR (occurred_at = $2::timestamptz AND audit_event_id > $3)
              )
            ORDER BY occurred_at DESC, audit_event_id ASC
            LIMIT $4`,
          [
            parsedWorkspaceId,
            cursor?.occurredAt ?? null,
            cursor?.itemId ?? null,
            parsedQuery.limit + 1
          ]
        )
        const hasNext = result.rows.length > parsedQuery.limit
        const rows = hasNext ? result.rows.slice(0, parsedQuery.limit) : result.rows
        const data = rows.map(mapRow)
        const last = rows.at(-1)
        return auditEventHistoryPageSchema.parse({
          data,
          nextCursor:
            hasNext && last
              ? encodeAuditEventHistoryCursor(
                  parsedWorkspaceId,
                  timestamp(last.occurred_at),
                  last.audit_event_id
                )
              : null
        })
      },
      { readOnly: true }
    )
  }
}
