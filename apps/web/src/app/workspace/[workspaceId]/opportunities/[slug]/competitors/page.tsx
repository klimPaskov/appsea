import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CompetitorFeatureMatrix } from '../../../../../../components/competitor-feature-matrix'
import { readSession } from '../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../server/private-opportunity'
import { CompetitorObservationActions } from '../../../../competitor-observation-actions'
import { DeepResearchGateActions } from '../../../../deep-research-gate-actions'

export const dynamic = 'force-dynamic'

const statusLabels = {
  unresolved: 'Unresolved',
  'reviewed-seed-only': 'Reviewed seed only',
  'source-backed': 'Source-backed'
} as const

const statusDescriptions = {
  unresolved:
    'Competitor and contrary-signal research has not been completed. The records below must not be read as market coverage.',
  'reviewed-seed-only':
    'The records below are explicit, human-reviewed seed assumptions. No permitted competitor source evidence is attached, so they are not market research.',
  'source-backed':
    'The records below include confirmed claims linked to retained evidence from permitted sources. Coverage gaps remain visible below.'
} as const

export default async function PrivateCompetitorsPage({
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
  const research = detail.competitiveResearch

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          {detail.opportunity.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Competitors</span>
      </p>
      <nav className="tabs" aria-label="Opportunity research sections">
        <Link className="tab" href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          Overview
        </Link>
        <Link className="tab" href={`/workspace/${workspaceId}/opportunities/${slug}/evidence`}>
          Evidence
        </Link>
        <Link
          className="tab active"
          href={`/workspace/${workspaceId}/opportunities/${slug}/competitors`}
          aria-current="page"
        >
          Competitors
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
          <p className="eyebrow">Competitive intelligence</p>
          <h1>{detail.opportunity.name}</h1>
          <p className="auth-intro">
            Direct products, adjacent tools, platform features, and workarounds remain separate from
            complaint evidence.
          </p>
        </div>
        <strong className="workspace-score">{detail.opportunity.competitors.length}</strong>
      </div>

      <section className="workspace-section" aria-labelledby="deep-research-gate-heading">
        <div className="section-intro">
          <h2 id="deep-research-gate-heading">Deep-research gate</h2>
          <p>
            This is a separate readiness decision from source-backed competitor claims. It cannot
            turn fixture data or unapproved sources into market research.
          </p>
        </div>
        {detail.deepResearchGate ? (
          <>
            <p>
              <strong>{detail.deepResearchGate.status}</strong>
              {detail.deepResearchGate.gateId ? (
                <>
                  {' '}
                  · review <code>{detail.deepResearchGate.gateId}</code>
                </>
              ) : null}
            </p>
            {detail.deepResearchGate.status === 'passed' ? (
              <p className="success-note">
                Owner-reviewed gate passed for the recorded analysis snapshot. Coverage gaps remain
                visible below and in the evidence routes.
              </p>
            ) : null}
            {detail.deepResearchGate.blockingReasons.length > 0 ? (
              <div>
                <p className="label">Blocking reasons</p>
                <ul>
                  {detail.deepResearchGate.blockingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <dl className="detail-grid">
              <div>
                <dt className="label">Analysis snapshot</dt>
                <dd>
                  {detail.deepResearchGate.analysisRunId ? (
                    <code>{detail.deepResearchGate.analysisRunId}</code>
                  ) : (
                    'Not recorded'
                  )}
                </dd>
              </div>
              <div>
                <dt className="label">Snapshot hash</dt>
                <dd>
                  {detail.deepResearchGate.snapshotHash ? (
                    <code>{detail.deepResearchGate.snapshotHash}</code>
                  ) : (
                    'Not recorded'
                  )}
                </dd>
              </div>
            </dl>
            <DeepResearchGateActions
              workspaceId={workspaceId}
              slug={slug}
              role={context.workspace.role}
              initialStatus={detail.deepResearchGate.status}
            />
          </>
        ) : (
          <p className="empty-state">
            No deep-research review has been recorded. The opportunity remains a candidate even if
            its complaint analysis and seed assumptions are complete.
          </p>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="competitive-coverage-heading">
        <div className="section-intro">
          <h2 id="competitive-coverage-heading">Research coverage</h2>
          <p>
            <strong>{statusLabels[research.status]}</strong> — {statusDescriptions[research.status]}
          </p>
        </div>
        {research.synthetic ? (
          <p className="fixture-note">
            Synthetic fixture records — not verified market research or evidence of competitor
            demand.
          </p>
        ) : null}
        {research.seedReview ? (
          <dl className="detail-grid">
            <div>
              <dt className="label">Reviewed seed</dt>
              <dd>
                <code>{research.seedReview.reviewId}</code> · {research.seedReview.seedVersion}
              </dd>
            </div>
            <div>
              <dt className="label">Reviewed at</dt>
              <dd>
                {research.seedReview.reviewedAt} by <code>{research.seedReview.reviewedBy}</code>
              </dd>
            </div>
          </dl>
        ) : null}
        {research.sourceIds.length > 0 || research.evidenceIds.length > 0 ? (
          <div className="detail-grid">
            <div>
              <p className="label">Permitted sources</p>
              <ul>
                {research.sourceIds.map((sourceId) => (
                  <li key={sourceId}>
                    <code>{sourceId}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label">Retained evidence</p>
              <ul>
                {research.evidenceIds.map((evidenceId) => (
                  <li key={evidenceId}>
                    <code>{evidenceId}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <div>
          <p className="label">Coverage gaps</p>
          <ul>
            {(research.coverageGaps.length > 0
              ? research.coverageGaps
              : ['No competitive coverage gaps were recorded.']
            ).map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="competitive-observations-heading">
        <div className="section-intro">
          <h2 id="competitive-observations-heading">Evidence observations</h2>
          <p>
            Each claim keeps its source record, retained evidence, observation time, and human
            review state visible. Unreviewed claims do not make this research source-backed.
          </p>
        </div>
        {research.observations.length > 0 ? (
          <div className="observation-list">
            {research.observations.map((observation) => (
              <article key={observation.observationId}>
                <div className="observation-heading">
                  <div>
                    <p className="label">{observation.claimType.replaceAll('_', ' ')}</p>
                    <h3>{observation.claim}</h3>
                  </div>
                  <span className={`observation-state ${observation.reviewState}`}>
                    {observation.reviewState}
                  </span>
                </div>
                <dl className="detail-grid">
                  <div>
                    <dt className="label">Source record</dt>
                    <dd>
                      <code>{observation.sourceId}</code> ·{' '}
                      <code>{observation.sourceRecordId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Retained evidence</dt>
                    <dd>
                      {observation.evidenceId ? (
                        <code>{observation.evidenceId}</code>
                      ) : (
                        'Not attached'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Observed</dt>
                    <dd>{observation.observedAt}</dd>
                  </div>
                  <div>
                    <dt className="label">Captured</dt>
                    <dd>{observation.capturedAt}</dd>
                  </div>
                  {observation.canonicalLocator ? (
                    <div>
                      <dt className="label">Attribution</dt>
                      <dd>
                        <a href={observation.canonicalLocator} target="_blank" rel="noreferrer">
                          Open source record (attribution)
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {observation.synthetic ? (
                  <p className="fixture-note">
                    Synthetic fixture observation — not verified market evidence.
                  </p>
                ) : null}
                <CompetitorObservationActions
                  workspaceId={workspaceId}
                  slug={slug}
                  observationId={observation.observationId}
                  initialState={observation.reviewState}
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No source-backed competitor observations are attached. Reviewed seed assumptions remain
            separate from market evidence.
          </p>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="competitor-list-heading">
        <div className="section-intro">
          <h2 id="competitor-list-heading">Competitors and alternatives</h2>
          <p>
            {detail.opportunity.competitors.length > 0
              ? 'Each record keeps its relationship type, positioning, strengths, weaknesses, and related complaint categories visible.'
              : 'No competitor records have been attached to this opportunity.'}
          </p>
        </div>
        {detail.opportunity.competitors.length > 0 ? (
          <div className="competitor-list">
            {detail.opportunity.competitors.map((competitor) => (
              <article key={`${competitor.type}:${competitor.name}`}>
                <div className="competitor-heading">
                  <h3>{competitor.name}</h3>
                  <span>{competitor.type}</span>
                </div>
                <p>{competitor.positioning}</p>
                <div className="detail-grid">
                  <div>
                    <p className="label">Strengths</p>
                    <ul>
                      {(competitor.strengths.length > 0
                        ? competitor.strengths
                        : ['Not recorded']
                      ).map((strength) => (
                        <li key={strength}>{strength}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="label">Weaknesses</p>
                    <ul>
                      {(competitor.weaknesses.length > 0
                        ? competitor.weaknesses
                        : ['Not recorded']
                      ).map((weakness) => (
                        <li key={weakness}>{weakness}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="weakness">
                  Related complaint categories:{' '}
                  {competitor.relatedComplaintCategories.join(' · ') || 'Not recorded'}
                </p>
                <CompetitorFeatureMatrix competitor={competitor} />
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Research remains unresolved for this opportunity.</p>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="contrary-signals-heading">
        <div className="section-intro">
          <h2 id="contrary-signals-heading">Contrary and weak-market signals</h2>
          <p>These signals constrain the recommendation; missing research is shown as a gap.</p>
        </div>
        <ul>
          {detail.opportunity.contraryEvidence.length > 0 ? (
            detail.opportunity.contraryEvidence.map((signal) => <li key={signal}>{signal}</li>)
          ) : (
            <li>No contrary signal has been recorded in this reviewed artifact.</li>
          )}
        </ul>
      </section>
    </main>
  )
}
