import { appseaIdentifierSchema, auditEventHistoryPageQuerySchema } from '@appsea/contracts'
import { AuditEventHistoryCursorError, PostgresAuditEventRepository } from '@appsea/db'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Return a bounded, private audit projection for one current workspace. */
export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()

  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')
  const workspace = session.workspaces.find(
    (candidate) =>
      candidate.workspaceId === parsedWorkspaceId.data && candidate.visibility === 'private'
  )
  if (!workspace) return forbiddenResponse()

  const url = new URL(request.url)
  const keys = [...new Set([...url.searchParams.keys()])]
  if (
    keys.some((key) => key !== 'limit' && key !== 'cursor') ||
    ['limit', 'cursor'].some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    return invalidRequest('Unsupported audit history query')
  }
  const rawLimit = url.searchParams.get('limit')
  const rawCursor = url.searchParams.get('cursor')
  const parsedQuery = auditEventHistoryPageQuerySchema.safeParse({
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    ...(rawCursor === null ? {} : { cursor: rawCursor })
  })
  if (!parsedQuery.success) return invalidRequest('Invalid audit history query')

  try {
    const data = await new PostgresAuditEventRepository(getDatabasePool()).listPageForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedQuery.data
    )
    return Response.json(data, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuditEventHistoryCursorError) {
      return invalidRequest('Invalid audit history query')
    }
    console.error('AppSea audit history read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Audit history unavailable', code: 'audit_history_unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
