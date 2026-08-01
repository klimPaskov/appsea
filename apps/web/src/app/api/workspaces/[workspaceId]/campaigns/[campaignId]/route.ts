import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; campaignId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, campaignId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success) {
    return invalidRequest('Invalid campaign path')
  }
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }
  try {
    const campaign = await new PostgresResearchCampaignRepository(getDatabasePool()).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data
    )
    if (!campaign) {
      return Response.json(
        { error: 'Research campaign not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: campaign }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
