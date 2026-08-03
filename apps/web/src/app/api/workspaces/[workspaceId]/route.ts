import { appseaIdentifierSchema, workspaceArchiveInputSchema } from '@appsea/contracts'
import { WorkspaceArchivePermissionError, WorkspaceAuthorizationError } from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  invalidRequest,
  mfaReauthenticationRequiredResponse,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const session = await readSession()
  if (!session) return unauthorizedResponse()

  const workspaceId = appseaIdentifierSchema.safeParse((await context.params).workspaceId)
  if (!workspaceId.success) return invalidRequest('Invalid workspace')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceArchiveInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Type ARCHIVE WORKSPACE to archive this workspace')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }

    const data = await authRepository().archiveWorkspace(
      session.user.userId,
      workspaceId.data,
      parsed.data
    )
    if (data.state === 'blocked') {
      return Response.json(
        {
          error: 'Finish active research before archiving this workspace',
          data
        },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspaceArchivePermissionError
    ) {
      return forbiddenResponse()
    }
    console.error('AppSea workspace archival failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to archive the workspace' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
