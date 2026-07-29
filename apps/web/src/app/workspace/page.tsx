import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignOutButton } from '../../components/sign-out-button'
import { authRepository, readSession } from '../../server/auth-session'

export const dynamic = 'force-dynamic'

export default async function WorkspacePage() {
  const session = await readSession()
  if (!session) redirect('/login')
  const workspace = session.workspaces[0]
  if (!workspace) {
    return (
      <main className="workspace-page">
        <h1>No workspace access</h1>
        <p className="auth-intro">Your account is not currently a member of a workspace.</p>
        <SignOutButton />
      </main>
    )
  }

  const opportunities = await authRepository().listWorkspaceOpportunities(
    session.user.userId,
    workspace.workspaceId
  )

  return (
    <main className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <p className="eyebrow">Private workspace</p>
          <h1>{workspace.displayName}</h1>
        </div>
        <div className="workspace-actions">
          <Link className="quiet-button" href="/account/security">
            Account security
          </Link>
          <Link className="quiet-button" href={`/workspace/${workspace.workspaceId}/members`}>
            Members
          </Link>
          <Link className="quiet-button" href={`/workspace/${workspace.workspaceId}/seed-reviews`}>
            Seed reviews
          </Link>
          <SignOutButton />
        </div>
      </div>
      <p className="auth-intro">
        Research artifacts are scoped to this workspace and are not part of the public fixture
        leaderboard.
      </p>
      <section className="workspace-section" aria-labelledby="workspace-opportunities">
        <div className="section-intro">
          <h2 id="workspace-opportunities">Opportunities</h2>
          <p>Evidence-backed packages available to your workspace.</p>
        </div>
        {opportunities.length === 0 ? (
          <p className="empty-state">No research packages are available yet.</p>
        ) : (
          <ul className="workspace-opportunity-list">
            {opportunities.map((opportunity) => (
              <li key={opportunity.id}>
                <Link
                  href={`/workspace/${workspace.workspaceId}/opportunities/${opportunity.slug}`}
                >
                  <span>{opportunity.name}</span>
                  <small>
                    {opportunity.complaintCount.toLocaleString('en-US')} complaints · score{' '}
                    {opportunity.score.toFixed(1)}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
