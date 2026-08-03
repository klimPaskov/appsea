import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, campaignHistoryPageQuerySchema } from '@appsea/contracts'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
import { PostgresResearchCampaignOrchestrationRepository } from '@appsea/db/research-campaign-orchestration'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import { readSession } from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'
import {
  canReadProductionWorkflow,
  productionWorkspaceFromSession
} from '../../../../../../server/production-workflow-gateway'
import { ResearchCampaignRunHistory } from '../../../../campaign-run-history'
import { ResearchCampaignOrchestrationHistory } from '../../../../campaign-orchestration-history'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function oneValue(value: string | string[] | undefined): string | undefined | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return value
}

function historyQuery(
  limit: string | undefined,
  cursor: string | undefined
): ReturnType<typeof campaignHistoryPageQuerySchema.parse> | null {
  const parsed = campaignHistoryPageQuerySchema.safeParse({
    limit: limit === undefined ? 25 : Number(limit),
    ...(cursor === undefined ? {} : { cursor })
  })
  return parsed.success ? parsed.data : null
}

export default async function CampaignRunsPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string; campaignId: string }>
  searchParams: Promise<SearchParams>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId, campaignId } = await params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedCampaignId = appseaIdentifierSchema.safeParse(campaignId)
  if (!parsedWorkspaceId.success || !parsedCampaignId.success) notFound()
  const workspace = productionWorkspaceFromSession(session, parsedWorkspaceId.data)
  if (
    !workspace ||
    workspace.fixtureOnly ||
    workspace.visibility !== 'private' ||
    !canReadProductionWorkflow(session, parsedWorkspaceId.data)
  ) {
    notFound()
  }
  const rawSearchParams = await searchParams
  const allowedKeys = new Set(['limit', 'cursor', 'orchestrationCursor'])
  if (Object.keys(rawSearchParams).some((key) => !allowedKeys.has(key))) notFound()
  const limit = oneValue(rawSearchParams.limit)
  const runCursor = oneValue(rawSearchParams.cursor)
  const orchestrationCursor = oneValue(rawSearchParams.orchestrationCursor)
  if (limit === null || runCursor === null || orchestrationCursor === null) notFound()
  const runQuery = historyQuery(limit, runCursor)
  const orchestrationQuery = historyQuery(limit, orchestrationCursor)
  if (!runQuery || !orchestrationQuery) notFound()

  const pool = getDatabasePool()
  const campaign = await new PostgresResearchCampaignRepository(pool).readForUser(
    session.user.userId,
    parsedWorkspaceId.data,
    parsedCampaignId.data
  )
  if (!campaign) notFound()
  const [runPage, orchestrationPage] = await Promise.all([
    new PostgresProductionCollectionWorkflowRepository(pool).listPageForCampaignForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data,
      runQuery
    ),
    new PostgresResearchCampaignOrchestrationRepository(pool).listPageForCampaignForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedCampaignId.data,
      orchestrationQuery
    )
  ])
  const basePath = `/workspace/${parsedWorkspaceId.data}/campaigns/${parsedCampaignId.data}/runs`
  const nextRunHref = runPage.nextCursor
    ? `${basePath}?limit=${runQuery.limit}&cursor=${encodeURIComponent(runPage.nextCursor)}${orchestrationCursor ? `&orchestrationCursor=${encodeURIComponent(orchestrationCursor)}` : ''}`
    : undefined
  const nextOrchestrationHref = orchestrationPage.nextCursor
    ? `${basePath}?limit=${orchestrationQuery.limit}${runCursor ? `&cursor=${encodeURIComponent(runCursor)}` : ''}&orchestrationCursor=${encodeURIComponent(orchestrationPage.nextCursor)}`
    : undefined

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${parsedWorkspaceId.data}/campaigns`}>Campaigns</Link>
        <span aria-hidden="true">/</span>
        <span>Run history</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>{campaign.name} run history</h1>
          <p className="auth-intro">
            Durable collection history is ordered by request time. Older pages use a stable,
            identifier-bound cursor.
          </p>
        </div>
        <strong className="workspace-score">
          {runPage.data.length + orchestrationPage.data.length}
        </strong>
      </div>
      <section className="workspace-section" aria-labelledby="single-source-history-heading">
        <h2 id="single-source-history-heading">Single-source runs</h2>
        <ResearchCampaignRunHistory
          workspaceId={parsedWorkspaceId.data}
          runs={runPage.data}
          nextPageHref={nextRunHref}
        />
      </section>
      <section className="workspace-section" aria-labelledby="multi-source-history-heading">
        <h2 id="multi-source-history-heading">Multi-source runs</h2>
        <ResearchCampaignOrchestrationHistory
          workspaceId={parsedWorkspaceId.data}
          canCancel={workspace.role === 'owner' || workspace.role === 'editor'}
          orchestrations={orchestrationPage.data}
          nextPageHref={nextOrchestrationHref}
        />
        {orchestrationPage.data.length === 0 ? (
          <p className="muted-note">No multi-source runs have been recorded.</p>
        ) : null}
      </section>
    </main>
  )
}
