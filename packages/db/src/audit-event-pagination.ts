import {
  appseaIdentifierSchema,
  auditEventHistoryCursorSchema,
  type AuditEventHistoryCursor
} from '@appsea/contracts'

export class AuditEventHistoryCursorError extends Error {
  constructor() {
    super('Audit history cursor is invalid')
    this.name = 'AuditEventHistoryCursorError'
  }
}

function cursorItemId(value: string): string {
  const parsed = auditEventHistoryCursorSchema.shape.itemId.safeParse(value)
  if (!parsed.success) throw new Error('Audit history cursor item ID is invalid')
  return parsed.data
}

export function encodeAuditEventHistoryCursor(
  workspaceId: string,
  occurredAt: string,
  itemId: string
): string {
  const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
  const parsed = auditEventHistoryCursorSchema.parse({
    version: 1,
    occurredAt,
    itemId: cursorItemId(itemId)
  })
  return Buffer.from(
    JSON.stringify({ ...parsed, workspaceId: parsedWorkspaceId }),
    'utf8'
  ).toString('base64url')
}

export function decodeAuditEventHistoryCursor(
  value: string,
  expectedWorkspaceId: string
): AuditEventHistoryCursor {
  try {
    const parsedWorkspaceId = appseaIdentifierSchema.parse(expectedWorkspaceId)
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const candidate = JSON.parse(decoded) as unknown
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      (candidate as { workspaceId?: unknown }).workspaceId !== parsedWorkspaceId
    ) {
      throw new Error('Audit history cursor workspace mismatch')
    }
    const payload = { ...(candidate as Record<string, unknown>) }
    delete payload.workspaceId
    return auditEventHistoryCursorSchema.parse(payload)
  } catch {
    throw new AuditEventHistoryCursorError()
  }
}
