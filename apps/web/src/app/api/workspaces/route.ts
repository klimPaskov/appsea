import {
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../server/auth-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  return Response.json({ data: session.workspaces }, { headers: privateResponseHeaders })
}
