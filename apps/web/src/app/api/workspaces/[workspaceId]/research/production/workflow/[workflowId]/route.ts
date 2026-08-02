import {
  appseaIdentifierSchema,
  productionCollectionWorkflowCancelResultSchema,
  productionCollectionWorkflowStatusSchema,
  workflowIdSchema
} from '@appsea/contracts'
import {
  PostgresProductionCollectionWorkflowRepository,
  ProductionCollectionWorkflowPermissionError
} from '@appsea/db/production-collection-workflow'
import {
  cancelProductionCollectionWorkflow,
  readProductionCollectionWorkflowStatus
} from '@appsea/workflows'
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
import { getTemporalWorkflowClient } from '../../../../../../../../server/temporal'
import { getDatabasePool } from '../../../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; workflowId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, workflowId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedWorkflowId = workflowIdSchema.safeParse(workflowId)
  if (!parsedWorkspaceId.success || !parsedWorkflowId.success) {
    return invalidRequest('Invalid workflow path')
  }
  if (
    !productionWorkspaceFromSession(session, parsedWorkspaceId.data) ||
    !canReadProductionWorkflow(session, parsedWorkspaceId.data) ||
    !productionWorkflowBelongsToWorkspace(parsedWorkflowId.data, parsedWorkspaceId.data)
  ) {
    return forbiddenResponse()
  }
  try {
    const client = await getTemporalWorkflowClient()
    const status = productionCollectionWorkflowStatusSchema.parse(
      await readProductionCollectionWorkflowStatus(client, parsedWorkflowId.data)
    )
    return Response.json({ data: status }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea production collection workflow status failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    try {
      const projection = await new PostgresProductionCollectionWorkflowRepository(
        getDatabasePool()
      ).readForUser(session.user.userId, parsedWorkspaceId.data, parsedWorkflowId.data)
      if (!projection) {
        return Response.json(
          { error: 'Production collection workflow not found' },
          { status: 404, headers: privateResponseHeaders }
        )
      }
      const status = productionCollectionWorkflowStatusSchema.parse({
        workflowId: projection.workflowId,
        temporalFirstExecutionRunId: projection.temporalFirstExecutionRunId,
        inputHash: projection.inputHash,
        state: projection.state,
        checkpoint: projection.checkpoint,
        activityAttempts: projection.activityAttempts,
        consumedSourceItems: projection.consumedSourceItems,
        consumedCostMicros: projection.consumedCostMicros,
        analysisSeedReviewId: projection.analysisSeedReviewId,
        recollectionTombstoneId: projection.recollectionTombstoneId,
        result: null
      })
      return Response.json({ data: status }, { headers: privateResponseHeaders })
    } catch (projectionError) {
      console.error('AppSea production collection workflow projection read failed', {
        name: projectionError instanceof Error ? projectionError.name : 'unknown'
      })
    }
    return Response.json(
      { error: 'Unable to read production collection status' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; workflowId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, workflowId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedWorkflowId = workflowIdSchema.safeParse(workflowId)
  if (!parsedWorkspaceId.success || !parsedWorkflowId.success) {
    return invalidRequest('Invalid workflow path')
  }
  if (
    !productionWorkspaceFromSession(session, parsedWorkspaceId.data) ||
    !canStartProductionWorkflow(session, parsedWorkspaceId.data) ||
    !productionWorkflowBelongsToWorkspace(parsedWorkflowId.data, parsedWorkspaceId.data)
  ) {
    return forbiddenResponse()
  }
  try {
    const repository = new PostgresProductionCollectionWorkflowRepository(getDatabasePool())
    const cancellation = await repository.requestCancellationForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedWorkflowId.data
    )
    if (!cancellation) {
      return Response.json(
        { error: 'Production collection workflow not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (cancellation.state === 'requested') {
      try {
        const client = await getTemporalWorkflowClient()
        await cancelProductionCollectionWorkflow(client, parsedWorkflowId.data)
      } catch (error) {
        // The durable request is already committed. The leased worker retries
        // this external side effect when Temporal is unavailable.
        console.error('AppSea production collection workflow cancellation deferred', {
          name: error instanceof Error ? error.name : 'unknown'
        })
      }
    }
    const data = productionCollectionWorkflowCancelResultSchema.parse(cancellation)
    return Response.json(
      { data },
      { status: data.state === 'requested' ? 202 : 200, headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof ProductionCollectionWorkflowPermissionError) {
      return forbiddenResponse()
    }
    console.error('AppSea production collection workflow cancellation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to cancel production collection workflow' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
