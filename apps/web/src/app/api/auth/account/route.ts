import { NextResponse } from 'next/server'
import { authAccountDeletionInputSchema } from '@appsea/contracts'
import { AuthAccountDeletionBlockedError } from '@appsea/db/auth'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  mfaReauthenticationRequiredResponse,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  readSession,
  readSessionToken,
  reauthenticationRequiredResponse,
  sameOriginRequest,
  sessionCookieName,
  sessionCookieOptions,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })

  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()

  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = authAccountDeletionInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Type DELETE MY ACCOUNT to close this account')

  try {
    if (!(await allowAuthAttempt(request, session.user.email, 'account-deletion'))) {
      return Response.json(
        { error: 'Too many account-closure attempts' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    if (!(await authRepository().hasRecentReauthentication(token))) {
      return reauthenticationRequiredResponse()
    }
    if (!(await authRepository().hasRecentMfaReauthentication(token))) {
      return mfaReauthenticationRequiredResponse()
    }

    const result = await authRepository().closeAccount(session.user.userId, parsed.data)
    const response = NextResponse.json({ data: result }, { headers: privateResponseHeaders })
    response.cookies.set(sessionCookieName, '', { ...sessionCookieOptions(), maxAge: 0 })
    return response
  } catch (error) {
    if (error instanceof AuthAccountDeletionBlockedError) {
      return Response.json(
        {
          error: 'Transfer workspace ownership before closing this account',
          blockingWorkspaceIds: error.workspaceIds
        },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea account closure failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to close the account' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
