import { appseaIdentifierSchema, opportunitySlugSchema } from '@appsea/contracts'
import {
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../server/database'
import { readPrivateOpportunityContext } from '../../../../../../../server/private-opportunity'
import { PostgresClusterReviewRepository } from '@appsea/db/cluster-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const params = await context.params
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  if (!workspaceId.success || !slug.success) {
    return Response.json({ error: 'Invalid opportunity path' }, { status: 400 })
  }
  const privateContext = await readPrivateOpportunityContext(workspaceId.data, slug.data)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  const data = await new PostgresClusterReviewRepository(getDatabasePool()).listForUser(
    session.user.userId,
    workspaceId.data,
    privateContext.detail.opportunity.id
  )
  return Response.json({ data }, { headers: privateResponseHeaders })
}
