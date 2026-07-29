import {
  appseaIdentifierSchema,
  workspaceOpportunitySeedCreateInputSchema
} from '@appsea/contracts'
import {
  OpportunitySeedReviewConflictError,
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
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'
import {
  canReadProductionWorkflow,
  canStartProductionWorkflow
} from '../../../../../server/production-workflow-gateway'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SEED_REVIEW_BODY_BYTES = 512 * 1024

function bodyTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('content-length')
  return Boolean(
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_SEED_REVIEW_BODY_BYTES
  )
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const body = await request.text()
  return new TextEncoder().encode(body).byteLength > MAX_SEED_REVIEW_BODY_BYTES ? null : body
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  if (!canReadProductionWorkflow(session, parsedWorkspaceId.data)) return forbiddenResponse()
  try {
    const reviews = await new PostgresOpportunitySeedReviewRepository(
      getDatabasePool()
    ).listForUser(session.user.userId, parsedWorkspaceId.data)
    return NextResponse.json({ data: reviews }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea seed review list failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read opportunity seed reviews' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

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
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  if (!canStartProductionWorkflow(session, parsedWorkspaceId.data)) return forbiddenResponse()
  if (bodyTooLarge(request)) {
    return Response.json(
      { error: 'Opportunity seed review is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let body: string | null
  try {
    body = await readBoundedBody(request)
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  if (body === null) {
    return Response.json(
      { error: 'Opportunity seed review is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(body) as unknown
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceOpportunitySeedCreateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Opportunity seed review is invalid')

  try {
    const created = await new PostgresOpportunitySeedReviewRepository(getDatabasePool()).create(
      session.user.userId,
      parsedWorkspaceId.data,
      parsed.data
    )
    return NextResponse.json({ data: created }, { status: 201, headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof OpportunitySeedReviewPermissionError) return forbiddenResponse()
    if (error instanceof OpportunitySeedReviewConflictError) {
      return Response.json(
        { error: 'Seed review identifier or content already exists' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea seed review create failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to create opportunity seed review' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
