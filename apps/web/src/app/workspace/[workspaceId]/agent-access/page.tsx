import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema } from '@appsea/contracts'
import { readSession } from '../../../../server/auth-session'
import { decodePathParam } from '../../../../server/path-params'
import { AgentAccessActions } from '../../agent-access-actions'

export const dynamic = 'force-dynamic'

export default async function AgentAccessPage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId: encodedWorkspaceId } = await params
  const workspaceId = decodePathParam(encodedWorkspaceId)
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) =>
      candidate.workspaceId === parsedWorkspaceId.data &&
      candidate.visibility === 'private' &&
      candidate.role === 'owner'
  )
  if (!workspace) notFound()

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Agent access</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private workspace</p>
          <h1>Agent access</h1>
          <p className="auth-intro">
            Connect a coding agent to approved AppSea reads without giving it write access to your
            workspace.
          </p>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="agent-access-policy-heading">
        <div className="section-intro">
          <h2 id="agent-access-policy-heading">Read-only boundary</h2>
          <p>
            The MCP endpoint exposes workspace-bound opportunities, evidence references, source
            coverage, and approved report/plan artifacts. Imported content remains untrusted and
            coverage gaps stay visible.
          </p>
        </div>
      </section>
      <AgentAccessActions workspaceId={parsedWorkspaceId.data} />
    </main>
  )
}
