import {
  appseaIdentifierSchema,
  opportunitySlugSchema,
  workspaceArtifactHistoryPageQuerySchema
} from '@appsea/contracts'
import { WorkspaceAuthorizationError } from '@appsea/db/auth'
import { WorkspaceArtifactHistoryCursorError } from '@appsea/db'
import {
  authRepository,
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { decodePathParam } from '../../../../../../../server/path-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const params = await context.params
  const workspaceId = appseaIdentifierSchema.safeParse(decodePathParam(params.workspaceId))
  const slug = opportunitySlugSchema.safeParse(decodePathParam(params.slug))
  if (!workspaceId.success || !slug.success) {
    return Response.json(
      { error: 'Invalid opportunity path' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  const query = new URL(request.url).searchParams
  const queryKeys = [...new Set([...query.keys()])]
  const allowedKeys = new Set(['limit', 'reportCursor', 'planCursor'])
  if (queryKeys.some((key) => !allowedKeys.has(key))) {
    return Response.json(
      { error: 'Unsupported history query parameter' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  if (queryKeys.some((key) => query.getAll(key).length !== 1)) {
    return Response.json(
      { error: 'History query parameters must be single-valued' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  const parsedQuery = workspaceArtifactHistoryPageQuerySchema.safeParse({
    limit: query.has('limit') ? Number(query.get('limit')) : undefined,
    reportCursor: query.get('reportCursor') ?? undefined,
    planCursor: query.get('planCursor') ?? undefined
  })
  if (!parsedQuery.success) {
    return Response.json(
      { error: 'Invalid history query' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    const repository = authRepository()
    const opportunity = (
      await repository.listWorkspaceOpportunities(session.user.userId, workspaceId.data)
    ).find((candidate) => candidate.slug === slug.data)
    if (!opportunity) {
      return Response.json(
        { error: 'Opportunity not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    const data = await repository.listWorkspaceArtifactHistoryForUser(
      session.user.userId,
      workspaceId.data,
      opportunity.id,
      parsedQuery.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    if (error instanceof WorkspaceArtifactHistoryCursorError) {
      return Response.json(
        { error: 'Invalid history cursor' },
        { status: 400, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea artifact history read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read artifact history' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
