import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, workflowIdSchema } from '@appsea/contracts'
import { PostgresProductionAnalysisRepository } from '@appsea/db/production-analysis'
import { readSession } from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'
import { getObjectStore } from '../../../../../../server/object-store'
import {
  ProductionAnalysisStatusMismatchError,
  readPrivateProductionAnalysisStatus
} from '../../../../../../server/production-analysis-status'
import { productionAnalysisWorkflowBelongsToWorkspace } from '../../../../../../server/production-workflow-gateway'

export const dynamic = 'force-dynamic'

export default async function ProductionAnalysisStatusPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string; analysisRunId: string }>
  searchParams: Promise<{ workflowId?: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId, analysisRunId } = await params
  const query = await searchParams
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedAnalysisRunId = appseaIdentifierSchema.safeParse(analysisRunId)
  if (!parsedWorkspaceId.success || !parsedAnalysisRunId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace || workspace.fixtureOnly || workspace.visibility !== 'private') notFound()

  let workflowId: string | undefined
  if (query.workflowId !== undefined) {
    const parsedWorkflowId = workflowIdSchema.safeParse(query.workflowId)
    if (!parsedWorkflowId.success) notFound()
    if (
      !productionAnalysisWorkflowBelongsToWorkspace(parsedWorkflowId.data, parsedWorkspaceId.data)
    ) {
      notFound()
    }
    workflowId = parsedWorkflowId.data
  }

  let status: Awaited<ReturnType<typeof readPrivateProductionAnalysisStatus>>
  let unavailable = false
  try {
    status = await readPrivateProductionAnalysisStatus({
      userId: session.user.userId,
      workspaceId: parsedWorkspaceId.data,
      analysisRunId: parsedAnalysisRunId.data,
      workflowId
    })
  } catch (error) {
    if (error instanceof ProductionAnalysisStatusMismatchError) notFound()
    unavailable = true
  }
  if (!status && !unavailable) notFound()

  let opportunitySlug: string | null = status?.opportunitySlug ?? null
  if (status?.state === 'completed' && !opportunitySlug) {
    try {
      const completed = await new PostgresProductionAnalysisRepository(
        getDatabasePool(),
        getObjectStore()
      ).readForUser(session.user.userId, parsedWorkspaceId.data, parsedAnalysisRunId.data)
      opportunitySlug = completed?.artifact.opportunity.slug ?? null
    } catch {
      // The durable status remains useful even when an output object is unavailable.
    }
  }

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${parsedWorkspaceId.data}/research/${parsedAnalysisRunId.data}`}>
          Collection
        </Link>
        <span aria-hidden="true">/</span>
        <span>Analysis status</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Analysis status</h1>
          <p className="auth-intro">Reviewed evidence to opportunity package</p>
        </div>
        <strong className="workspace-score">{status?.state ?? 'unavailable'}</strong>
      </div>
      {unavailable || !status ? (
        <section className="workspace-section" aria-labelledby="analysis-unavailable-heading">
          <h2 id="analysis-unavailable-heading">Status temporarily unavailable</h2>
          <p className="muted-note">
            The workflow service and durable projection could not be read. Refresh this page after
            the worker reconnects.
          </p>
        </section>
      ) : (
        <section className="workspace-section" aria-labelledby="analysis-details-heading">
          <div className="section-intro">
            <h2 id="analysis-details-heading">Durable analysis projection</h2>
            <p>
              This read excludes input hashes, object references, source payloads, and seed content.
              Refresh to read the latest state.
            </p>
          </div>
          <dl className="detail-grid">
            <div>
              <dt className="label">Analysis run</dt>
              <dd>{status.analysisRunId}</dd>
            </div>
            <div>
              <dt className="label">Collection run</dt>
              <dd>{status.collectionRunId ?? 'pending initialization'}</dd>
            </div>
            <div>
              <dt className="label">Checkpoint</dt>
              <dd>{status.checkpoint}</dd>
            </div>
            <div>
              <dt className="label">Activity attempts</dt>
              <dd>{status.activityAttempts}</dd>
            </div>
            <div>
              <dt className="label">Availability</dt>
              <dd>{status.availabilityState}</dd>
            </div>
            <div>
              <dt className="label">Opportunity</dt>
              <dd>{opportunitySlug ?? status.opportunityId ?? 'pending'}</dd>
            </div>
          </dl>
          {status.failureSummary ? <p className="form-error">{status.failureSummary}</p> : null}
          <p className="complaint-meta">
            {status.requestedAt ? (
              <time dateTime={status.requestedAt}>Requested {status.requestedAt}</time>
            ) : null}
            {status.startedAt ? (
              <time dateTime={status.startedAt}>Started {status.startedAt}</time>
            ) : null}
            {status.completedAt ? (
              <time dateTime={status.completedAt}>Completed {status.completedAt}</time>
            ) : null}
          </p>
          {status.state === 'completed' && opportunitySlug ? (
            <p className="workspace-actions">
              <Link
                className="quiet-button"
                href={`/workspace/${parsedWorkspaceId.data}/opportunities/${opportunitySlug}`}
              >
                Open opportunity package
              </Link>
            </p>
          ) : status.state === 'completed' ? (
            <p className="muted-note">
              The analysis completed, but its object-backed opportunity package is not available
              yet.
            </p>
          ) : null}
        </section>
      )}
    </main>
  )
}
