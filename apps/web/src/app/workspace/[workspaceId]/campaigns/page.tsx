import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, type ResearchCampaignReadModel } from '@appsea/contracts'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { ResearchCampaignCreateForm, ResearchCampaignEditForm } from '../../campaign-actions'
import { ResearchCampaignRunAction } from '../../campaign-run-action'
import { ResearchCampaignRunHistory } from '../../campaign-run-history'

export const dynamic = 'force-dynamic'

function supportsCampaignEdit(campaign: ResearchCampaignReadModel): boolean {
  return (
    typeof campaign.configuration === 'object' &&
    campaign.configuration !== null &&
    'schemaVersion' in campaign.configuration &&
    campaign.configuration.schemaVersion === 'campaign-v1'
  )
}

export default async function ResearchCampaignsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId } = await params
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
  const runHistoryByCampaignId = new Map<
    string,
    Awaited<ReturnType<PostgresProductionCollectionWorkflowRepository['listForCampaignForUser']>>
  >()
  if (!workspace.fixtureOnly) {
    const runLists = await Promise.all(
      campaigns.map((campaign) =>
        new PostgresProductionCollectionWorkflowRepository(pool).listForCampaignForUser(
          session.user.userId,
          parsedWorkspaceId.data,
          campaign.campaignId
        )
      )
    )
    campaigns.forEach((campaign, index) => {
      runHistoryByCampaignId.set(campaign.campaignId, runLists[index] ?? [])
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
                    ready={
                      campaign.state !== 'archived' &&
                      campaign.sources.length === 1 &&
                      campaign.sources[0]?.enabled === true &&
                      campaign.sources[0]?.policyState === 'approved'
                    }
                  />
                  <ResearchCampaignRunHistory
                    workspaceId={parsedWorkspaceId.data}
                    runs={runHistoryByCampaignId.get(campaign.campaignId) ?? []}
                  />
                  {(workspace.role === 'owner' || workspace.role === 'editor') &&
                  campaign.state !== 'archived' &&
                  supportsCampaignEdit(campaign) ? (
                    <ResearchCampaignEditForm
                      workspaceId={parsedWorkspaceId.data}
                      campaign={campaign}
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
          <ResearchCampaignCreateForm workspaceId={parsedWorkspaceId.data} />
        </section>
      ) : null}
    </main>
  )
}
