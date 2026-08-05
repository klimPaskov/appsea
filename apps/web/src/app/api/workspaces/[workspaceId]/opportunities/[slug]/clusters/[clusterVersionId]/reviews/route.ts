import {
  appseaIdentifierSchema,
  opportunitySlugSchema,
  workspaceClusterReviewInputSchema
} from '@appsea/contracts'
import {
  ClusterReviewBlockedError,
  ClusterReviewConflictError,
  ClusterReviewNotFoundError,
  ClusterReviewPermissionError,
  PostgresClusterReviewRepository
} from '@appsea/db/cluster-review'
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
} from '../../../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../../../server/database'
import { readPrivateOpportunityContext } from '../../../../../../../../../server/private-opportunity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: { workspaceId: string; slug: string; clusterVersionId: string }) {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const slug = opportunitySlugSchema.safeParse(params.slug)
  const clusterVersionId = appseaIdentifierSchema.safeParse(params.clusterVersionId)
  if (!workspaceId.success || !slug.success || !clusterVersionId.success) return undefined
  return {
    workspaceId: workspaceId.data,
    slug: slug.data,
    clusterVersionId: clusterVersionId.data
  }
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; slug: string; clusterVersionId: string }>
  }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid cluster review path')
  const privateContext = await readPrivateOpportunityContext(path.workspaceId, path.slug)
  if (!privateContext) {
    return Response.json(
      { error: 'Opportunity not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (privateContext.detail.summary.synthetic) {
    return Response.json(
      { error: 'Fixture clusters are read-only' },
      { status: 409, headers: privateResponseHeaders }
    )
  }
  if (privateContext.workspace.role !== 'owner' && privateContext.workspace.role !== 'editor') {
    return forbiddenResponse()
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    return invalidRequest('A valid Idempotency-Key header is required')
  }
  const body = await readBoundedJsonBody(request, 64_000)
  if (!body.ok) {
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceClusterReviewInputSchema.safeParse(body.value)
  if (!parsed.success) return invalidRequest('A valid cluster review action is required')
  try {
    const stepUpResponse = await requireRecentMutationStepUp()
    if (stepUpResponse) return stepUpResponse
    const review = await new PostgresClusterReviewRepository(getDatabasePool()).createForUser(
      session.user.userId,
      path.workspaceId,
      privateContext.detail.opportunity.id,
      path.clusterVersionId,
      parsed.data,
      idempotencyKey
    )
    const clusters = await new PostgresClusterReviewRepository(getDatabasePool()).listForUser(
      session.user.userId,
      path.workspaceId,
      privateContext.detail.opportunity.id
    )
    return Response.json(
      {
        data: review,
        cluster: clusters.find((entry) => entry.clusterVersionId === path.clusterVersionId) ?? null
      },
      { headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof ClusterReviewPermissionError) return forbiddenResponse()
    if (error instanceof ClusterReviewNotFoundError) {
      return Response.json(
        { error: 'Cluster not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof ClusterReviewConflictError || error instanceof ClusterReviewBlockedError) {
      return Response.json(
        { error: error.message },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea cluster review failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to record cluster review' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
