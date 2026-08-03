import { randomUUID } from 'node:crypto'
import {
  appseaIdentifierSchema,
  manualImportFormatSchema,
  manualImportBatchCreateInputSchema,
  productionCollectionWorkflowStartRequestSchema,
  researchCampaignConfigurationSchema,
  researchJobBudgetSchema
} from '@appsea/contracts'
import { parseManualImportContent } from '@appsea/connectors'
import {
  ManualImportConflictError,
  ManualImportPermissionError,
  PostgresManualImportRepository,
  PostgresSourcePolicyRepository,
  PostgresResearchCampaignRepository,
  PostgresProductionWorkflowAdmissionRepository,
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError,
  contentHash
} from '@appsea/db'
import {
  prepareProductionCollectionWorkflowStart,
  startProductionCollectionWorkflow
} from '@appsea/workflows'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../server/database'
import { getTemporalWorkflowClient } from '../../../../../server/temporal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MANUAL_IMPORT_BODY_BYTES = 2 * 1024 * 1024 + 64 * 1024

interface ManualImportRequestBody {
  campaignId: string
  filename: string
  format: 'csv' | 'json'
  content: string
  idempotencyKey: string
  batchId?: string
  runId?: string
  query?: string
  purpose?: string
  authorizationAttested: true
}

function workspaceForSession(
  session: Awaited<ReturnType<typeof readSession>>,
  workspaceId: string
) {
  return session?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
}

function generatedIdentifier(prefix: string): string {
  return `${prefix}:${randomUUID()}`
}

async function readBody(request: Request): Promise<ManualImportRequestBody | null> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.isFinite(Number(contentLength))) {
    if (Number(contentLength) > MAX_MANUAL_IMPORT_BODY_BYTES) return null
  }
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_MANUAL_IMPORT_BODY_BYTES) return null
  let payload: unknown
  try {
    payload = JSON.parse(body) as unknown
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  if (value.authorizationAttested !== true || typeof value.content !== 'string') return null
  const format = manualImportFormatSchema.safeParse(value.format)
  const campaignId = appseaIdentifierSchema.safeParse(value.campaignId)
  const filename = typeof value.filename === 'string' ? value.filename.trim() : ''
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey.trim() : ''
  if (
    !format.success ||
    !campaignId.success ||
    filename.length < 1 ||
    filename.length > 240 ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 200
  ) {
    return null
  }
  const optionalIdentifier = (candidate: unknown): string | undefined => {
    if (candidate === undefined) return undefined
    const parsed = appseaIdentifierSchema.safeParse(candidate)
    return parsed.success ? parsed.data : undefined
  }
  const query = typeof value.query === 'string' ? value.query.trim() : undefined
  const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : undefined
  const batchId = optionalIdentifier(value.batchId)
  const runId = optionalIdentifier(value.runId)
  if (query !== undefined && query.length > 500) return null
  if (purpose !== undefined && (purpose.length < 1 || purpose.length > 120)) return null
  return {
    campaignId: campaignId.data,
    filename,
    format: format.data,
    content: value.content,
    idempotencyKey,
    ...(batchId ? { batchId } : {}),
    ...(runId ? { runId } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    authorizationAttested: true
  }
}

/** Stage an owner-authorized CSV/JSON export and start its durable collection workflow. */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  if (!sameOriginRequest(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (
    !workspace ||
    workspace.visibility !== 'private' ||
    workspace.fixtureOnly ||
    workspace.role !== 'owner'
  ) {
    return forbiddenResponse()
  }
  const body = await readBody(request)
  if (!body) {
    return Response.json(
      { error: 'Import request is invalid or exceeds the 2 MiB content limit' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  const pool = getDatabasePool()
  let campaign: Awaited<ReturnType<PostgresResearchCampaignRepository['readForUser']>>
  try {
    campaign = await new PostgresResearchCampaignRepository(pool).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      body.campaignId
    )
  } catch {
    return Response.json(
      { error: 'Unable to verify the private campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  if (!campaign || campaign.synthetic || campaign.state === 'archived') {
    return Response.json(
      { error: 'A private production campaign is required' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  const configuration = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
  const budget = researchJobBudgetSchema.safeParse(campaign.budget)
  if (!configuration.success || !budget.success) {
    return Response.json(
      { error: 'The campaign configuration is not a current production contract' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  if (
    !configuration.data.sourceIds.includes('manual-owner-import') ||
    configuration.data.requestedDisplayMode !== 'excerpt'
  ) {
    return Response.json(
      { error: 'The campaign must include the owner-authorized import source in excerpt mode' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  const query = body.query ?? configuration.data.query
  const purpose = body.purpose ?? campaign.purpose
  if (!configuration.data.sourceIds.includes('manual-owner-import')) {
    return Response.json(
      { error: 'Manual source is not configured for this campaign' },
      { status: 422 }
    )
  }
  let parsedImport: ReturnType<typeof parseManualImportContent>
  try {
    parsedImport = parseManualImportContent(body.content, {
      format: body.format,
      defaultQuery: query
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Import content is invalid' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  if (parsedImport.records.length > budget.data.maxSourceItems) {
    return Response.json(
      { error: 'Import record count exceeds the campaign source-item budget' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  const requestedAt = new Date().toISOString()
  const batchId = body.batchId ?? generatedIdentifier('batch:manual')
  const runId = body.runId ?? generatedIdentifier('run:manual')
  let collectible: Awaited<ReturnType<PostgresSourcePolicyRepository['readCollectible']>>
  try {
    collectible = await new PostgresSourcePolicyRepository(pool).readCollectible(
      'manual-owner-import',
      'manual-owner-import-v1'
    )
  } catch {
    return Response.json(
      { error: 'Unable to verify the owner-import source policy' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  if (!collectible || collectible.policy?.sourceId !== 'manual-owner-import') {
    return Response.json(
      { error: 'The owner-import source policy is not currently collectible' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  const actorBoundRequest = productionCollectionWorkflowStartRequestSchema.parse({
    workspaceId: parsedWorkspaceId.data,
    campaignId: body.campaignId,
    runId,
    idempotencyKey: body.idempotencyKey,
    workflowVersion: 'production-collection-v1',
    sourceId: 'manual-owner-import',
    policyVersion: 'manual-owner-import-v1',
    query,
    limit: parsedImport.records.length,
    purpose,
    requestedDisplayMode: 'excerpt',
    budget: budget.data,
    requestedAt,
    manualImportBatchId: batchId,
    requestedBy: { actorType: 'user', actorId: session.user.userId }
  })
  const prepared = prepareProductionCollectionWorkflowStart(actorBoundRequest)
  const batchInput = manualImportBatchCreateInputSchema.parse({
    workspaceId: parsedWorkspaceId.data,
    batchId,
    campaignId: body.campaignId,
    sourceId: 'manual-owner-import',
    policyVersion: 'manual-owner-import-v1',
    purpose,
    requestedDisplayMode: 'excerpt',
    idempotencyDigest: prepared.input.idempotencyDigest,
    inputHash: prepared.input.inputHash,
    format: parsedImport.format,
    filename: body.filename,
    records: parsedImport.records,
    warnings: parsedImport.warnings,
    authorizationAttested: body.authorizationAttested,
    attestedBy: session.user.userId,
    attestedAt: requestedAt,
    createdAt: requestedAt
  })
  let batch
  try {
    batch = await new PostgresManualImportRepository(pool).createForUser(
      session.user.userId,
      batchInput
    )
  } catch (error) {
    if (error instanceof ManualImportPermissionError) return forbiddenResponse()
    if (error instanceof ManualImportConflictError) {
      return Response.json(
        { error: 'Import idempotency or campaign configuration conflicts with an existing batch' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea manual import staging failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to stage the private import' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  try {
    await new PostgresProductionWorkflowAdmissionRepository(pool).admitForUser({
      workspaceId: parsedWorkspaceId.data,
      userId: session.user.userId,
      idempotencyDigest: prepared.input.idempotencyDigest,
      inputHash: prepared.input.inputHash
    })
  } catch (error) {
    if (error instanceof ProductionWorkflowRateLimitError) {
      const headers = new Headers(privateResponseHeaders)
      headers.set('retry-after', String(error.retryAfterSeconds))
      return Response.json(
        { error: 'Import workflow start rate limit exceeded' },
        { status: 429, headers }
      )
    }
    if (error instanceof ProductionWorkflowConcurrencyLimitError) {
      const headers = new Headers(privateResponseHeaders)
      headers.set('retry-after', String(error.retryAfterSeconds))
      return Response.json(
        { error: 'Import workflow concurrency limit reached' },
        { status: 429, headers }
      )
    }
    if (error instanceof ProductionWorkflowAdmissionConflictError) {
      return Response.json(
        { error: 'Import idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea manual import admission failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to admit import workflow' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  try {
    const handle = await startProductionCollectionWorkflow(
      await getTemporalWorkflowClient(),
      actorBoundRequest
    )
    return Response.json(
      {
        data: {
          batch,
          workflowId: handle.workflowId,
          runId,
          inputHash: prepared.input.inputHash,
          contentHash: contentHash(parsedImport.records)
        }
      },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('idempotency key conflicts')) {
      return Response.json(
        { error: 'Import workflow idempotency conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea manual import workflow start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to start import workflow' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}

/** List private import batches for a workspace, with optional campaign filtering. */
export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return invalidRequest('Invalid workspace path')
  const workspace = workspaceForSession(session, parsedWorkspaceId.data)
  if (!workspace || workspace.visibility !== 'private') return forbiddenResponse()
  const campaignId = new URL(request.url).searchParams.get('campaignId') ?? undefined
  try {
    const batches = await new PostgresManualImportRepository(getDatabasePool()).listForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      campaignId
    )
    return Response.json({ data: batches }, { headers: privateResponseHeaders })
  } catch (error) {
    console.error('AppSea manual import list failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read private imports' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
