import {
  appseaIdentifierSchema,
  opportunitySlugSchema,
  workspaceOpportunityDecisionInputSchema
} from '@appsea/contracts'
import {
  OpportunityDecisionBlockedError,
  OpportunityDecisionConflictError,
  OpportunityDecisionNotFoundError,
  OpportunityDecisionPermissionError,
  PostgresOpportunityDecisionRepository
} from '@appsea/db/opportunity-decision'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSession,
  requireRecentMutationStepUp,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../server/database'
import { readPrivateOpportunityContext } from '../../../../../../../server/private-opportunity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: { workspaceId: string; slug: string }) {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  if (!workspaceId.success || !slug.success) return undefined
  return { workspaceId: workspaceId.data, slug: slug.data }
}

function mapMutationError(error: unknown): Response | undefined {
  if (error instanceof OpportunityDecisionPermissionError) return forbiddenResponse()
  if (error instanceof OpportunityDecisionNotFoundError) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (
    error instanceof OpportunityDecisionConflictError ||
    error instanceof OpportunityDecisionBlockedError
  ) {
    return Response.json({ error: error.message }, { status: 409, headers: privateResponseHeaders })
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
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  const data = await new PostgresOpportunityDecisionRepository(getDatabasePool()).listForUser(
    session.user.userId,
    path.workspaceId,
    privateContext.detail.opportunity.id
  )
  return Response.json({ data }, { headers: privateResponseHeaders })
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
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    return invalidRequest('A valid Idempotency-Key header is required')
  }
  const body = await readBoundedJsonBody(request, 64_000)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = workspaceOpportunityDecisionInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid opportunity decision is required')

  try {
    const stepUpResponse = await requireRecentMutationStepUp()
    if (stepUpResponse) return stepUpResponse
    const data = await new PostgresOpportunityDecisionRepository(getDatabasePool()).createForUser(
      session.user.userId,
      path.workspaceId,
      privateContext.detail.opportunity.id,
      parsed.data,
      idempotencyKey
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapMutationError(error)
    if (mapped) return mapped
    console.error('AppSea opportunity decision failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to record opportunity decision' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
