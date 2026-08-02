import { appseaIdentifierSchema } from '@appsea/contracts'
import { WorkspaceAuthorizationError } from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Owner-only, read-only inventory for a future reviewed workspace purge.
 * This route reports blockers; it never queues or performs deletion.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse((await context.params).workspaceId)
  if (!parsedWorkspaceId.success) {
    return Response.json(
      { error: 'Invalid workspace' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    const data = await authRepository().readWorkspacePurgeReadiness(
      session.user.userId,
      parsedWorkspaceId.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    console.error('AppSea workspace purge readiness failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read workspace purge readiness' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
