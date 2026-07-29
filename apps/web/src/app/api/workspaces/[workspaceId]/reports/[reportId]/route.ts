import { appseaIdentifierSchema, workspaceReportApprovalInputSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspaceReportApprovalConflictError,
  WorkspaceReportNotFoundError,
  WorkspaceReportPermissionError
} from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getObjectStore } from '../../../../../../server/object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: {
  workspaceId: string
  reportId: string
}): { workspaceId: string; reportId: string } | undefined {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const reportId = appseaIdentifierSchema.safeParse(params.reportId)
  if (!workspaceId.success || !reportId.success) return undefined
  return { workspaceId: workspaceId.data, reportId: reportId.data }
}

function mapMutationError(error: unknown): Response | undefined {
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof WorkspaceReportPermissionError
  ) {
    return forbiddenResponse()
  }
  if (error instanceof WorkspaceReportNotFoundError) {
    return Response.json(
      { error: 'Report not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (error instanceof WorkspaceReportApprovalConflictError) {
    return Response.json(
      { error: 'Report approval transition is not permitted' },
      { status: 409, headers: privateResponseHeaders }
    )
  }
  return undefined
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; reportId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid report path')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceReportApprovalInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid report approval action is required')

  try {
    const data = await authRepository({
      objectStore: getObjectStore()
    }).updateWorkspaceReportApproval(
      session.user.userId,
      path.workspaceId,
      path.reportId,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapMutationError(error)
    if (mapped) return mapped
    console.error('AppSea report approval update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update report approval' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
