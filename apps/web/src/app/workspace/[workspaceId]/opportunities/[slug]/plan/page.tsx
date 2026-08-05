import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { readSession } from '../../../../../../server/auth-session'
import { readPrivateOpportunityContext } from '../../../../../../server/private-opportunity'
import { ArtifactApprovalActions } from '../../../../report-plan-approval-actions'
import { WorkspaceOpportunityTabs } from '../../../../../../components/workspace-opportunity-tabs'

export const dynamic = 'force-dynamic'

export default async function PrivatePlanPage({
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
  const { detail, workspace } = context
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
        <span>{detail.plan?.version ?? 'Not generated'}</span>
      </div>
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
            <p>
              <a href={`/api/workspaces/${workspaceId}/plans/${detail.plan.id}/export`} download>
                Export approved plan package
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <p className="empty-state">No coding-agent plan has been generated for this opportunity.</p>
      )}
    </main>
  )
}
