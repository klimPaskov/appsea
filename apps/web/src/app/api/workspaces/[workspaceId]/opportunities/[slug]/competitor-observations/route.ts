import {
  appseaIdentifierSchema,
  competitiveResearchObservationCreateInputSchema,
  opportunitySlugSchema
} from '@appsea/contracts'
import {
  CompetitiveResearchObservationConflictError,
  CompetitiveResearchObservationNotFoundError,
  CompetitiveResearchObservationPermissionError,
  CompetitiveResearchObservationPolicyError,
  PostgresCompetitiveResearchRepository
} from '@appsea/db/competitive-research'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../../server/private-opportunity'
import { getDatabasePool } from '../../../../../../../server/database'
import {
  canReadProductionWorkflow,
  canStartProductionWorkflow
} from '../../../../../../../server/production-workflow-gateway'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: {
  workspaceId: string
  slug: string
}): { workspaceId: string; slug: string } | undefined {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  if (!workspaceId.success || !slug.success) return undefined
  return { workspaceId: workspaceId.data, slug: slug.data }
}

function mapError(error: unknown): Response | undefined {
  if (error instanceof CompetitiveResearchObservationPermissionError) return forbiddenResponse()
  if (error instanceof CompetitiveResearchObservationNotFoundError) {
    return Response.json(
      { error: 'Opportunity or observation not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (error instanceof CompetitiveResearchObservationConflictError) {
    return Response.json(
      { error: 'Observation conflicts with existing provenance or review state' },
      { status: 409, headers: privateResponseHeaders }
    )
  }
  if (error instanceof CompetitiveResearchObservationPolicyError) {
    return Response.json(
      { error: 'Source policy does not permit this competitor observation' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  return undefined
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid opportunity path')
  if (!canReadProductionWorkflow(session, path.workspaceId)) return forbiddenResponse()
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  return Response.json(
    { data: privateContext.detail.competitiveResearch },
    { headers: privateResponseHeaders }
  )
}

export async function POST(
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
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 32_000) return invalidRequest('Request body is too large')
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = competitiveResearchObservationCreateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid competitor observation is required')

  try {
    const data = await new PostgresCompetitiveResearchRepository(getDatabasePool()).create(
      session.user.userId,
      path.workspaceId,
      privateContext.detail.opportunity.id,
      parsed.data
    )
    return Response.json({ data }, { status: 201, headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('AppSea competitor observation create failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to create competitor observation' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
