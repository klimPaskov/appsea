import {
  appseaIdentifierSchema,
  productionCollectionWorkflowStatusSchema,
  workflowIdSchema
} from '@appsea/contracts'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
import { readProductionCollectionWorkflowStatus } from '@appsea/workflows'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import {
  canReadProductionWorkflow,
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
