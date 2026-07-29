import {
  authPasswordResetAcceptedReadModelSchema,
  authPasswordResetRequestInputSchema
} from '@appsea/contracts'
import { AuthPasswordResetConfigurationError } from '@appsea/db/auth'
import { NextResponse } from 'next/server'
import {
  allowAuthAttempt,
  authRepository,
  invalidRequest,
  privateResponseHeaders,
  sameOriginRequest
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  const parsed = authPasswordResetRequestInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('A valid email address is required')

  // External delivery is intentionally disabled until the provider contract,
  // identity verification policy, and deployment secret handling are reviewed.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.APPSEA_AUTH_RECOVERY_ENABLED !== 'true'
  ) {
    return Response.json(
      { error: 'Password recovery is temporarily unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }

  try {
    if (!(await allowAuthAttempt(request, parsed.data.email, 'recovery'))) {
      return Response.json(
        { error: 'Too many recovery attempts; try again later' },
        { status: 429, headers: { ...privateResponseHeaders, 'retry-after': '900' } }
      )
    }

    // The API only records a durable outbox item. A worker claims and sends
    // it later, so provider latency/failure cannot become account leakage.
    await authRepository().requestPasswordReset(parsed.data)

    return NextResponse.json(
      { data: authPasswordResetAcceptedReadModelSchema.parse({ accepted: true }) },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    console.error('AppSea password recovery request failed', {
      name:
        error instanceof AuthPasswordResetConfigurationError
          ? 'AuthPasswordResetConfigurationError'
          : 'PasswordRecoveryRequestError'
    })
    return Response.json(
      { error: 'Password recovery is temporarily unavailable' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
