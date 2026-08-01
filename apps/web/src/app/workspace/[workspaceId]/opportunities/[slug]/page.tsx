import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { opportunitySlugSchema } from '@appsea/contracts'
import { readSession } from '../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../server/private-opportunity'

export const dynamic = 'force-dynamic'

export default async function PrivateOpportunityPage({
  params
}: {
  params: Promise<{ workspaceId: string; slug: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId, slug } = await params
  const parsedSlug = opportunitySlugSchema.safeParse(slug)
  if (!parsedSlug.success) notFound()
  const context = await readPrivateOpportunityContext(workspaceId, parsedSlug.data)
  if (!context) notFound()
  const { detail } = context
  const opportunity = detail.opportunity

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>{opportunity.name}</span>
      </p>
      <nav className="tabs" aria-label="Opportunity research sections">
        <Link className="tab active" href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          Overview
        </Link>
        <Link className="tab" href={`/workspace/${workspaceId}/opportunities/${slug}/evidence`}>
          Evidence
        </Link>
        <Link className="tab" href={`/workspace/${workspaceId}/opportunities/${slug}/report`}>
          Report
        </Link>
        <Link className="tab" href={`/workspace/${workspaceId}/opportunities/${slug}/plan`}>
          Plan
        </Link>
      </nav>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research package</p>
          <h1>{opportunity.name}</h1>
          <p className="auth-intro">{opportunity.oneLine}</p>
        </div>
        <strong className="workspace-score">{detail.summary.score.toFixed(1)}</strong>
      </div>
      <div className="detail-grid">
        <div>
          <p className="label">Thesis</p>
          <p>{opportunity.thesis}</p>
        </div>
        <div>
          <p className="label">Audience</p>
          <p>{opportunity.audience}</p>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="evidence-heading">
        <div className="section-intro">
          <h2 id="evidence-heading">Evidence</h2>
          <p>
            {detail.evidence.length} retained observations, with source representation rules
            applied.
          </p>
        </div>
        <ul className="complaint-list">
          {detail.evidence.map((evidence) => (
            <li key={evidence.id}>
              <div className="complaint-meta">
                <span>{evidence.product}</span>
                <span>{evidence.category}</span>
                <span>{evidence.synthetic ? 'Synthetic fixture' : evidence.sourceItemId}</span>
                <span>{evidence.analysis.complaintType.replace('_', ' ')}</span>
                <span>Severity {evidence.analysis.severity}/5</span>
              </div>
              <p>{evidence.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="workspace-section" aria-labelledby="coverage-heading">
        <div className="section-intro">
          <h2 id="coverage-heading">Coverage and plan</h2>
          <p>Gaps and generated planning artifacts remain visible alongside the recommendation.</p>
        </div>
        <div className="detail-grid">
          <div>
            <p className="label">Coverage gaps</p>
            <ul>
              {(detail.coverageGaps.length > 0
                ? detail.coverageGaps
                : ['No source coverage gaps were recorded.']
              ).map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">Plan files</p>
            <ul>
              {(detail.plan?.files ?? detail.opportunity.planFiles).map((file) => (
                <li key={typeof file === 'string' ? file : file.path}>
                  {typeof file === 'string' ? file : file.path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
