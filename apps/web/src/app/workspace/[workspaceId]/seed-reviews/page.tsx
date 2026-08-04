import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresOpportunitySeedReviewRepository } from '@appsea/db/opportunity-seed-review'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'
import {
  OpportunitySeedReviewActions,
  OpportunitySeedReviewCreateForm
} from '../../opportunity-seed-review-actions'

export const dynamic = 'force-dynamic'

export default async function OpportunitySeedReviewsPage({
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
  const reviews = await new PostgresOpportunitySeedReviewRepository(getDatabasePool()).listForUser(
    session.user.userId,
    parsedWorkspaceId.data
  )

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Seed reviews</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Seed reviews</h1>
          <p className="auth-intro">
            Human-reviewed opportunity assumptions are stored separately from complaint evidence.
            Only approved seed reviews can start production analysis.
          </p>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="seed-review-list-heading">
        <div className="section-intro">
          <h2 id="seed-review-list-heading">Registered seeds</h2>
          <p>Each content change creates a new immutable review record.</p>
        </div>
        {reviews.length === 0 ? (
          <p className="empty-state">No seed reviews have been registered.</p>
        ) : (
          <ul className="seed-review-list">
            {reviews.map((review) => (
              <li key={review.seedReviewId}>
                <div>
                  <div className="complaint-meta">
                    <span>{review.seedReviewId}</span>
                    <span>{review.seedVersion}</span>
                    <span>{review.seed.slug}</span>
                  </div>
                  <h3>{review.seed.name}</h3>
                  <p>{review.seed.oneLine}</p>
                  <p className="muted-note">
                    Content hash <code>{review.contentHash}</code>
                  </p>
                </div>
                <OpportunitySeedReviewActions
                  workspaceId={parsedWorkspaceId.data}
                  seedReviewId={review.seedReviewId}
                  initialState={review.reviewState}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {workspace.role === 'owner' || workspace.role === 'editor' ? (
        <section className="workspace-section" aria-labelledby="seed-review-create-heading">
          <div className="section-intro">
            <h2 id="seed-review-create-heading">Register a reviewed seed</h2>
            <p>Enter explicit product, competitor, contrary-signal, and score assumptions.</p>
          </div>
          <OpportunitySeedReviewCreateForm workspaceId={parsedWorkspaceId.data} />
        </section>
      ) : null}
    </main>
  )
}
