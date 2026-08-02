import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresResearchCampaignOrchestrationRepository } from '@appsea/db/research-campaign-orchestration'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import {
  canReadProductionWorkflow,
  productionWorkspaceFromSession
} from '../../../../../../../../server/production-workflow-gateway'
import { getDatabasePool } from '../../../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Read one private orchestration with bounded child state and no hashes. */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ workspaceId: string; campaignId: string; orchestrationId: string }>
  }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, campaignId, orchestrationId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  const parsedOrchestrationId = appseaIdentifierSchema.safeParse(orchestrationId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success || !parsedOrchestrationId.success) {
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
    const orchestration = await new PostgresResearchCampaignOrchestrationRepository(
      getDatabasePool()
    ).readForUser(session.user.userId, parsedWorkspaceId.data, parsedOrchestrationId.data)
    if (!orchestration || orchestration.campaignId !== parsedCampaignId.data) {
      return Response.json(
        { error: 'Campaign orchestration not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: orchestration }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign orchestration read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read campaign orchestration' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
