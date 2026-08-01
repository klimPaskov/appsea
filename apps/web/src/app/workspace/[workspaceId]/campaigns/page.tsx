import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { ResearchCampaignCreateForm } from '../../campaign-actions'

export const dynamic = 'force-dynamic'

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
  const campaigns = await new PostgresResearchCampaignRepository(getDatabasePool()).listForUser(
    session.user.userId,
    parsedWorkspaceId.data
  )

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
