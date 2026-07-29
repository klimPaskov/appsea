import {
  appseaIdentifierSchema,
  fixtureResearchWorkflowStartRequestSchema
} from '@appsea/contracts'
import { startFixtureResearchWorkflow } from '@appsea/workflows'
import { NextResponse } from 'next/server'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import {
  canStartFixtureWorkflow,
  parseFixtureWorkflowStartRequest,
  workspaceFromSession
} from '../../../../../../server/fixture-workflow-gateway'
import { getTemporalWorkflowClient } from '../../../../../../server/temporal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')
  const workspace = workspaceFromSession(session, parsedWorkspaceId.data)
  if (!workspace || !canStartFixtureWorkflow(session, parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = parseFixtureWorkflowStartRequest(parsedWorkspaceId.data, payload)
  if (!parsed) return invalidRequest('Fixture workflow request is invalid')
  // Keep this explicit in the route as a reviewable guard even though the
  // shared access helper also requires fixtureOnly.
  if (!workspace.fixtureOnly) return forbiddenResponse()
  // Re-parse at the route boundary so a future helper cannot silently widen the
  // strict workflow contract.
  const strict = fixtureResearchWorkflowStartRequestSchema.safeParse(parsed)
  if (!strict.success) return invalidRequest('Fixture workflow request is invalid')
  const actorBoundRequest = fixtureResearchWorkflowStartRequestSchema.parse({
    ...strict.data,
    requestedBy: { actorType: 'user', actorId: session.user.userId }
  })

  try {
    const client = await getTemporalWorkflowClient()
    const handle = await startFixtureResearchWorkflow(client, actorBoundRequest)
    return NextResponse.json(
      { data: { workflowId: handle.workflowId } },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('idempotency key conflicts')) {
      return Response.json(
        { error: 'Workflow idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea fixture workflow start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to start fixture research' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
