import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, workflowIdSchema } from '@appsea/contracts'
import { PostgresProductionCollectionWorkflowRepository } from '@appsea/db/production-collection-workflow'
import { readSession } from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'

export const dynamic = 'force-dynamic'

export default async function ProductionWorkflowStatusPage({
  params
}: {
  params: Promise<{ workspaceId: string; workflowId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId, workflowId } = await params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedWorkflowId = workflowIdSchema.safeParse(workflowId)
  if (!parsedWorkspaceId.success || !parsedWorkflowId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace || workspace.fixtureOnly || workspace.visibility !== 'private') notFound()
  const run = await new PostgresProductionCollectionWorkflowRepository(
    getDatabasePool()
  ).readForUser(session.user.userId, parsedWorkspaceId.data, parsedWorkflowId.data)
  if (!run) notFound()

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${parsedWorkspaceId.data}/campaigns`}>Campaigns</Link>
        <span aria-hidden="true">/</span>
        <span>Collection status</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Collection status</h1>
          <p className="auth-intro">
            {run.sourceId} {' / '}policy {run.policyVersion}
          </p>
        </div>
        <strong className="workspace-score">{run.state}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="workflow-details-heading">
        <div className="section-intro">
          <h2 id="workflow-details-heading">Durable workflow</h2>
          <p>
            Status is read from the private PostgreSQL workflow projection. It excludes idempotency
            hashes and source payloads.
          </p>
        </div>
        <dl className="detail-grid">
          <div>
            <dt className="label">Campaign</dt>
            <dd>{run.campaignId}</dd>
          </div>
          <div>
            <dt className="label">Research run</dt>
            <dd>{run.runId}</dd>
          </div>
          <div>
            <dt className="label">Workflow checkpoint</dt>
            <dd>{run.checkpoint}</dd>
          </div>
          <div>
            <dt className="label">Activity attempts</dt>
            <dd>{run.activityAttempts}</dd>
          </div>
          <div>
            <dt className="label">Source items</dt>
            <dd>{run.consumedSourceItems}</dd>
          </div>
          <div>
            <dt className="label">Cost micros</dt>
            <dd>{run.consumedCostMicros}</dd>
          </div>
        </dl>
        <p className="complaint-meta">
          <time dateTime={run.requestedAt}>Requested {run.requestedAt}</time>
          <time dateTime={run.updatedAt}>Updated {run.updatedAt}</time>
          {run.finishedAt ? <time dateTime={run.finishedAt}>Finished {run.finishedAt}</time> : null}
        </p>
        <p className="complaint-meta">
          Workflow ID <code>{run.workflowId}</code>
        </p>
        {run.state === 'completed' ? (
          <p className="workspace-actions">
            <Link
              className="quiet-button"
              href={`/workspace/${parsedWorkspaceId.data}/research/${run.runId}`}
            >
              Inspect retained evidence
            </Link>
          </p>
        ) : (
          <p className="muted-note">
            Evidence inspection becomes available after the collection reaches a completed state.
          </p>
        )}
      </section>
    </main>
  )
}
