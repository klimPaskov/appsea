import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresResearchCampaignOrchestrationRepository } from '@appsea/db/research-campaign-orchestration'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import {
  canReadProductionWorkflow,
  productionWorkspaceFromSession
} from '../../../../../../../server/production-workflow-gateway'
import { getDatabasePool } from '../../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Return safe private parent/child history for multi-source campaign runs. */
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
    return invalidRequest('Invalid campaign orchestration path')
  }
  const workspace = productionWorkspaceFromSession(session, parsedWorkspaceId.data)
  if (
    !workspace ||
    workspace.fixtureOnly ||
    workspace.visibility !== 'private' ||
    !canReadProductionWorkflow(session, parsedWorkspaceId.data)
  ) {
    return forbiddenResponse()
  }
  try {
    const data = await new PostgresResearchCampaignOrchestrationRepository(
      getDatabasePool()
    ).listForCampaignForUser(session.user.userId, parsedWorkspaceId.data, parsedCampaignId.data)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign orchestration history read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read campaign orchestration history' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
