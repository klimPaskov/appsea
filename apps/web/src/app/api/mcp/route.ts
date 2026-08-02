import { handleMcpRequest } from '../../../server/mcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request)
}
