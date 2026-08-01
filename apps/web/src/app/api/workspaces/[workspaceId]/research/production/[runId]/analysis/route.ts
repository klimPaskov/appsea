import {
  appseaIdentifierSchema,
  productionAnalysisReviewStartRequestSchema,
  type ProductionAnalysisWorkflowStartRequest
} from '@appsea/contracts'
import {
  ProductionCollectionAnalysisUnavailableError,
  PostgresProductionCollectionRepository
} from '@appsea/db/production-collection'
import { PostgresOpportunitySeedReviewRepository } from '@appsea/db/opportunity-seed-review'
import { startProductionAnalysisWorkflow } from '@appsea/workflows'
import { NextResponse } from 'next/server'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../../server/database'
import { canStartProductionWorkflow } from '../../../../../../../../server/production-workflow-gateway'
import { getTemporalWorkflowClient } from '../../../../../../../../server/temporal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ANALYSIS_START_BODY_BYTES = 128 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; runId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, runId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedRunId = appseaIdentifierSchema.safeParse(runId)
  if (!parsedWorkspaceId.success || !parsedRunId.success) {
    return invalidRequest('Invalid collection path')
  }
  if (!canStartProductionWorkflow(session, parsedWorkspaceId.data)) return forbiddenResponse()
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.isFinite(Number(contentLength))) {
    if (Number(contentLength) > MAX_ANALYSIS_START_BODY_BYTES) {
      return Response.json(
        { error: 'Production analysis request is too large' },
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
  if (new TextEncoder().encode(bodyText).byteLength > MAX_ANALYSIS_START_BODY_BYTES) {
    return Response.json(
      { error: 'Production analysis request is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(bodyText) as unknown
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  if (!isRecord(payload)) return invalidRequest('Production analysis request is invalid')
  if (
    (payload.workspaceId !== undefined && payload.workspaceId !== parsedWorkspaceId.data) ||
    (payload.collectionRunId !== undefined && payload.collectionRunId !== parsedRunId.data)
  ) {
    return invalidRequest('Production analysis path does not match the request')
  }
  const parsed = productionAnalysisReviewStartRequestSchema.safeParse({
    ...payload,
    workspaceId: parsedWorkspaceId.data,
    collectionRunId: parsedRunId.data
  })
  if (!parsed.success || parsed.data.analysisRunId === parsed.data.collectionRunId) {
    return invalidRequest('Production analysis request is invalid')
  }

  try {
    const source = await new PostgresProductionCollectionRepository(
      getDatabasePool()
    ).readForAnalysis(session.user.userId, parsedWorkspaceId.data, parsedRunId.data)
    if (!source) return Response.json({ error: 'Collection not found' }, { status: 404 })
    const seedReview = await new PostgresOpportunitySeedReviewRepository(
      getDatabasePool()
    ).readApprovedForUser(session.user.userId, parsedWorkspaceId.data, parsed.data.seedReviewId)
    if (!seedReview) {
      return Response.json(
        { error: 'An approved opportunity seed review is required' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    const workflowRequest: ProductionAnalysisWorkflowStartRequest = {
      workspaceId: parsedWorkspaceId.data,
      collectionRunId: parsedRunId.data,
      analysisRunId: parsed.data.analysisRunId,
      idempotencyKey: parsed.data.idempotencyKey,
      workflowVersion: 'production-analysis-v2',
      requestedAt: parsed.data.requestedAt,
      seedReviewId: seedReview.seedReviewId
    }
    const handle = await startProductionAnalysisWorkflow(
      await getTemporalWorkflowClient(),
      workflowRequest
    )
    return NextResponse.json(
      { data: { workflowId: handle.workflowId, analysisRunId: parsed.data.analysisRunId } },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof ProductionCollectionAnalysisUnavailableError) {
      return Response.json(
        { error: 'Collection needs confirmed excerpt evidence before analysis can start' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (error instanceof Error && error.message.includes('idempotency key conflicts')) {
      return Response.json(
        { error: 'Analysis idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea production analysis workflow start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to start production analysis' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
