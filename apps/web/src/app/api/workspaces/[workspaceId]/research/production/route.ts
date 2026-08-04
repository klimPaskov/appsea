import {
  appseaIdentifierSchema,
  productionCollectionWorkflowStartRequestSchema
} from '@appsea/contracts'
import {
  PostgresProductionWorkflowAdmissionRepository,
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError
} from '@appsea/db/production-workflow-admission'
import { PostgresProductionCollectionRepository } from '@appsea/db'
import {
  OpportunitySeedReviewLineageError,
  PostgresOpportunitySeedReviewRepository
} from '@appsea/db/opportunity-seed-review'
import {
  prepareProductionCollectionWorkflowStart,
  startProductionCollectionWorkflow
} from '@appsea/workflows'
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
  canStartProductionWorkflow,
  parseProductionWorkflowStartRequest,
  productionWorkspaceFromSession
} from '../../../../../../server/production-workflow-gateway'
import { getTemporalWorkflowClient } from '../../../../../../server/temporal'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MAX_PRODUCTION_WORKFLOW_BODY_BYTES = 64 * 1024

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
  const workspace = productionWorkspaceFromSession(session, parsedWorkspaceId.data)
  if (!workspace || !canStartProductionWorkflow(session, parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.isFinite(Number(contentLength))) {
    if (Number(contentLength) > MAX_PRODUCTION_WORKFLOW_BODY_BYTES) {
      return Response.json(
        { error: 'Production collection workflow request is too large' },
        { status: 413, headers: privateResponseHeaders }
      )
    }
  }
  let bodyText: string
  try {
    bodyText = await request.text()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  if (new TextEncoder().encode(bodyText).byteLength > MAX_PRODUCTION_WORKFLOW_BODY_BYTES) {
    return Response.json(
      { error: 'Production collection workflow request is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(bodyText) as unknown
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = parseProductionWorkflowStartRequest(parsedWorkspaceId.data, payload)
  if (!parsed) return invalidRequest('Production collection workflow request is invalid')
  const strict = productionCollectionWorkflowStartRequestSchema.safeParse(parsed)
  if (!strict.success) return invalidRequest('Production collection workflow request is invalid')
  if (strict.data.analysisSeedReviewId) {
    let approvedSeed: Awaited<
      ReturnType<PostgresOpportunitySeedReviewRepository['readApprovedForUser']>
    >
    try {
      approvedSeed = await new PostgresOpportunitySeedReviewRepository(
        getDatabasePool()
      ).readApprovedForUser(
        session.user.userId,
        parsedWorkspaceId.data,
        strict.data.analysisSeedReviewId
      )
    } catch (error) {
      if (error instanceof OpportunitySeedReviewLineageError) {
        return Response.json(
          {
            error:
              'The approved opportunity seed uses an older coding-package manifest; replace it before automatic analysis.'
          },
          { status: 422, headers: privateResponseHeaders }
        )
      }
      return Response.json(
        { error: 'Unable to verify the analysis seed review' },
        { status: 503, headers: privateResponseHeaders }
      )
    }
    if (!approvedSeed) {
      return Response.json(
        { error: 'An approved opportunity seed review is required for automatic analysis' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
  }
  if (strict.data.recollectionTombstoneId) {
    let recollectionTarget: Awaited<
      ReturnType<PostgresProductionCollectionRepository['readRecollectionTargetForUser']>
    >
    try {
      recollectionTarget = await new PostgresProductionCollectionRepository(
        getDatabasePool()
      ).readRecollectionTargetForUser(
        session.user.userId,
        parsedWorkspaceId.data,
        strict.data.recollectionTombstoneId,
        strict.data.sourceId
      )
    } catch {
      return Response.json(
        { error: 'Unable to verify the source deletion tombstone' },
        { status: 503, headers: privateResponseHeaders }
      )
    }
    if (!recollectionTarget) {
      return Response.json(
        { error: 'A completed matching deletion tombstone is required for re-collection' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
  }
  const actorBoundRequest = productionCollectionWorkflowStartRequestSchema.parse({
    ...strict.data,
    requestedBy: { actorType: 'user', actorId: session.user.userId }
  })
  const prepared = prepareProductionCollectionWorkflowStart(actorBoundRequest)
  try {
    await new PostgresProductionWorkflowAdmissionRepository(getDatabasePool()).admitForUser({
      workspaceId: parsedWorkspaceId.data,
      userId: session.user.userId,
      idempotencyDigest: prepared.input.idempotencyDigest,
      inputHash: prepared.input.inputHash
    })
  } catch (error) {
    if (error instanceof ProductionWorkflowRateLimitError) {
      const headers = new Headers(privateResponseHeaders)
      headers.set('retry-after', String(error.retryAfterSeconds))
      return Response.json(
        { error: 'Production collection start rate limit exceeded' },
        { status: 429, headers }
      )
    }
    if (error instanceof ProductionWorkflowConcurrencyLimitError) {
      const headers = new Headers(privateResponseHeaders)
      headers.set('retry-after', String(error.retryAfterSeconds))
      return Response.json(
        { error: 'Production collection concurrency limit reached' },
        { status: 429, headers }
      )
    }
    if (error instanceof ProductionWorkflowAdmissionConflictError) {
      return Response.json(
        { error: 'Workflow idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea production workflow admission failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to admit production collection' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  try {
    const client = await getTemporalWorkflowClient()
    const handle = await startProductionCollectionWorkflow(client, actorBoundRequest)
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
    console.error('AppSea production collection workflow start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to start production collection' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
