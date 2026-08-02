import {
  appseaIdentifierSchema,
  workspaceComplaintReviewInputSchema,
  workspaceEvidenceRedactionInputSchema
} from '@appsea/contracts'
import {
  PostgresProductionCollectionRepository,
  ProductionComplaintReviewConflictError,
  ProductionComplaintReviewNotFoundError,
  ProductionComplaintReviewPermissionError
} from '@appsea/db/production-collection'
import { WorkspaceAuthorizationError } from '@appsea/db'
import {
  EvidenceRedactionConflictError,
  EvidenceRedactionNotFoundError,
  EvidenceRedactionPermissionError,
  PostgresEvidenceRedactionRepository
} from '@appsea/db/evidence-redaction'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseComplaintPath(context: {
  params: Promise<{ workspaceId: string; runId: string; complaintId: string }>
}) {
  return context.params.then(({ workspaceId, runId, complaintId }) => ({
    workspaceId: appseaIdentifierSchema.safeParse(workspaceId),
    runId: appseaIdentifierSchema.safeParse(runId),
    complaintId: appseaIdentifierSchema.safeParse(complaintId)
  }))
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string
      runId: string
      complaintId: string
    }>
  }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const {
    workspaceId: parsedWorkspaceId,
    runId: parsedRunId,
    complaintId: parsedComplaintId
  } = await parseComplaintPath(context)
  if (!parsedWorkspaceId.success || !parsedRunId.success || !parsedComplaintId.success) {
    return invalidRequest('Invalid complaint review path')
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceComplaintReviewInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid complaint review action is required')

  try {
    const data = await new PostgresProductionCollectionRepository(
      getDatabasePool()
    ).updateComplaintReview(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedRunId.data,
      parsedComplaintId.data,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof ProductionComplaintReviewPermissionError
    ) {
      return forbiddenResponse()
    }
    if (error instanceof ProductionComplaintReviewNotFoundError) {
      return Response.json(
        { error: 'Production complaint not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof ProductionComplaintReviewConflictError) {
      return Response.json(
        { error: 'Complaint review transition is not permitted' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea complaint review update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update complaint review' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string
      runId: string
      complaintId: string
    }>
  }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()

  const { workspaceId, runId, complaintId } = await parseComplaintPath(context)
  if (!workspaceId.success || !runId.success || !complaintId.success) {
    return invalidRequest('Invalid evidence redaction path')
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceEvidenceRedactionInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid evidence redaction is required')
  if (parsed.data.evidenceId.length < 3) return invalidRequest('Invalid evidence redaction target')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }

    const data = await new PostgresEvidenceRedactionRepository(getDatabasePool()).redact(
      session.user.userId,
      workspaceId.data,
      runId.data,
      complaintId.data,
      parsed.data.evidenceId,
      {
        redactionId: parsed.data.redactionId,
        fields: parsed.data.fields,
        reason: parsed.data.reason
      }
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof EvidenceRedactionPermissionError
    ) {
      return forbiddenResponse()
    }
    if (error instanceof EvidenceRedactionNotFoundError) {
      return Response.json(
        { error: 'Evidence redaction target not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof EvidenceRedactionConflictError) {
      return Response.json(
        { error: 'Evidence redaction conflicts with an existing event' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea evidence redaction failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to redact evidence' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
