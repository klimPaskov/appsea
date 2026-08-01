import { appseaIdentifierSchema, sourceQuotaReconciliationListQuerySchema } from '@appsea/contracts'
import { PostgresSourceQuotaRepository } from '@appsea/db'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Private visibility for a settled source request that lacks a completed
 * production result.  This route is inspection-only; resolution remains an
 * explicit maintenance-role operation and never authorizes a re-fetch.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()

  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) {
    return Response.json({ error: 'Invalid workspace' }, { status: 400 })
  }
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }

  const url = new URL(request.url)
  const keys = [...url.searchParams.keys()]
  if (keys.length !== new Set(keys).size || keys.some((key) => key !== 'limit')) {
    return Response.json(
      { error: 'Invalid quota reconciliation query' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  const rawLimit = url.searchParams.get('limit')
  const parsedQuery = sourceQuotaReconciliationListQuerySchema.safeParse({
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) })
  })
  if (!parsedQuery.success) {
    return Response.json(
      { error: 'Invalid quota reconciliation query' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    const data = await new PostgresSourceQuotaRepository(
      getDatabasePool()
    ).listReconciliationCasesForUser(session.user.userId, parsedWorkspaceId.data, parsedQuery.data)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch {
    return Response.json(
      {
        error: 'Quota reconciliation status unavailable',
        code: 'quota_reconciliation_unavailable'
      },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
