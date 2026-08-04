import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { readSession } from '../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../server/private-opportunity'

export const dynamic = 'force-dynamic'

export default async function PrivateReportPage({
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
        <span>Report</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Evidence-backed report</p>
          <h1>{detail.opportunity.name}</h1>
        </div>
        <div className="workspace-actions">
          <span>
            {detail.report
              ? `${detail.report.version} · ${detail.report.approvalState}`
              : 'Not generated'}
          </span>
          {detail.report?.approvalState === 'approved' ? (
            <a
              className="quiet-button"
              href={`/api/workspaces/${workspaceId}/reports/${detail.report.id}/export`}
            >
              Export JSON
            </a>
          ) : null}
        </div>
      </div>
      {detail.report ? (
        <>
          {detail.report.structuredReport.synthetic ? (
            <p className="fixture-note">Synthetic fixture report — not market research.</p>
          ) : null}
          <section className="workspace-section" aria-labelledby="report-evidence-heading">
            <div className="section-intro">
              <h2 id="report-evidence-heading">Evidence</h2>
              <p>
                {detail.report.structuredReport.evidence.complaintCount} retained observations
                across {detail.report.structuredReport.evidence.clusterCount} clusters.
              </p>
            </div>
            {detail.report.structuredReport.evidence.deduplication.some(
              (decision) => decision.reviewRequired
            ) ? (
              <p className="fixture-note">
                Near-duplicate candidates are retained pending human review; no unique-author count
                is inferred.
              </p>
            ) : null}
            <ul className="complaint-list">
              {detail.report.structuredReport.evidence.observations.map((observation) => (
                <li key={observation.evidenceId}>
                  <div className="complaint-meta">
                    <span>{observation.product}</span>
                    <span>{observation.category}</span>
                    <span>{observation.sourceId}</span>
                    <span>{observation.allowedRepresentation}</span>
                  </div>
                  <p>{observation.excerpt}</p>
                </li>
              ))}
            </ul>
          </section>
          <section className="workspace-section" aria-labelledby="report-inference-heading">
            <div className="section-intro">
              <h2 id="report-inference-heading">Inference</h2>
              <p>Scored inputs and contrary evidence remain inspectable.</p>
            </div>
            <div className="detail-grid">
              <div>
                <p className="label">Confidence</p>
                <p>{detail.report.structuredReport.inference.confidence}</p>
                <p className="label">Score</p>
                <p>
                  {detail.report.structuredReport.inference.scoreSnapshot.score.toFixed(1)} / 100
                </p>
              </div>
              <div>
                <p className="label">Rationale</p>
                <ul>
                  {detail.report.structuredReport.inference.rationale.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {detail.report.structuredReport.inference.contraryEvidence.length > 0 ? (
                  <>
                    <p className="label">Contrary evidence</p>
                    <ul>
                      {detail.report.structuredReport.inference.contraryEvidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </div>
          </section>
          <section className="workspace-section" aria-labelledby="report-recommendation-heading">
            <div className="section-intro">
              <h2 id="report-recommendation-heading">Recommendation</h2>
              <p>Next steps are bounded by the evidence and its coverage limits.</p>
            </div>
            <p className="statement">
              {detail.report.structuredReport.recommendation.decision} the first wedge:{' '}
              {detail.report.structuredReport.recommendation.firstWedge}
            </p>
            <ul>
              {detail.report.structuredReport.recommendation.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </section>
          <section className="workspace-section" aria-labelledby="report-coverage-heading">
            <div className="section-intro">
              <h2 id="report-coverage-heading">Coverage limits</h2>
              <p>Missing access is recorded as a gap, not treated as no demand.</p>
            </div>
            <ul>
              {(detail.report.structuredReport.coverage.gaps.length > 0
                ? detail.report.structuredReport.coverage.gaps
                : ['No source coverage gaps were recorded.']
              ).map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="empty-state">No report has been generated for this opportunity.</p>
      )}
    </main>
  )
}
