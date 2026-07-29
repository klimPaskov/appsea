import { appseaIdentifierSchema, workspaceMemberRoleUpdateInputSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspaceMembershipConflictError,
  WorkspaceMembershipManagementError,
  WorkspaceMembershipNotFoundError
} from '@appsea/db/auth'
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
} from '../../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePath(params: {
  workspaceId: string
  userId: string
}): { workspaceId: string; userId: string } | undefined {
  const workspaceId = appseaIdentifierSchema.safeParse(params.workspaceId)
  const userId = appseaIdentifierSchema.safeParse(params.userId)
  if (!workspaceId.success || !userId.success) return undefined
  return { workspaceId: workspaceId.data, userId: userId.data }
}

function mapMutationError(error: unknown): Response | undefined {
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof WorkspaceMembershipManagementError
  ) {
    return forbiddenResponse()
  }
  if (error instanceof WorkspaceMembershipNotFoundError) {
    return Response.json(
      { error: 'Workspace member was not found' },
      {
        status: 404,
        headers: privateResponseHeaders
      }
    )
  }
  if (error instanceof WorkspaceMembershipConflictError) {
    return Response.json(
      { error: 'The workspace must retain at least one owner' },
      {
        status: 409,
        headers: privateResponseHeaders
      }
    )
  }
  return undefined
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid workspace member')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceMemberRoleUpdateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid member role is required')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    const data = await authRepository().updateWorkspaceMemberRole(
      session.user.userId,
      path.workspaceId,
      path.userId,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapMutationError(error)
    if (mapped) return mapped
    console.error('AppSea workspace member role update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update workspace member' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const path = parsePath(await context.params)
  if (!path) return invalidRequest('Invalid workspace member')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    await authRepository().removeWorkspaceMember(session.user.userId, path.workspaceId, path.userId)
    return Response.json({ data: { removed: true } }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapMutationError(error)
    if (mapped) return mapped
    console.error('AppSea workspace member removal failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to remove workspace member' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
