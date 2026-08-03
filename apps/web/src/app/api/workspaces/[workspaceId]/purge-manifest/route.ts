import { appseaIdentifierSchema, workspacePurgeManifestInputSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspacePurgeManifestNotReadyError,
  WorkspacePurgeManifestPermissionError
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

/** Read the latest owner-visible metadata-only manifest. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = await workspaceIdFromContext(context)
  if (!workspaceId) return invalidRequest('Invalid workspace')

  try {
    const data = await authRepository().readWorkspacePurgeManifest(session.user.userId, workspaceId)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspacePurgeManifestPermissionError
    ) {
      return forbiddenResponse()
    }
    console.error('AppSea workspace purge manifest read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read workspace purge manifest' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

/** Prepare an owner-confirmed, expiring object-reference inventory. */
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
  const parsed = workspacePurgeManifestInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Type PREPARE WORKSPACE PURGE MANIFEST to continue')

  try {
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    const data = await authRepository().prepareWorkspacePurgeManifest(
      session.user.userId,
      workspaceId,
      parsed.data
    )
    return Response.json({ data }, { status: 202, headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspacePurgeManifestNotReadyError) {
      return Response.json(
        { error: 'Archive the workspace before preparing a purge manifest' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (
      error instanceof WorkspaceAuthorizationError ||
      error instanceof WorkspacePurgeManifestPermissionError
    ) {
      return forbiddenResponse()
    }
    console.error('AppSea workspace purge manifest preparation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to prepare workspace purge manifest' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
