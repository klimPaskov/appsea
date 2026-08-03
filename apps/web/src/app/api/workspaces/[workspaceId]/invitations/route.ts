import { appseaIdentifierSchema, workspaceInvitationCreateInputSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspaceInvitationConflictError,
  WorkspaceMembershipManagementError
} from '@appsea/db/auth'
import {
  allowAuthAttempt,
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

function invitationFeatureUnavailable(): Response {
  return Response.json(
    { error: 'Workspace invitations are temporarily unavailable' },
    { status: 503, headers: privateResponseHeaders }
  )
}

function parseWorkspaceId(value: string): string | undefined {
  const parsed = appseaIdentifierSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function mapOwnerError(error: unknown): Response | undefined {
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof WorkspaceMembershipManagementError
  ) {
    return forbiddenResponse()
  }
  return undefined
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = parseWorkspaceId((await context.params).workspaceId)
  if (!workspaceId) return invalidRequest('Invalid workspace')
  try {
    const data = await authRepository().listWorkspaceInvitations(session.user.userId, workspaceId)
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    const mapped = mapOwnerError(error)
    if (mapped) return mapped
    console.error('AppSea workspace invitation listing failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read workspace invitations' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.APPSEA_AUTH_INVITATIONS_ENABLED !== 'true'
  ) {
    return invitationFeatureUnavailable()
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const workspaceId = parseWorkspaceId((await context.params).workspaceId)
  if (!workspaceId) return invalidRequest('Invalid workspace')

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = workspaceInvitationCreateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid invitation email and role are required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.email, 'invitation'))) {
      return Response.json(
        { error: 'Too many invitation attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    const token = await readSessionToken()
    if (!token) return unauthorizedResponse()
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }
    const result = await authRepository().createWorkspaceInvitation(
      session.user.userId,
      workspaceId,
      parsed.data
    )
    return Response.json(
      { data: result.invitation },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    const mapped = mapOwnerError(error)
    if (mapped) return mapped
    if (error instanceof WorkspaceInvitationConflictError) {
      return Response.json(
        { error: 'An active invitation already exists or that account is already a member' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea workspace invitation creation failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to create workspace invitation' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
