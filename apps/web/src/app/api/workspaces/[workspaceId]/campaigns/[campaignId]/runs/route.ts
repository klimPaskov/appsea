import { appseaIdentifierSchema, campaignHistoryPageQuerySchema } from '@appsea/contracts'
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
  request: Request,
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
  const url = new URL(request.url)
  const keys = [...new Set([...url.searchParams.keys()])]
  if (
    keys.some((key) => key !== 'limit' && key !== 'cursor') ||
    ['limit', 'cursor'].some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    return invalidRequest('Unsupported campaign run history query')
  }
  const rawLimit = url.searchParams.get('limit')
  const rawCursor = url.searchParams.get('cursor')
  const parsedQuery = campaignHistoryPageQuerySchema.safeParse({
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    ...(rawCursor === null ? {} : { cursor: rawCursor })
  })
  if (!parsedQuery.success) return invalidRequest('Invalid campaign run history query')
  try {
    const page = await new PostgresProductionCollectionWorkflowRepository(
      getDatabasePool()
    ).listPageForCampaignForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data,
      parsedQuery.data
    )
    return Response.json(page, { headers: privateResponseHeaders })
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
