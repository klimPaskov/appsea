import Link from 'next/link'
import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { readSession } from '../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../server/private-opportunity'
import { WorkspaceOpportunityTabs } from '../../../../../../components/workspace-opportunity-tabs'
import { ClusterReviewActions } from '../../../../cluster-review-actions'

export const dynamic = 'force-dynamic'

export default async function PrivateEvidencePage({
  params
}: {
  params: Promise<{ workspaceId: string; slug: string }>
}) {
  const { workspaceId, slug } = await params
  const context = await readPrivateOpportunityContext(workspaceId, slug)
  if (!context) {
    const session = await readSession()
    if (!session) redirect('/login')
    notFound()
  }
  const { detail } = context
  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          {detail.opportunity.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Evidence</span>
      </p>
      <WorkspaceOpportunityTabs workspaceId={workspaceId} slug={slug} active="evidence" />
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Evidence inspection</p>
          <h1>{detail.opportunity.name}</h1>
        </div>
        <strong className="workspace-score">{detail.evidence.length}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="coverage-heading">
        <div className="section-intro evidence-section-intro">
          <div className="evidence-heading">
            <Image
              src="/appsea-evidence-icon-generated.png"
              alt=""
              width={48}
              height={48}
              aria-hidden="true"
              priority
            />
            <h2 id="coverage-heading">Source coverage</h2>
          </div>
          <p>Gaps are recorded rather than interpreted as evidence of no demand.</p>
        </div>
        <ul>
          {(detail.coverageGaps.length > 0
            ? detail.coverageGaps
            : ['No source coverage gaps were recorded.']
          ).map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
        {detail.sourceCoverage.length > 0 ? (
          <ul className="coverage-list">
            {detail.sourceCoverage.map((source) => (
              <li key={source.sourceId}>
                <div className="complaint-meta">
                  <span>{source.displayName}</span>
                  <span>{source.policyState.replace('_', ' ')}</span>
                  <span>{source.displayMode}</span>
                </div>
                <p>
                  {source.observationCount} retained observation
                  {source.observationCount === 1 ? '' : 's'};{' '}
                  {source.synthetic ? 'synthetic fixture' : 'permitted source'}.
                </p>
                {source.coverageNotes.length > 0 ? (
                  <ul>
                    {source.coverageNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {detail.evidence.some((evidence) => evidence.deduplication?.reviewRequired) ? (
          <p className="fixture-note">
            Near-duplicate candidates are retained for human review. They are not counted as unique
            authors or silently merged.
          </p>
        ) : null}
      </section>
      <ClusterReviewActions
        workspaceId={workspaceId}
        slug={slug}
        role={context.workspace.role}
        synthetic={detail.summary.synthetic}
        initialClusters={detail.clusters}
      />
      <section className="workspace-section" aria-labelledby="evidence-heading">
        <div className="section-intro">
          <h2 id="evidence-heading">Retained observations</h2>
          <p>Only representations permitted by the source policy are displayed.</p>
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
                {evidence.analysis.manipulationRisk >= 0.85 ? (
                  <span>Instruction-like content: review required</span>
                ) : null}
                {evidence.deduplication?.reviewRequired ? (
                  <span>Near-duplicate review required</span>
                ) : null}
              </div>
              <p>{evidence.text}</p>
              {evidence.canonicalLocator ? (
                <p className="complaint-meta">
                  <a href={evidence.canonicalLocator} target="_blank" rel="noreferrer">
                    Open source record (attribution)
                  </a>
                </p>
              ) : null}
              <p className="complaint-meta">
                Classification {evidence.analysis.classificationConfidence.toFixed(2)}; entities{' '}
                {evidence.analysis.entityConfidence.toFixed(2)}. Unresolved:{' '}
                {evidence.analysis.entities.unresolvedTypes.join(', ') || 'none'}.
              </p>
              {evidence.analysis.marketSignalHints.length > 0 ? (
                <p className="complaint-meta">
                  Market context hints:{' '}
                  {evidence.analysis.marketSignalHints.map((hint) => hint.signalCode).join(', ')}{' '}
                  (source-context only; not scored)
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
