import {
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../server/auth-session'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  return Response.json({ data: session }, { headers: privateResponseHeaders })
}
