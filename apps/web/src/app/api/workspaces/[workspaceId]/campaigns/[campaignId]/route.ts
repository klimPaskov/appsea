import { appseaIdentifierSchema, researchCampaignUpdateInputSchema } from '@appsea/contracts'
import {
  PostgresResearchCampaignRepository,
  ResearchCampaignConflictError,
  ResearchCampaignPermissionError,
  ResearchCampaignSourceError,
  ResearchCampaignStateError
} from '@appsea/db/research-campaign'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CAMPAIGN_BODY_BYTES = 128 * 1024

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
  context: { params: Promise<{ workspaceId: string; campaignId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, campaignId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success) {
    return invalidRequest('Invalid campaign path')
  }
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }
  try {
    const campaign = await new PostgresResearchCampaignRepository(getDatabasePool()).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data
    )
    if (!campaign) {
      return Response.json(
        { error: 'Research campaign not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: campaign }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea campaign read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; campaignId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, campaignId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success) {
    return invalidRequest('Invalid campaign path')
  }
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
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
  const parsed = researchCampaignUpdateInputSchema.safeParse(payload)
  if (!parsed.success) return invalidRequest('Research campaign update is invalid')
  try {
    const campaign = await new PostgresResearchCampaignRepository(getDatabasePool()).updateForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data,
      parsed.data
    )
    if (!campaign) {
      return Response.json(
        { error: 'Research campaign not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: campaign }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ResearchCampaignPermissionError) return forbiddenResponse()
    if (error instanceof ResearchCampaignSourceError) {
      return Response.json(
        { error: error.message },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (
      error instanceof ResearchCampaignStateError ||
      error instanceof ResearchCampaignConflictError
    ) {
      return Response.json(
        { error: error.message },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea campaign update failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to update research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

/** Archive instead of hard-delete so run, evidence, and audit lineage survive. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; campaignId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: privateResponseHeaders }
    )
  }
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, campaignId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success) {
    return invalidRequest('Invalid campaign path')
  }
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace || !['owner', 'editor'].includes(workspace.role)) return forbiddenResponse()
  try {
    const campaign = await new PostgresResearchCampaignRepository(getDatabasePool()).archiveForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data
    )
    if (!campaign) {
      return Response.json(
        { error: 'Research campaign not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    return Response.json({ data: campaign }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ResearchCampaignPermissionError) return forbiddenResponse()
    if (error instanceof ResearchCampaignStateError) {
      return Response.json(
        { error: error.message },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea campaign archive failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to archive research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
