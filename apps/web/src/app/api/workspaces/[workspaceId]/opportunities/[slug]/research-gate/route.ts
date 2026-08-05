import {
  appseaIdentifierSchema,
  deepResearchGateTransitionInputSchema,
  opportunitySlugSchema
} from '@appsea/contracts'
import {
  DeepResearchGateBlockedError,
  DeepResearchGateConflictError,
  DeepResearchGateNotFoundError,
  DeepResearchGatePermissionError,
  PostgresDeepResearchGateRepository
} from '@appsea/db/deep-research-gate'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  requireRecentMutationStepUp,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../server/database'
import { getObjectStore } from '../../../../../../../server/object-store'
import { readPrivateOpportunityContext } from '../../../../../../../server/private-opportunity'
import {
  canReadProductionWorkflow,
  canStartProductionWorkflow
} from '../../../../../../../server/production-workflow-gateway'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: { workspaceId: string; slug: string }) {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  if (!workspaceId.success || !slug.success) return undefined
  return { workspaceId: workspaceId.data, slug: slug.data }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path || !canReadProductionWorkflow(session, path.workspaceId)) return forbiddenResponse()
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  return Response.json(
    { data: privateContext.detail.deepResearchGate },
    { headers: privateResponseHeaders }
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid opportunity path')
  if (!canStartProductionWorkflow(session, path.workspaceId)) return forbiddenResponse()
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext || privateContext.detail.summary.synthetic) {
    return Response.json(
      { error: 'Production opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (Number(request.headers.get('content-length') ?? '0') > 64_000) {
    return Response.json(
      { error: 'Deep research gate request is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = deepResearchGateTransitionInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid deep research gate action is required')
  try {
    const stepUpResponse = await requireRecentMutationStepUp()
    if (stepUpResponse) return stepUpResponse
    const data = await new PostgresDeepResearchGateRepository(
      getDatabasePool(),
      getObjectStore()
    ).transition(
      session.user.userId,
      path.workspaceId,
      privateContext.detail.opportunity.id,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof DeepResearchGateBlockedError) {
      return Response.json(
        { error: 'Deep research gate is not ready to pass', data: error.gate },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof DeepResearchGatePermissionError) return forbiddenResponse()
    if (error instanceof DeepResearchGateNotFoundError) {
      return Response.json(
        { error: 'Production analysis not found', data: null },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof DeepResearchGateConflictError) {
      return Response.json(
        { error: 'Deep research gate transition conflicts with the current snapshot' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea deep research gate transition failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update deep research gate' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
