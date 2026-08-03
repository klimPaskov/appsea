import {
  appseaIdentifierSchema,
  workspacePurgeRequestCancelInputSchema,
  workspacePurgeRequestInputSchema
} from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspacePurgeRequestNotReadyError,
  WorkspacePurgeRequestPermissionError
} from '@appsea/db/auth'
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
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function workspaceIdFromContext(context: {
  params: Promise<{ workspaceId: string }>
}): Promise<string | null> {
  const parsed = appseaIdentifierSchema.safeParse((await context.params).workspaceId)
  return parsed.success ? parsed.data : null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = await workspaceIdFromContext(context)
  if (!workspaceId) return invalidRequest('Invalid workspace')

  try {
    const data = await authRepository().readWorkspacePurgeRequest(session.user.userId, workspaceId)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    console.error('AppSea workspace purge request read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read workspace purge request' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = await workspaceIdFromContext(context)
  if (!workspaceId) return invalidRequest('Invalid workspace')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspacePurgeRequestInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Type REQUEST WORKSPACE PURGE to continue')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    const data = await authRepository().requestWorkspacePurge(
      session.user.userId,
      workspaceId,
      parsed.data
    )
    return Response.json({ data }, { status: 202, headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspacePurgeRequestNotReadyError) {
      return Response.json(
        {
          error: 'Finish the database readiness gates before requesting workspace purge',
          data: error.readiness
        },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspacePurgeRequestPermissionError
    ) {
      return forbiddenResponse()
    }
    console.error('AppSea workspace purge request failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to request workspace purge' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = await workspaceIdFromContext(context)
  if (!workspaceId) return invalidRequest('Invalid workspace')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspacePurgeRequestCancelInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Type CANCEL WORKSPACE PURGE to continue')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    const data = await authRepository().cancelWorkspacePurge(
      session.user.userId,
      workspaceId,
      parsed.data
    )
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspacePurgeRequestPermissionError
    ) {
      return forbiddenResponse()
    }
    console.error('AppSea workspace purge cancellation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to cancel workspace purge request' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
