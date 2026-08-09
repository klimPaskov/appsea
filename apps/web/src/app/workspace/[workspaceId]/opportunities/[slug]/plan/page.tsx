import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { readSession } from '../../../../../../server/auth-session'
import {
  readPrivateArtifactHistoryForUser,
  readPrivateOpportunityContext,
  readPrivatePlanVersionForUser
} from '../../../../../../server/private-opportunity'
import { planPackageSchema } from '@appsea/contracts'
import { comparePlanPackages } from '@appsea/reports'
import { ArtifactApprovalActions } from '../../../../report-plan-approval-actions'
import { WorkspaceOpportunityTabs } from '../../../../../../components/workspace-opportunity-tabs'

export const dynamic = 'force-dynamic'

export default async function PrivatePlanPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string; slug: string }>
  searchParams?: Promise<{ version?: string; from?: string; to?: string }>
}) {
  const { workspaceId, slug } = await params
  const context = await readPrivateOpportunityContext(workspaceId, slug)
  if (!context) {
    const session = await readSession()
    if (!session) redirect('/login')
    notFound()
  }
  const { detail: baseDetail, workspace } = context
  const history = await readPrivateArtifactHistoryForUser(
    context.session.user.userId,
    workspace.workspaceId,
    baseDetail.opportunity.id
  )
  const query = await searchParams
  const selectedSummary = query?.version
    ? history.plans.find((plan) => plan.id === query.version && plan.approvalState !== 'withdrawn')
    : undefined
  const selectedPlan = selectedSummary
    ? await readPrivatePlanVersionForUser(
        context.session.user.userId,
        workspace.workspaceId,
        selectedSummary.id,
        baseDetail.opportunity.id
      )
    : baseDetail.plan
  const detail = { ...baseDetail, plan: selectedPlan }
  const compareFrom = query?.from
    ? history.plans.find((plan) => plan.id === query.from && plan.approvalState !== 'withdrawn')
    : undefined
  const compareTo = query?.to
    ? history.plans.find((plan) => plan.id === query.to && plan.approvalState !== 'withdrawn')
    : undefined
  let comparison: ReturnType<typeof comparePlanPackages> | null = null
  if (compareFrom && compareTo) {
    const [fromPlan, toPlan] = await Promise.all([
      readPrivatePlanVersionForUser(
        context.session.user.userId,
        workspace.workspaceId,
        compareFrom.id,
        baseDetail.opportunity.id
      ),
      readPrivatePlanVersionForUser(
        context.session.user.userId,
        workspace.workspaceId,
        compareTo.id,
        baseDetail.opportunity.id
      )
    ])
    if (fromPlan && toPlan) {
      comparison = comparePlanPackages(
        planPackageSchema.parse({
          opportunitySlug: slug,
          generatedAt: fromPlan.generatedAt,
          files: fromPlan.files
        }),
        planPackageSchema.parse({
          opportunitySlug: slug,
          generatedAt: toPlan.generatedAt,
          files: toPlan.files
        })
      )
    }
  }
  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href={`/workspace/${workspaceId}/opportunities/${slug}`}>
          {detail.opportunity.name}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Plan</span>
      </p>
      <WorkspaceOpportunityTabs workspaceId={workspaceId} slug={slug} active="plan" />
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Coding-agent plan</p>
          <h1>{detail.opportunity.name}</h1>
        </div>
        <div className="workspace-actions">
          <span>{detail.plan?.version ?? 'Not generated'}</span>
          {detail.plan?.approvalState === 'approved' ? (
            <span className="workspace-export-links">
              <a
                className="quiet-button"
                href={`/api/workspaces/${workspaceId}/plans/${detail.plan.id}/export`}
              >
                Export JSON
              </a>
              <a
                className="quiet-button"
                href={`/api/workspaces/${workspaceId}/plans/${detail.plan.id}/export?format=markdown`}
              >
                Export Markdown
              </a>
            </span>
          ) : null}
        </div>
      </div>
      {history.plans.length > 0 ? (
        <section className="artifact-history" aria-labelledby="plan-history-heading">
          <div>
            <p className="label">Version history</p>
            <h2 id="plan-history-heading">Plan versions</h2>
          </div>
          <ul>
            {history.plans.map((version) => (
              <li key={version.id}>
                {version.approvalState === 'withdrawn' ? (
                  <span>{version.version}</span>
                ) : (
                  <Link
                    href={`/workspace/${workspaceId}/opportunities/${slug}/plan?version=${encodeURIComponent(version.id)}`}
                    aria-current={version.id === detail.plan?.id ? 'page' : undefined}
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
          {history.truncated ? (
            <p className="muted-note">
              Showing the 50 most recent versions; older history is retained in PostgreSQL.
            </p>
          ) : null}
        </section>
      ) : null}
      {detail.plan ? (
        <ArtifactApprovalActions
          workspaceId={workspaceId}
          artifactId={detail.plan.id}
          kind="plan"
          role={workspace.role}
          initialState={detail.plan.approvalState}
          readinessState={detail.plan.readinessState}
        />
      ) : null}
      {detail.plan ? (
        <>
          <p className="muted-note">
            Approval: <strong>{detail.plan.approvalState}</strong>
          </p>
          <ol className="file-list">
            {detail.plan.files.map((file) => (
              <li key={file.path}>
                <span>{file.path}</span>
                <pre className="plan-file-preview">{file.content}</pre>
              </li>
            ))}
          </ol>
          {detail.plan.approvalState === 'approved' ? (
            <p className="muted-note">Only approved versions can be exported.</p>
          ) : null}
        </>
      ) : (
        <p className="empty-state">No coding-agent plan has been generated for this opportunity.</p>
      )}
      {history.plans.length > 1 ? (
        <section className="workspace-section" aria-labelledby="plan-compare-heading">
          <div className="section-intro">
            <h2 id="plan-compare-heading">Compare versions</h2>
            <p>Compare file hashes and byte counts without exposing a second source copy.</p>
          </div>
          <form className="plan-compare-form" method="get">
            <label>
              From
              <select name="from" defaultValue={compareFrom?.id ?? history.plans[1]?.id}>
                {history.plans
                  .filter((version) => version.approvalState !== 'withdrawn')
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              To
              <select name="to" defaultValue={compareTo?.id ?? history.plans[0]?.id}>
                {history.plans
                  .filter((version) => version.approvalState !== 'withdrawn')
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.version}
                    </option>
                  ))}
              </select>
            </label>
            <button className="quiet-button" type="submit">
              Compare
            </button>
          </form>
          {comparison ? (
            <div className="plan-comparison" role="region" aria-label="Plan file comparison">
              <p className="muted-note">
                {comparison.added.length} added · {comparison.removed.length} removed ·{' '}
                {comparison.changed.length} changed · {comparison.unchanged.length} unchanged
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">Status</th>
                      <th scope="col">Before bytes</th>
                      <th scope="col">After bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.files.map((file) => (
                      <tr key={file.path}>
                        <th scope="row">{file.path}</th>
                        <td>{file.state}</td>
                        <td>{file.before?.bytes ?? '—'}</td>
                        <td>{file.after?.bytes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
