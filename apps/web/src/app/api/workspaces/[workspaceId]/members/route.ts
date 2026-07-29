import { appseaIdentifierSchema } from '@appsea/contracts'
import { WorkspaceAuthorizationError, WorkspaceMembershipManagementError } from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace')

  try {
    const data = await authRepository().listWorkspaceMembers(
      session.user.userId,
      parsedWorkspaceId.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspaceMembershipManagementError
    )
      return forbiddenResponse()
    console.error('AppSea workspace member listing failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read workspace members' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
