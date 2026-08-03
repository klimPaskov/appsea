import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  appseaIdentifierSchema,
  type WorkspaceInvitationReadModel,
  type WorkspaceMemberReadModel,
  type WorkspacePurgeRequest,
  type WorkspacePurgeReadiness
} from '@appsea/contracts'
import { WorkspaceAuthorizationError, WorkspaceMembershipManagementError } from '@appsea/db/auth'
import { WorkspaceMembersPanel } from '../../../../components/workspace-members-panel'
import { authRepository, readSession } from '../../../../server/auth-session'

export const dynamic = 'force-dynamic'

export default async function WorkspaceMembersPage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId } = await params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) notFound()

  let members: WorkspaceMemberReadModel[] = []
  let invitations: WorkspaceInvitationReadModel[] = []
  let purgeReadiness: WorkspacePurgeReadiness | null = null
  let purgeRequest: WorkspacePurgeRequest | null = null
  let canManage = workspace.role === 'owner'
  if (canManage) {
    try {
      members = await authRepository().listWorkspaceMembers(
        session.user.userId,
        parsedWorkspaceId.data
      )
      invitations = await authRepository().listWorkspaceInvitations(
        session.user.userId,
        parsedWorkspaceId.data
      )
      purgeReadiness = await authRepository().readWorkspacePurgeReadiness(
        session.user.userId,
        parsedWorkspaceId.data
      )
      purgeRequest = await authRepository().readWorkspacePurgeRequest(
        session.user.userId,
        parsedWorkspaceId.data
      )
    } catch (error) {
      if (error instanceof WorkspaceAuthorizationError) notFound()
      if (error instanceof WorkspaceMembershipManagementError) canManage = false
      else throw error
    }
  }

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Members</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private workspace</p>
          <h1>Members</h1>
          <p className="auth-intro">{workspace.displayName} access and roles.</p>
        </div>
        <Link className="quiet-button" href="/workspace">
          Back to workspace
        </Link>
      </div>
      <section className="workspace-section" aria-labelledby="members-heading">
        <div className="section-intro">
          <h2 id="members-heading">Workspace access</h2>
          <p>
            {canManage
              ? `${members.length} active member${members.length === 1 ? '' : 's'}.`
              : 'Owner-only access.'}
          </p>
        </div>
        {canManage ? (
          <WorkspaceMembersPanel
            workspaceId={parsedWorkspaceId.data}
            currentUserId={session.user.userId}
            initialMembers={members}
            initialInvitations={invitations}
            initialPurgeReadiness={purgeReadiness}
            initialPurgeRequest={purgeRequest}
            canManage
          />
        ) : (
          <p className="empty-state">Only workspace owners can view or manage member access.</p>
        )}
      </section>
    </main>
  )
}
