import {
  appseaIdentifierSchema,
  productionCollectionWorkflowStartRequestSchema,
  researchCampaignConfigurationSchema,
  researchCampaignRunInputSchema,
  researchJobBudgetSchema
} from '@appsea/contracts'
import {
  PostgresResearchCampaignRepository,
  ResearchCampaignPermissionError
} from '@appsea/db/research-campaign'
import {
  PostgresResearchCampaignOrchestrationRepository,
  ResearchCampaignOrchestrationConflictError,
  ResearchCampaignOrchestrationPermissionError,
  ResearchCampaignOrchestrationSourceError,
  ResearchCampaignOrchestrationStateError
} from '@appsea/db/research-campaign-orchestration'
import {
  PostgresProductionWorkflowAdmissionRepository,
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError
} from '@appsea/db/production-workflow-admission'
import { PostgresOpportunitySeedReviewRepository } from '@appsea/db/opportunity-seed-review'
import {
  prepareProductionCollectionWorkflowStart,
  startProductionCollectionWorkflow
} from '@appsea/workflows'
import { NextResponse } from 'next/server'
import {
  forbiddenResponse,
  invalidRequest,
  privateResponseHeaders,
  readSession,
  sameOriginRequest,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { canStartProductionWorkflow } from '../../../../../../../server/production-workflow-gateway'
import { getDatabasePool } from '../../../../../../../server/database'
import { getTemporalWorkflowClient } from '../../../../../../../server/temporal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CAMPAIGN_RUN_BODY_BYTES = 32 * 1024

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get('content-length')
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_CAMPAIGN_RUN_BODY_BYTES
  ) {
    return null
  }
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_CAMPAIGN_RUN_BODY_BYTES) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('invalid-json')
  }
}

export async function POST(
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
  if (!canStartProductionWorkflow(session, parsedWorkspaceId.data)) return forbiddenResponse()

  let payload: unknown
  try {
    payload = await readBoundedJson(request)
  } catch {
    return invalidRequest('Campaign run request must be valid JSON')
  }
  if (payload === null) {
    return Response.json(
      { error: 'Campaign run request is too large' },
      { status: 413, headers: privateResponseHeaders }
    )
  }
  const parsedRun = researchCampaignRunInputSchema.safeParse(payload)
  if (!parsedRun.success) return invalidRequest('Campaign run request is invalid')

  const pool = getDatabasePool()
  let campaign
  try {
    campaign = await new PostgresResearchCampaignRepository(pool).readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data
    )
  } catch (error) {
    if (error instanceof ResearchCampaignPermissionError) return forbiddenResponse()
    console.error('AppSea campaign run read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to read research campaign' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  if (!campaign) {
    return Response.json(
      { error: 'Research campaign not found' },
      { status: 404, headers: privateResponseHeaders }
    )
  }

  if (campaign.synthetic) {
    return Response.json(
      { error: 'Synthetic campaigns cannot start production collection' },
      { status: 422, headers: privateResponseHeaders }
    )
  }

  const configuration = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
  const budget = researchJobBudgetSchema.safeParse(campaign.budget)
  if (!configuration.success || !budget.success) {
    return Response.json(
      { error: 'Only validated campaign-v1 drafts can start production collection' },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  if (!['draft', 'validated', 'queued', 'running'].includes(campaign.state)) {
    return Response.json(
      { error: `Campaign state ${campaign.state} cannot start production collection` },
      { status: 422, headers: privateResponseHeaders }
    )
  }
  const multiSource = configuration.data.sourceIds.length > 1
  const source = campaign.sources[0]
  const limit = Math.min(configuration.data.maxEvidenceCount, budget.data.maxSourceItems)
  if (!multiSource) {
    if (campaign.sources.length !== 1) {
      return Response.json(
        { error: 'The configured source could not be resolved' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (
      !source ||
      source.sourceId !== configuration.data.sourceIds[0] ||
      source.synthetic ||
      !source.enabled ||
      source.policyState !== 'approved' ||
      !source.policyVersion ||
      !source.permittedPurposes.includes(campaign.purpose)
    ) {
      return Response.json(
        { error: 'The configured source is not currently approved for collection' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (source.displayMode !== configuration.data.requestedDisplayMode) {
      return Response.json(
        { error: 'The requested display mode does not match the approved source policy' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
    if (limit < 1) {
      return Response.json(
        { error: 'The campaign budget does not permit any source items' },
        { status: 422, headers: privateResponseHeaders }
      )
    }
  }

  if (parsedRun.data.analysisSeedReviewId) {
    try {
      const approvedSeed = await new PostgresOpportunitySeedReviewRepository(
        pool
      ).readApprovedForUser(
        session.user.userId,
        parsedWorkspaceId.data,
        parsedRun.data.analysisSeedReviewId
      )
      if (!approvedSeed) {
        return Response.json(
          { error: 'An approved opportunity seed review is required for automatic analysis' },
          { status: 422, headers: privateResponseHeaders }
        )
      }
    } catch (error) {
      console.error('AppSea campaign run seed verification failed', {
        name: error instanceof Error ? error.name : 'unknown'
      })
      return Response.json(
        { error: 'Unable to verify the analysis seed review' },
        { status: 503, headers: privateResponseHeaders }
      )
    }
  }

  if (multiSource) {
    try {
      const orchestration = await new PostgresResearchCampaignOrchestrationRepository(
        pool
      ).createForUser(
        session.user.userId,
        parsedWorkspaceId.data,
        parsedCampaignId.data,
        parsedRun.data
      )
      return NextResponse.json(
        {
          data: {
            campaignId: parsedCampaignId.data,
            runId: orchestration.orchestrationId,
            orchestrationId: orchestration.orchestrationId,
            state: orchestration.state,
            sourceCount: orchestration.sourceCount
          }
        },
        { status: 202, headers: privateResponseHeaders }
      )
    } catch (error) {
      if (error instanceof ResearchCampaignOrchestrationPermissionError) {
        return forbiddenResponse()
      }
      if (
        error instanceof ResearchCampaignOrchestrationSourceError ||
        error instanceof ResearchCampaignOrchestrationStateError
      ) {
        return Response.json(
          { error: error.message },
          { status: 422, headers: privateResponseHeaders }
        )
      }
      if (error instanceof ResearchCampaignOrchestrationConflictError) {
        return Response.json(
          { error: 'Campaign orchestration idempotency conflicts with a previous request' },
          { status: 409, headers: privateResponseHeaders }
        )
      }
      console.error('AppSea campaign orchestration queue failed', {
        name: error instanceof Error ? error.name : 'unknown'
      })
      return Response.json(
        { error: 'Unable to queue campaign collection' },
        { status: 503, headers: privateResponseHeaders }
      )
    }
  }

  const requestInput = productionCollectionWorkflowStartRequestSchema.parse({
    workspaceId: parsedWorkspaceId.data,
    campaignId: parsedCampaignId.data,
    runId: parsedRun.data.runId,
    idempotencyKey: parsedRun.data.idempotencyKey,
    workflowVersion: 'production-collection-v1',
    sourceId: source!.sourceId,
    policyVersion: source!.policyVersion!,
    query: configuration.data.query,
    limit,
    purpose: campaign.purpose,
    requestedDisplayMode: configuration.data.requestedDisplayMode,
    budget: budget.data,
    requestedAt: parsedRun.data.requestedAt,
    ...(parsedRun.data.analysisSeedReviewId
      ? { analysisSeedReviewId: parsedRun.data.analysisSeedReviewId }
      : {}),
    requestedBy: { actorType: 'user', actorId: session.user.userId }
  })
  const prepared = prepareProductionCollectionWorkflowStart(requestInput)
  try {
    await new PostgresProductionWorkflowAdmissionRepository(pool).admitForUser({
      workspaceId: parsedWorkspaceId.data,
      userId: session.user.userId,
      idempotencyDigest: prepared.input.idempotencyDigest,
      inputHash: prepared.input.inputHash
    })
    const handle = await startProductionCollectionWorkflow(
      await getTemporalWorkflowClient(),
      requestInput
    )
    return NextResponse.json(
      {
        data: {
          campaignId: parsedCampaignId.data,
          runId: parsedRun.data.runId,
          sourceId: source!.sourceId,
          policyVersion: source!.policyVersion!,
          workflowId: handle.workflowId
        }
      },
      { status: 202, headers: privateResponseHeaders }
    )
  } catch (error) {
    if (error instanceof ProductionWorkflowRateLimitError) {
      return Response.json(
        { error: 'Production collection start rate limit exceeded' },
        {
          status: 429,
          headers: { ...privateResponseHeaders, 'retry-after': String(error.retryAfterSeconds) }
        }
      )
    }
    if (error instanceof ProductionWorkflowConcurrencyLimitError) {
      return Response.json(
        { error: 'Production collection concurrency limit reached' },
        {
          status: 429,
          headers: { ...privateResponseHeaders, 'retry-after': String(error.retryAfterSeconds) }
        }
      )
    }
    if (error instanceof ProductionWorkflowAdmissionConflictError) {
      return Response.json(
        { error: 'Workflow idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof Error && error.message.includes('idempotency key conflicts')) {
      return Response.json(
        { error: 'Workflow idempotency key conflicts with a previous request' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea campaign production workflow start failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to start campaign collection' },
      { status: 503, headers: privateResponseHeaders }
    )
  }
}
