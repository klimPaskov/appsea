import { appseaIdentifierSchema, workspacePlanApprovalInputSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspacePlanApprovalConflictError,
  WorkspacePlanNotFoundError,
  WorkspacePlanPermissionError
} from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  requireRecentMutationStepUp,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getObjectStore } from '../../../../../../server/object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; planPackageId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid plan path')

  try {
    const data = await authRepository({
      objectStore: getObjectStore()
    }).readWorkspacePlanVersionForUser(session.user.userId, path.workspaceId, path.planPackageId)
    if (!data) {
      return Response.json(
        { error: 'Plan package not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    console.error('AppSea plan version read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read plan' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

function parsePath(params: {
  workspaceId: string
  planPackageId: string
}): { workspaceId: string; planPackageId: string } | undefined {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const planPackageId = appseaIdentifierSchema.safeParse(params.planPackageId)
  if (!workspaceId.success || !planPackageId.success) return undefined
  return { workspaceId: workspaceId.data, planPackageId: planPackageId.data }
}

function mapMutationError(error: unknown): Response | undefined {
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof WorkspacePlanPermissionError
  ) {
    return forbiddenResponse()
  }
  if (error instanceof WorkspacePlanNotFoundError) {
    return Response.json(
      { error: 'Plan package not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }
  if (error instanceof WorkspacePlanApprovalConflictError) {
    return Response.json(
      { error: 'Plan approval transition is not permitted' },
      { status: 409, headers: privateResponseHeaders }
    )
  }
  return undefined
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; planPackageId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid plan path')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspacePlanApprovalInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid plan approval action is required')

  try {
    const stepUpResponse = await requireRecentMutationStepUp()
    if (stepUpResponse) return stepUpResponse
    const data = await authRepository({
      objectStore: getObjectStore()
    }).updateWorkspacePlanApproval(
      session.user.userId,
      path.workspaceId,
      path.planPackageId,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapMutationError(error)
    if (mapped) return mapped
    console.error('AppSea plan approval update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update plan approval' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
