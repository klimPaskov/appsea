import {
  workspaceInvitationAcceptInputSchema,
  workspaceInvitationAcceptedReadModelSchema
} from '@appsea/contracts'
import { WorkspaceInvitationError } from '@appsea/db/auth'
import {
  authRepository,
  allowAuthAttempt,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.APPSEA_AUTH_INVITATIONS_ENABLED !== 'true'
  ) {
    return Response.json(
      { error: 'Workspace invitations are temporarily unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = workspaceInvitationAcceptInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid invitation link is required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.token, 'invitation-accept'))) {
      return Response.json(
        { error: 'Too many invitation attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    const data = await authRepository().acceptWorkspaceInvitation(session.user.userId, parsed.data)
    return Response.json(
      { data: workspaceInvitationAcceptedReadModelSchema.parse(data) },
      { headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof WorkspaceInvitationError) {
      return Response.json(
        { error: 'That invitation is invalid, expired, or for another account' },
        { status: 400, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea workspace invitation acceptance failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to accept workspace invitation' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
