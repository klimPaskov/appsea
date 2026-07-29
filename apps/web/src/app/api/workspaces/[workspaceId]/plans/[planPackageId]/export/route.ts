import { appseaIdentifierSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspacePlanNotApprovedError,
  WorkspacePlanNotFoundError
} from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getObjectStore } from '../../../../../../../server/object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; planPackageId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, planPackageId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedPlanPackageId = appseaIdentifierSchema.safeParse(planPackageId)
  if (!parsedWorkspaceId.success || !parsedPlanPackageId.success) {
    return Response.json(
      { error: 'Invalid plan path' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    const data = await authRepository({ objectStore: getObjectStore() }).exportWorkspacePlan(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedPlanPackageId.data
    )
    return Response.json(
      { data },
      {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-plan-package.json"',
          'content-type': 'application/json; charset=utf-8'
        }
      }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    if (error instanceof WorkspacePlanNotFoundError) {
      return Response.json(
        { error: 'Plan package not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof WorkspacePlanNotApprovedError) {
      return Response.json(
        { error: 'Only approved plans can be exported' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea plan export failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to export plan' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
