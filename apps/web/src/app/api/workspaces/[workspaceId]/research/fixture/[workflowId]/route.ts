import { appseaIdentifierSchema, workflowIdSchema } from '@appsea/contracts'
import { PostgresWorkflowJobRepository } from '@appsea/db/workflow'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import {
  canReadFixtureWorkflow,
  publicWorkflowStatus,
  workspaceFromSession
} from '../../../../../../../server/fixture-workflow-gateway'
import { getDatabasePool } from '../../../../../../../server/database'

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
    !workspaceFromSession(session, parsedWorkspaceId.data) ||
    !canReadFixtureWorkflow(session, parsedWorkspaceId.data)
  ) {
    return forbiddenResponse()
  }

  try {
    const status = await new PostgresWorkflowJobRepository(getDatabasePool()).read(
      parsedWorkspaceId.data,
      parsedWorkflowId.data
    )
    if (!status || status.workflowType !== 'fixtureResearchWorkflow') {
      return Response.json(
        { error: 'Workflow not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json(
      { data: publicWorkflowStatus(status) },
      { headers: privateResponseHeaders }
    )
  } catch (error) {
    console.error('AppSea fixture workflow status failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read fixture research status' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
