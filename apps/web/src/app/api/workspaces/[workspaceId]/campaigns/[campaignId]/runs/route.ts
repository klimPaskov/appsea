import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
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

/** Return safe, workspace-authorized collection history without idempotency hashes. */
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
    return invalidRequest('Invalid campaign run path')
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
    const runs = await new PostgresProductionCollectionWorkflowRepository(
      getDatabasePool()
    ).listForCampaignForUser(session.user.userId, parsedWorkspaceId.data, parsedCampaignId.data)
    return Response.json({ data: runs }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign run history read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read campaign run history' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
