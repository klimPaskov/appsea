import {
  appseaIdentifierSchema,
  sourceSnapshotReconciliationInputSchema,
  sourceSnapshotReconciliationStartRequestSchema
} from '@appsea/contracts'
import {
  contentHash,
  PostgresSourceSnapshotReconciliationRepository,
  SourceSnapshotReconciliationAdmissionDeniedError,
  SourceSnapshotReconciliationConcurrencyLimitError,
  SourceSnapshotReconciliationConflictError,
  SourceSnapshotReconciliationPolicyDeniedError,
  SourceSnapshotReconciliationRateLimitError,
  sha256
} from '@appsea/db'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SOURCE_RECONCILIATION_BODY_BYTES = 32 * 1024
const CFPB_SOURCE_ID = 'cfpb-consumer-complaints'

function limitedResponse(message: string, retryAfterSeconds: number): Response {
  const headers = new Headers(privateResponseHeaders)
  headers.set('retry-after', String(retryAfterSeconds))
  return Response.json({ error: message }, { status: 429, headers })
}

export async function POST(
  request: Request,
  context: { params: Promise<unknown> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()

  const params = await context.params
  if (
    typeof params !== 'object' ||
    params === null ||
    !('workspaceId' in params) ||
    typeof params.workspaceId !== 'string'
  ) {
    return invalidRequest('Invalid workspace')
  }
  const { workspaceId } = params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')
  const membership = session.workspaces.find(
    (workspace) => workspace.workspaceId === parsedWorkspaceId.data
  )
  if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
    return forbiddenResponse()
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.isFinite(Number(contentLength))) {
    if (Number(contentLength) > MAX_SOURCE_RECONCILIATION_BODY_BYTES) {
      return Response.json(
        { error: 'Source reconciliation request is too large' },
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
  if (new TextEncoder().encode(bodyText).byteLength > MAX_SOURCE_RECONCILIATION_BODY_BYTES) {
    return Response.json(
      { error: 'Source reconciliation request is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(bodyText) as unknown
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = sourceSnapshotReconciliationStartRequestSchema.safeParse(payload)
  if (!parsed.success || parsed.data.sourceId !== CFPB_SOURCE_ID) {
    return invalidRequest('Source reconciliation request is invalid')
  }

  const idempotencyKey = sha256(parsed.data.idempotencyKey)
  const input = sourceSnapshotReconciliationInputSchema.parse({
    workspaceId: parsedWorkspaceId.data,
    reconciliationId: `reconciliation:source:${contentHash({
      workspaceId: parsedWorkspaceId.data,
      sourceId: parsed.data.sourceId,
      idempotencyKey
    }).slice(0, 32)}`,
    sourceId: parsed.data.sourceId,
    policyVersion: parsed.data.policyVersion,
    idempotencyKey,
    pageSize: parsed.data.pageSize,
    maxRecords: parsed.data.maxRecords,
    requestedAt: parsed.data.requestedAt
  })

  try {
    const job = await new PostgresSourceSnapshotReconciliationRepository(
      getDatabasePool()
    ).enqueueForUser(input, session.user.userId)
    return Response.json({ data: job }, { status: 202, headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof SourceSnapshotReconciliationAdmissionDeniedError) {
      return forbiddenResponse()
    }
    if (error instanceof SourceSnapshotReconciliationRateLimitError) {
      return limitedResponse(
        'Source reconciliation start rate limit exceeded',
        error.retryAfterSeconds
      )
    }
    if (error instanceof SourceSnapshotReconciliationConcurrencyLimitError) {
      return limitedResponse('A source reconciliation is already running', error.retryAfterSeconds)
    }
    if (error instanceof SourceSnapshotReconciliationConflictError) {
      return Response.json(
        { error: 'Source reconciliation idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof SourceSnapshotReconciliationPolicyDeniedError) {
      return Response.json(
        { error: 'The requested source policy is not approved for reconciliation' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea source reconciliation admission failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to admit source reconciliation' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
