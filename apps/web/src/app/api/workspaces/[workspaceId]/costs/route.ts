import { appseaIdentifierSchema, workspaceCostSummaryQuerySchema } from '@appsea/contracts'
import { PostgresWorkspaceCostRepository, WorkspaceCostSummaryQueryError } from '@appsea/db'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const queryKeys = [...url.searchParams.keys()]
  if (
    queryKeys.length !== new Set(queryKeys).size ||
    queryKeys.some((key) => key !== 'from' && key !== 'to')
  ) {
    return Response.json({ error: 'Invalid cost summary period' }, { status: 400 })
  }
  const query = workspaceCostSummaryQuerySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined
  })
  if (!query.success) {
    return Response.json({ error: 'Invalid cost summary period' }, { status: 400 })
  }

  try {
    const data = await new PostgresWorkspaceCostRepository(getDatabasePool()).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      query.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceCostSummaryQueryError) {
      return Response.json(
        { error: 'Invalid cost summary period' },
        { status: 400, headers: privateResponseHeaders }
      )
    }
    return Response.json(
      { error: 'Cost summary unavailable', code: 'cost_summary_unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
