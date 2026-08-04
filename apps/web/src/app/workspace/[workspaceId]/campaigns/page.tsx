import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  appseaIdentifierSchema,
  researchCampaignConfigurationSchema,
  type ResearchCampaignReadModel,
  type WorkspaceSourceReadModel
} from '@appsea/contracts'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
import { PostgresResearchCampaignOrchestrationRepository } from '@appsea/db/research-campaign-orchestration'
import { PostgresSourcePolicyRepository } from '@appsea/db/source-policy'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'
import { ResearchCampaignCreateForm, ResearchCampaignEditForm } from '../../campaign-actions'
import { ResearchCampaignRunAction } from '../../campaign-run-action'
import { ResearchCampaignRunHistory } from '../../campaign-run-history'
import { ResearchCampaignOrchestrationHistory } from '../../campaign-orchestration-history'

export const dynamic = 'force-dynamic'

function supportsCampaignEdit(campaign: ResearchCampaignReadModel): boolean {
  return (
    typeof campaign.configuration === 'object' &&
    campaign.configuration !== null &&
    'schemaVersion' in campaign.configuration &&
    campaign.configuration.schemaVersion === 'campaign-v1'
  )
}

function supportsCampaignRun(campaign: ResearchCampaignReadModel): boolean {
  const parsed = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
  if (!parsed.success) return false
  const configuration = parsed.data
  return (
    configuration.sourceIds.length === campaign.sources.length &&
    campaign.sources.length > 0 &&
    campaign.sources.every(
      (source) =>
        source.enabled &&
        source.policyState === 'approved' &&
        source.policyVersion !== null &&
        source.permittedPurposes.includes(campaign.purpose) &&
        source.displayMode === configuration.requestedDisplayMode &&
        !source.synthetic
    )
  )
}

export default async function ResearchCampaignsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId: encodedWorkspaceId } = await params
  const workspaceId = decodePathParam(encodedWorkspaceId)
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) notFound()
  const pool = getDatabasePool()
  const campaigns = await new PostgresResearchCampaignRepository(pool).listForUser(
    session.user.userId,
    parsedWorkspaceId.data
  )
  let sourceOptions: WorkspaceSourceReadModel[] = []
  try {
    sourceOptions = await new PostgresSourcePolicyRepository(pool).listForUser(
      session.user.userId,
      parsedWorkspaceId.data
    )
  } catch (error) {
    console.error('AppSea campaign source picker read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
  }
  const runHistoryByCampaignId = new Map<
    string,
    Awaited<
      ReturnType<PostgresProductionCollectionWorkflowRepository['listPageForCampaignForUser']>
    >
  >()
  const orchestrationHistoryByCampaignId = new Map<
    string,
    Awaited<
      ReturnType<PostgresResearchCampaignOrchestrationRepository['listPageForCampaignForUser']>
    >
  >()
  if (!workspace.fixtureOnly) {
    const runLists = await Promise.all(
      campaigns.map((campaign) =>
        new PostgresProductionCollectionWorkflowRepository(pool).listPageForCampaignForUser(
          session.user.userId,
          parsedWorkspaceId.data,
          campaign.campaignId,
          { limit: 25 }
        )
      )
    )
    campaigns.forEach((campaign, index) => {
      runHistoryByCampaignId.set(
        campaign.campaignId,
        runLists[index] ?? { data: [], nextCursor: null }
      )
    })
    const orchestrationLists = await Promise.all(
      campaigns.map((campaign) =>
        new PostgresResearchCampaignOrchestrationRepository(pool).listPageForCampaignForUser(
          session.user.userId,
          parsedWorkspaceId.data,
          campaign.campaignId,
          { limit: 25 }
        )
      )
    )
    campaigns.forEach((campaign, index) => {
      orchestrationHistoryByCampaignId.set(
        campaign.campaignId,
        orchestrationLists[index] ?? { data: [], nextCursor: null }
      )
    })
  }

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Campaigns</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Research campaigns</h1>
          <p className="auth-intro">
            Define the research question, source allowlist, evidence limit, refresh policy, and
            budget before a reviewed workflow can run.
          </p>
        </div>
        <strong className="workspace-score">{campaigns.length}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="campaign-list-heading">
        <div className="section-intro">
          <h2 id="campaign-list-heading">Registered campaigns</h2>
          <p>Campaign drafts never activate a connector or bypass source-policy review.</p>
        </div>
        {campaigns.length === 0 ? (
          <p className="empty-state">No research campaigns have been registered.</p>
        ) : (
          <ul className="seed-review-list">
            {campaigns.map((campaign) => (
              <li key={campaign.campaignId}>
                <div>
                  <div className="complaint-meta">
                    <span>{campaign.campaignId}</span>
                    <span>{campaign.state}</span>
                    <span>{campaign.synthetic ? 'Synthetic fixture' : 'Private production'}</span>
                  </div>
                  <h3>{campaign.name}</h3>
                  <p>{campaign.purpose}</p>
                  <p className="muted-note">
                    Sources:{' '}
                    {campaign.sources.length > 0
                      ? campaign.sources
                          .map(
                            (source) =>
                              `${source.displayName} (${source.policyState ?? 'unreviewed'})`
                          )
                          .join(' · ')
                      : 'not registered'}
                  </p>
                  {campaign.refreshSchedule ? (
                    <p className="muted-note">
                      Refresh: {campaign.refreshSchedule.state}
                      {campaign.refreshSchedule.nextDueAt
                        ? ` · next ${campaign.refreshSchedule.nextDueAt}`
                        : ''}
                      {campaign.refreshSchedule.failureSummary
                        ? ` · ${campaign.refreshSchedule.failureSummary}`
                        : ''}
                    </p>
                  ) : null}
                  <ResearchCampaignRunAction
                    workspaceId={parsedWorkspaceId.data}
                    campaignId={campaign.campaignId}
                    ready={campaign.state !== 'archived' && supportsCampaignRun(campaign)}
                  />
                  <ResearchCampaignRunHistory
                    workspaceId={parsedWorkspaceId.data}
                    runs={runHistoryByCampaignId.get(campaign.campaignId)?.data ?? []}
                    fullHistoryHref={`/workspace/${parsedWorkspaceId.data}/campaigns/${campaign.campaignId}/runs`}
                    nextPageHref={
                      runHistoryByCampaignId.get(campaign.campaignId)?.nextCursor
                        ? `/workspace/${parsedWorkspaceId.data}/campaigns/${campaign.campaignId}/runs?cursor=${encodeURIComponent(runHistoryByCampaignId.get(campaign.campaignId)!.nextCursor!)}`
                        : undefined
                    }
                  />
                  <ResearchCampaignOrchestrationHistory
                    workspaceId={parsedWorkspaceId.data}
                    canCancel={workspace.role === 'owner' || workspace.role === 'editor'}
                    orchestrations={
                      orchestrationHistoryByCampaignId.get(campaign.campaignId)?.data ?? []
                    }
                    fullHistoryHref={`/workspace/${parsedWorkspaceId.data}/campaigns/${campaign.campaignId}/runs`}
                    nextPageHref={
                      orchestrationHistoryByCampaignId.get(campaign.campaignId)?.nextCursor
                        ? `/workspace/${parsedWorkspaceId.data}/campaigns/${campaign.campaignId}/runs?orchestrationCursor=${encodeURIComponent(orchestrationHistoryByCampaignId.get(campaign.campaignId)!.nextCursor!)}`
                        : undefined
                    }
                  />
                  {(workspace.role === 'owner' || workspace.role === 'editor') &&
                  campaign.state !== 'archived' &&
                  supportsCampaignEdit(campaign) ? (
                    <ResearchCampaignEditForm
                      workspaceId={parsedWorkspaceId.data}
                      campaign={campaign}
                      sourceOptions={sourceOptions}
                    />
                  ) : null}
                  <details>
                    <summary>Configuration snapshot</summary>
                    <pre className="plan-file-preview">
                      {JSON.stringify(campaign.configuration, null, 2)}
                    </pre>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {workspace.role === 'owner' || workspace.role === 'editor' ? (
        <section className="workspace-section" aria-labelledby="campaign-create-heading">
          <div className="section-intro">
            <h2 id="campaign-create-heading">Create a draft campaign</h2>
            <p>
              The server validates all fields and source IDs. Pending or blocked policies remain
              visible instead of being treated as available coverage.
            </p>
          </div>
          <ResearchCampaignCreateForm
            workspaceId={parsedWorkspaceId.data}
            sourceOptions={sourceOptions}
          />
        </section>
      ) : null}
    </main>
  )
}
