import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, workspaceArtifactHistoryPageQuerySchema } from '@appsea/contracts'
import { readSession } from '../../../../../../server/auth-session'
import {
  readPrivateArtifactHistoryForUser,
  readPrivateOpportunityContext,
  readPrivateReportVersionForUser
} from '../../../../../../server/private-opportunity'
import { ArtifactApprovalActions } from '../../../../report-plan-approval-actions'
import { WorkspaceOpportunityTabs } from '../../../../../../components/workspace-opportunity-tabs'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function oneValue(value: string | string[] | undefined): string | undefined | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return value
}

export default async function PrivateReportPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string; slug: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { workspaceId, slug } = await params
  const context = await readPrivateOpportunityContext(workspaceId, slug)
  if (!context) {
    const session = await readSession()
    if (!session) redirect('/login')
    notFound()
  }
  const { detail: baseDetail, workspace } = context
  const rawSearchParams = await searchParams
  const allowedKeys = new Set(['version', 'limit', 'reportCursor'])
  if (rawSearchParams && Object.keys(rawSearchParams).some((key) => !allowedKeys.has(key))) {
    notFound()
  }
  const version = oneValue(rawSearchParams?.version)
  const limit = oneValue(rawSearchParams?.limit)
  const reportCursor = oneValue(rawSearchParams?.reportCursor)
  if (version === null || limit === null || reportCursor === null) notFound()
  const historyQuery = workspaceArtifactHistoryPageQuerySchema.safeParse({
    limit: limit === undefined ? undefined : Number(limit),
    reportCursor: reportCursor === undefined ? undefined : reportCursor
  })
  if (!historyQuery.success) notFound()
  const history = await readPrivateArtifactHistoryForUser(
    context.session.user.userId,
    workspace.workspaceId,
    baseDetail.opportunity.id,
    historyQuery.data
  )
  let selectedReport = baseDetail.report
  if (version !== undefined) {
    const parsedVersion = appseaIdentifierSchema.safeParse(version)
    if (!parsedVersion.success) notFound()
    selectedReport = await readPrivateReportVersionForUser(
      context.session.user.userId,
      workspace.workspaceId,
      parsedVersion.data,
      baseDetail.opportunity.id
    )
    if (!selectedReport) notFound()
  }
  const detail = { ...baseDetail, report: selectedReport }
  const nextReportHref = history.nextReportCursor
    ? `/workspace/${encodeURIComponent(workspaceId)}/opportunities/${encodeURIComponent(slug)}/report?limit=${historyQuery.data.limit}&reportCursor=${encodeURIComponent(history.nextReportCursor)}`
    : null
  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          {detail.opportunity.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Report</span>
      </p>
      <WorkspaceOpportunityTabs workspaceId={workspaceId} slug={slug} active="report" />
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
            <span className="workspace-export-links">
              <a
                className="quiet-button"
                href={`/api/workspaces/${workspaceId}/reports/${detail.report.id}/export`}
              >
                Export JSON
              </a>
              <a
                className="quiet-button"
                href={`/api/workspaces/${workspaceId}/reports/${detail.report.id}/export?format=markdown`}
              >
                Export Markdown
              </a>
            </span>
          ) : null}
        </div>
      </div>
      {history.reports.length > 0 ? (
        <section className="artifact-history" aria-labelledby="report-history-heading">
          <div>
            <p className="label">Version history</p>
            <h2 id="report-history-heading">Report versions</h2>
          </div>
          <ul>
            {history.reports.map((version) => (
              <li key={version.id}>
                {version.approvalState === 'withdrawn' ? (
                  <span>{version.version}</span>
                ) : (
                  <Link
                    href={`/workspace/${workspaceId}/opportunities/${slug}/report?version=${encodeURIComponent(version.id)}`}
                    aria-current={version.id === detail.report?.id ? 'page' : undefined}
                  >
                    {version.version}
                  </Link>
                )}
                <span>{version.approvalState}</span>
                <time dateTime={version.generatedAt}>
                  {new Date(version.generatedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
          {nextReportHref ? (
            <p className="muted-note">
              <Link href={nextReportHref}>Show older report versions</Link>
            </p>
          ) : null}
        </section>
      ) : null}
      {detail.report ? (
        <ArtifactApprovalActions
          workspaceId={workspaceId}
          artifactId={detail.report.id}
          kind="report"
          role={workspace.role}
          initialState={detail.report.approvalState}
        />
      ) : null}
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
          {detail.report.structuredReport.competitiveResearch ? (
            <section className="workspace-section" aria-labelledby="report-competitive-heading">
              <div className="section-intro">
                <h2 id="report-competitive-heading">Confirmed competitive evidence</h2>
                <p>
                  Evidence-linked observations included in this explicit reviewed analysis run. They
                  remain tenant-private and do not represent broad market coverage.
                </p>
              </div>
              {detail.report.structuredReport.competitiveResearch.observations.length > 0 ? (
                <ul className="complaint-list">
                  {detail.report.structuredReport.competitiveResearch.observations.map(
                    (observation) => (
                      <li key={observation.observationId}>
                        <div className="complaint-meta">
                          <span>{observation.competitorName}</span>
                          <span>{observation.competitorType}</span>
                          <span>{observation.claimType}</span>
                          <span>{observation.allowedRepresentation}</span>
                        </div>
                        <p>{observation.claim}</p>
                        <p className="complaint-meta">
                          Observation <code>{observation.observationId}</code> · evidence{' '}
                          <code>{observation.evidenceId}</code> · source{' '}
                          <code>{observation.sourceRecordId}</code>
                        </p>
                        {observation.canonicalLocator ? (
                          <p className="complaint-meta">
                            <a href={observation.canonicalLocator} target="_blank" rel="noreferrer">
                              Open source record (attribution)
                            </a>
                          </p>
                        ) : null}
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <p className="empty-state">No confirmed competitive observations were included.</p>
              )}
              {detail.report.structuredReport.competitiveResearch.coverageGaps.length > 0 ? (
                <ul>
                  {detail.report.structuredReport.competitiveResearch.coverageGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
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
            {detail.report.structuredReport.qualitySnapshot?.qualityGate ? (
              <p className="complaint-meta">
                Quality regression gate:{' '}
                <span>{detail.report.structuredReport.qualitySnapshot.qualityGate.status}</span>
                {' · synthetic benchmark regression check; not live calibration.'}
                {detail.report.structuredReport.qualitySnapshot.qualityGate.status === 'fail'
                  ? ` ${detail.report.structuredReport.qualitySnapshot.qualityGate.failures.length} threshold failure(s).`
                  : ''}
              </p>
            ) : null}
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
