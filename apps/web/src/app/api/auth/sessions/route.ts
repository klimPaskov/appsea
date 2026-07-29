import { authSessionListReadModelSchema } from '@appsea/contracts'
import {
  authRepository,
  privateResponseHeaders,
  readSession,
  readSessionToken,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const token = await readSessionToken()
  const session = token ? await readSession() : null
  if (!token || !session) return unauthorizedResponse()

  try {
    const data = authSessionListReadModelSchema.parse({
      sessions: await authRepository().listActiveSessions(token)
    })
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea authentication session listing failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read authentication sessions' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
