import { appseaIdentifierSchema } from '@appsea/contracts'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse,
  authRepository
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
  if (!parsedWorkspaceId.success)
    return Response.json({ error: 'Invalid workspace' }, { status: 400 })
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }
  const data = await authRepository().listWorkspaceOpportunities(
    session.user.userId,
    parsedWorkspaceId.data
  )
  return Response.json(
    {
      data,
      meta: { synthetic: data.every((opportunity) => opportunity.synthetic) }
    },
    { headers: privateResponseHeaders }
  )
}
