import {
  appseaIdentifierSchema,
  workspaceOpportunitySeedApprovalInputSchema
} from '@appsea/contracts'
import {
  OpportunitySeedReviewConflictError,
  OpportunitySeedReviewNotFoundError,
  OpportunitySeedReviewPermissionError,
  PostgresOpportunitySeedReviewRepository
} from '@appsea/db/opportunity-seed-review'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'
import { canReadProductionWorkflow } from '../../../../../../server/production-workflow-gateway'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SEED_REVIEW_ACTION_BODY_BYTES = 16 * 1024

async function readBoundedBody(request: Request): Promise<string | null> {
  const body = await request.text()
  return new TextEncoder().encode(body).byteLength > MAX_SEED_REVIEW_ACTION_BODY_BYTES ? null : body
}

function parsePath(params: {
  workspaceId: string
  seedReviewId: string
}): { workspaceId: string; seedReviewId: string } | undefined {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const seedReviewId = appseaIdentifierSchema.safeParse(params.seedReviewId)
  if (!workspaceId.success || !seedReviewId.success) return undefined
  return { workspaceId: workspaceId.data, seedReviewId: seedReviewId.data }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; seedReviewId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path || !canReadProductionWorkflow(session, path.workspaceId)) return forbiddenResponse()
  try {
    const data = await new PostgresOpportunitySeedReviewRepository(getDatabasePool()).readForUser(
      session.user.userId,
      path.workspaceId,
      path.seedReviewId
    )
    if (!data) {
      return Response.json(
        { error: 'Opportunity seed review not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea seed review read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read opportunity seed review' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; seedReviewId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid opportunity seed review path')
  let body: string | null
  try {
    body = await readBoundedBody(request)
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  if (body === null) {
    return Response.json(
      { error: 'Opportunity seed review action is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(body) as unknown
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceOpportunitySeedApprovalInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid opportunity seed review action is required')
  try {
    const data = await new PostgresOpportunitySeedReviewRepository(
      getDatabasePool()
    ).updateApproval(session.user.userId, path.workspaceId, path.seedReviewId, parsed.data)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof OpportunitySeedReviewPermissionError) return forbiddenResponse()
    if (error instanceof OpportunitySeedReviewNotFoundError) {
      return Response.json(
        { error: 'Opportunity seed review not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof OpportunitySeedReviewConflictError) {
      return Response.json(
        { error: 'Opportunity seed review transition is not permitted' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea seed review update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update opportunity seed review' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
