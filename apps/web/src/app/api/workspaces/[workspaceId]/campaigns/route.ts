import { appseaIdentifierSchema, researchCampaignCreateInputSchema } from '@appsea/contracts'
import {
  PostgresResearchCampaignRepository,
  ResearchCampaignConflictError,
  ResearchCampaignPermissionError,
  ResearchCampaignSourceError
} from '@appsea/db/research-campaign'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CAMPAIGN_BODY_BYTES = 128 * 1024

function workspaceForSession(
  session: Awaited<ReturnType<typeof readSession>>,
  workspaceId: string
) {
  return session?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get('content-length')
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_CAMPAIGN_BODY_BYTES
  ) {
    return null
  }
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_CAMPAIGN_BODY_BYTES) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('invalid-json')
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  if (!workspaceForSession(session, parsedWorkspaceId.data)) return forbiddenResponse()
  try {
    const campaigns = await new PostgresResearchCampaignRepository(getDatabasePool()).listForUser(
      session.user.userId,
      parsedWorkspaceId.data
    )
    return Response.json({ data: campaigns }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign list failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read research campaigns' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (!workspace || !['owner', 'editor'].includes(workspace.role)) return forbiddenResponse()
  let payload: unknown
  try {
    payload = await readBoundedJson(request)
  } catch {
    return invalidRequest('Request body must be valid JSON')
  }
  if (payload === null) {
    return Response.json(
      { error: 'Research campaign is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  const parsed = researchCampaignCreateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Research campaign is invalid')
  try {
    const campaign = await new PostgresResearchCampaignRepository(getDatabasePool()).createForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsed.data
    )
    return Response.json({ data: campaign }, { status: 201, headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ResearchCampaignPermissionError) return forbiddenResponse()
    if (error instanceof ResearchCampaignSourceError) {
      return Response.json(
        { error: error.message },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (error instanceof ResearchCampaignConflictError) {
      return Response.json(
        { error: 'Campaign identifier or content already exists' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea campaign create failed', {
      name: error instanceof Error ? error.name : 'unknown',
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined,
      constraint:
        typeof error === 'object' && error !== null && 'constraint' in error
          ? String(error.constraint)
          : undefined,
      table:
        typeof error === 'object' && error !== null && 'table' in error
          ? String(error.table)
          : undefined,
      column:
        typeof error === 'object' && error !== null && 'column' in error
          ? String(error.column)
          : undefined,
      // PostgreSQL authorization/policy failures have no user-controlled
      // payload in their message. Keep this bounded diagnostic so hosted
      // smoke failures identify the failing database boundary without
      // logging request contents.
      message:
        error instanceof Error && error.message.length <= 240 ? error.message : undefined
    })
    return Response.json(
      { error: 'Unable to create research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
