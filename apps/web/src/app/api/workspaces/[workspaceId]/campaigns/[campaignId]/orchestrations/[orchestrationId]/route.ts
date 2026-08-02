import {
  appseaIdentifierSchema,
  researchCampaignOrchestrationCancelResultSchema
} from '@appsea/contracts'
import {
  PostgresResearchCampaignOrchestrationRepository,
  ResearchCampaignOrchestrationPermissionError
} from '@appsea/db/research-campaign-orchestration'
import { cancelProductionCollectionWorkflow } from '@appsea/workflows'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import {
  canReadProductionWorkflow,
  canStartProductionWorkflow,
  productionWorkflowBelongsToWorkspace,
  productionWorkspaceFromSession
} from '../../../../../../../../server/production-workflow-gateway'
import { getDatabasePool } from '../../../../../../../../server/database'
import { getTemporalWorkflowClient } from '../../../../../../../../server/temporal'

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

/** Persist and dispatch cancellation for one private multi-source run. */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; campaignId: string; orchestrationId: string }>
  }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )
  }
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
    !canStartProductionWorkflow(session, parsedWorkspaceId.data)
  ) {
    return forbiddenResponse()
  }

  let cancellation
  try {
    cancellation = await new PostgresResearchCampaignOrchestrationRepository(
      getDatabasePool()
    ).requestCancellationForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedOrchestrationId.data
    )
  } catch (error) {
    if (error instanceof ResearchCampaignOrchestrationPermissionError) {
      return forbiddenResponse()
    }
    console.error('AppSea campaign orchestration cancellation request failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to request campaign cancellation' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  if (!cancellation || cancellation.campaignId !== parsedCampaignId.data) {
    return Response.json(
      { error: 'Campaign orchestration not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }

  let cancelDispatchFailures = 0
  if (cancellation.state === 'requested' && cancellation.activeWorkflowIds.length > 0) {
    try {
      const client = await getTemporalWorkflowClient()
      for (const workflowId of cancellation.activeWorkflowIds) {
        if (!productionWorkflowBelongsToWorkspace(workflowId, parsedWorkspaceId.data)) {
          cancelDispatchFailures += 1
          continue
        }
        try {
          await cancelProductionCollectionWorkflow(client, workflowId)
        } catch {
          cancelDispatchFailures += 1
        }
      }
    } catch {
      cancelDispatchFailures = cancellation.activeWorkflowIds.length
    }
    if (cancelDispatchFailures > 0) {
      console.error('AppSea campaign orchestration cancellation dispatch deferred', {
        workspaceId: parsedWorkspaceId.data,
        orchestrationId: parsedOrchestrationId.data,
        failedCount: cancelDispatchFailures
      })
    }
  }

  const data = researchCampaignOrchestrationCancelResultSchema.parse({
    orchestrationId: cancellation.orchestrationId,
    campaignId: cancellation.campaignId,
    state: cancellation.state,
    cancellationRequestedAt: cancellation.cancellationRequestedAt,
    activeWorkflowCount: cancellation.activeWorkflowIds.length
  })
  return Response.json(
    { data },
    {
      status: cancellation.state === 'requested' ? 202 : 200,
      headers: privateResponseHeaders
    }
  )
}
