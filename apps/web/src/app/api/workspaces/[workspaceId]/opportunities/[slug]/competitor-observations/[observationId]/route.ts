import {
  appseaIdentifierSchema,
  competitiveResearchObservationReviewInputSchema,
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
  requireRecentMutationStepUp,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../../server/database'
import { readPrivateOpportunityContext } from '../../../../../../../../server/private-opportunity'
import { canStartProductionWorkflow } from '../../../../../../../../server/production-workflow-gateway'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      { error: 'Observation review transition is not permitted' },
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

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; slug: string; observationId: string }>
  }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const params = await context.params
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  const observationId = appseaIdentifierSchema.safeParse(params.observationId)
  if (!workspaceId.success || !slug.success || !observationId.success) {
    return invalidRequest('Invalid competitor observation path')
  }
  if (!canStartProductionWorkflow(session, workspaceId.data)) return forbiddenResponse()
  const privateContext = await readPrivateOpportunityContext(workspaceId.data, slug.data)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = competitiveResearchObservationReviewInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid competitor observation review is required')

  try {
    const stepUpResponse = await requireRecentMutationStepUp()
    if (stepUpResponse) return stepUpResponse
    const data = await new PostgresCompetitiveResearchRepository(getDatabasePool()).updateReview(
      session.user.userId,
      workspaceId.data,
      privateContext.detail.opportunity.id,
      observationId.data,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('AppSea competitor observation review failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update competitor observation review' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
