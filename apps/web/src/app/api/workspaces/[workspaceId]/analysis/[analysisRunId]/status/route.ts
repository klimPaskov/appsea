import { appseaIdentifierSchema, workflowIdSchema } from '@appsea/contracts'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import {
  canReadProductionWorkflow,
  productionAnalysisWorkflowBelongsToWorkspace,
  productionWorkspaceFromSession
} from '../../../../../../../server/production-workflow-gateway'
import {
  ProductionAnalysisStatusMismatchError,
  ProductionAnalysisStatusUnavailableError,
  readPrivateProductionAnalysisStatus
} from '../../../../../../../server/production-analysis-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; analysisRunId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, analysisRunId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedAnalysisRunId = appseaIdentifierSchema.safeParse(analysisRunId)
  if (!parsedWorkspaceId.success || !parsedAnalysisRunId.success) {
    return invalidRequest('Invalid analysis status path')
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

  const workflowIdValue = new URL(request.url).searchParams.get('workflowId')
  let workflowId: string | undefined
  if (workflowIdValue !== null) {
    const parsedWorkflowId = workflowIdSchema.safeParse(workflowIdValue)
    if (!parsedWorkflowId.success) return invalidRequest('Invalid analysis workflow')
    if (
      !productionAnalysisWorkflowBelongsToWorkspace(parsedWorkflowId.data, parsedWorkspaceId.data)
    ) {
      return forbiddenResponse()
    }
    workflowId = parsedWorkflowId.data
  }

  try {
    const data = await readPrivateProductionAnalysisStatus({
      userId: session.user.userId,
      workspaceId: parsedWorkspaceId.data,
      analysisRunId: parsedAnalysisRunId.data,
      workflowId
    })
    if (!data) {
      return Response.json(
        { error: 'Analysis status not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ProductionAnalysisStatusMismatchError) {
      return Response.json(
        { error: 'Analysis status not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (!(error instanceof ProductionAnalysisStatusUnavailableError)) {
      console.error('AppSea production analysis status read failed', {
        name: error instanceof Error ? error.name : 'unknown'
      })
    }
    return Response.json(
      { error: 'Unable to read production analysis status' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
