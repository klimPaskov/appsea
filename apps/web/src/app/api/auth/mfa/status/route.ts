import { authMfaStatusReadModelSchema } from '@appsea/contracts'
import { AuthenticationError } from '@appsea/db/auth'
import {
  authRepository,
  privateResponseHeaders,
  readSessionToken,
  unauthorizedResponse
} from '../../../../../server/auth-session'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const token = await readSessionToken()
  if (!token) return unauthorizedResponse()
  try {
    const data = authMfaStatusReadModelSchema.parse(await authRepository().readMfaStatus(token))
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse()
    console.error('AppSea MFA status read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json({ error: 'Unable to read MFA status' }, { status: 500 })
  }
}
