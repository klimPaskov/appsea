import { appseaIdentifierSchema, opportunitySlugSchema } from '@appsea/contracts'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../server/private-opportunity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, slug } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedSlug = opportunitySlugSchema.safeParse(slug)
  if (!parsedWorkspaceId.success || !parsedSlug.success) {
    return Response.json({ error: 'Invalid opportunity path' }, { status: 400 })
  }
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }
  const privateContext = await readPrivateOpportunityContext(
    parsedWorkspaceId.data,
    parsedSlug.data
  )
  if (!privateContext) return Response.json({ error: 'Opportunity not found' }, { status: 404 })
  return Response.json({ data: privateContext.detail }, { headers: privateResponseHeaders })
}
