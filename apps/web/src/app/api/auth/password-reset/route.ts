import {
  authPasswordResetInputSchema,
  authPasswordResetAcceptedReadModelSchema
} from '@appsea/contracts'
import { AuthPasswordResetError } from '@appsea/db/auth'
import { NextResponse } from 'next/server'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  readBoundedJsonBody,
  requestBodyTooLargeResponse,
  sameOriginRequest
} from '../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return body.tooLarge
      ? requestBodyTooLargeResponse()
      : invalidRequest('Request body must be valid JSON')
  const payload = body.value
  const parsed = authPasswordResetInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A reset link and valid password are required')

  try {
    if (!(await allowAuthAttempt(request, parsed.data.token, 'password-reset'))) {
      return Response.json(
        { error: 'Too many reset attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }
    await authRepository().resetPassword(parsed.data)
    return NextResponse.json(
      { data: authPasswordResetAcceptedReadModelSchema.parse({ accepted: true }) },
      { headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof AuthPasswordResetError) {
      return Response.json(
        { error: 'That reset link is invalid or expired' },
        { status: 400, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea password reset failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Password reset is temporarily unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
