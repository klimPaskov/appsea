import { appseaIdentifierSchema, opportunitySlugSchema } from '@appsea/contracts'
import { WorkspaceAuthorizationError } from '@appsea/db/auth'
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
  const queryKeys = [...new Set([...new URL(request.url).searchParams.keys()])]
  if (queryKeys.length > 0) {
    return Response.json(
      { error: 'History does not accept query parameters' },
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
      opportunity.id
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    console.error('AppSea artifact history read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read artifact history' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
