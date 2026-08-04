import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { PostgresOpportunitySeedReviewRepository } from '@appsea/db/opportunity-seed-review'
import { PostgresProductionCollectionRepository } from '@appsea/db/production-collection'
import { getDatabasePool } from '../../../../../server/database'
import { readSession } from '../../../../../server/auth-session'
import { decodePathParam } from '../../../../../server/path-params'
import { ProductionComplaintReviewActions } from '../../../production-complaint-review-actions'
import { ProductionAnalysisStartAction } from '../../../production-analysis-start-action'

export const dynamic = 'force-dynamic'

export default async function ProductionCollectionPage({
  params
}: {
  params: Promise<{ workspaceId: string; runId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId: encodedWorkspaceId, runId: encodedRunId } = await params
  const workspaceId = decodePathParam(encodedWorkspaceId)
  const runId = decodePathParam(encodedRunId)
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedRunId = appseaIdentifierSchema.safeParse(runId)
  if (!parsedWorkspaceId.success || !parsedRunId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) notFound()
  const pool = getDatabasePool()
  const collection = await new PostgresProductionCollectionRepository(pool).readForUser(
    session.user.userId,
    parsedWorkspaceId.data,
    parsedRunId.data
  )
  if (!collection) notFound()
  const canStartAnalysis =
    !workspace.fixtureOnly &&
    workspace.visibility === 'private' &&
    (workspace.role === 'owner' || workspace.role === 'editor')
  const approvedSeeds = canStartAnalysis
    ? (
        await new PostgresOpportunitySeedReviewRepository(pool).listForUser(
          session.user.userId,
          parsedWorkspaceId.data
        )
      )
        .filter((review) => review.reviewState === 'approved')
        .map((review) => ({
          seedReviewId: review.seedReviewId,
          name: review.seed.name,
          slug: review.seed.slug
        }))
    : []

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Source collection</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Source collection</h1>
          <p className="auth-intro">
            {collection.result.sourceId} {' / '}policy {collection.result.policyVersion}
          </p>
        </div>
        <strong className="workspace-score">{collection.result.complaintCount}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="collection-status-heading">
        <div className="section-intro">
          <h2 id="collection-status-heading">Collection status</h2>
          <p>
            {collection.result.sourceItemCount} source items and {collection.result.evidenceCount}{' '}
            evidence records retained with source-native identifiers.
          </p>
        </div>
        <div className="detail-grid">
          <div>
            <p className="label">Coverage gaps</p>
            <ul>
              {collection.result.coverageGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">Source policy coverage</p>
            <ul>
              {collection.sourceCoverage.map((source) => (
                <li key={`${source.sourceId}:${source.displayMode}`}>
                  {source.displayName}: {source.observationCount} observations ({source.policyState}
                  )
                </li>
              ))}
            </ul>
          </div>
        </div>
        {collection.result.warnings.length > 0 ? (
          <div className="detail-grid">
            <div>
              <p className="label">Collection warnings</p>
              <ul>
                {collection.result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>
      <section className="workspace-section" aria-labelledby="evidence-heading">
        <div className="section-intro">
          <h2 id="evidence-heading">Evidence inspection</h2>
          <p>Only the representation allowed by the approved source policy is shown.</p>
        </div>
        <ul className="complaint-list">
          {collection.evidence.map((evidence) => (
            <li key={evidence.id}>
              <div className="complaint-meta">
                <span>{evidence.product}</span>
                <span>{evidence.category}</span>
                <span>{evidence.sourceRecordId}</span>
                <span>{evidence.allowedRepresentation}</span>
                <span>{evidence.redacted ? 'redacted' : 'not redacted'}</span>
                <span>{evidence.analysis.complaintType.replace('_', ' ')}</span>
                <span>Severity {evidence.analysis.severity}/5</span>
              </div>
              <p>
                {evidence.text ?? 'Narrative text is not displayable under this source policy.'}
              </p>
              <p className="complaint-meta">
                Classification {evidence.analysis.classificationConfidence.toFixed(2)}; entities{' '}
                {evidence.analysis.entityConfidence.toFixed(2)}. Unresolved:{' '}
                {evidence.analysis.entities.unresolvedTypes.join(', ') || 'none'}.
              </p>
              <p className="complaint-meta">
                <time dateTime={evidence.capturedAt}>Captured {evidence.capturedAt}</time>
                {evidence.publishedAt ? (
                  <time dateTime={evidence.publishedAt}>Published {evidence.publishedAt}</time>
                ) : (
                  <span>Publication time unavailable</span>
                )}
              </p>
              <ProductionComplaintReviewActions
                workspaceId={parsedWorkspaceId.data}
                runId={parsedRunId.data}
                complaintId={evidence.complaintId}
                evidenceId={evidence.id}
                redactedFields={evidence.redactedFields}
                canRedact={workspace.role === 'owner' || workspace.role === 'editor'}
                initialState={evidence.reviewState}
                analysis={evidence.analysis}
              />
            </li>
          ))}
        </ul>
        {collection.evidence.length === 0 ? (
          <p className="empty-state">No displayable evidence remains for this collection.</p>
        ) : null}
      </section>
      <section className="workspace-section" aria-labelledby="next-stage-heading">
        <div className="section-intro">
          <h2 id="next-stage-heading">Next stage</h2>
          <p>
            Analysis uses only confirmed evidence and an approved opportunity seed. It produces the
            private opportunity, report, and coding plan as separate governed outputs.
          </p>
        </div>
        {canStartAnalysis ? (
          <ProductionAnalysisStartAction
            workspaceId={parsedWorkspaceId.data}
            collectionRunId={parsedRunId.data}
            approvedSeeds={approvedSeeds}
          />
        ) : (
          <p className="muted-note">
            An owner or editor can start reviewed analysis after confirming the retained evidence.
          </p>
        )}
      </section>
    </main>
  )
}
