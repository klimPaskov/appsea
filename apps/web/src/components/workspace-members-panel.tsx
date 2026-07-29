'use client'

import { useState, type FormEvent } from 'react'
import {
  workspaceInvitationReadModelSchema,
  workspaceInvitationRoleSchema,
  workspaceMemberReadModelSchema,
  workspaceRoleSchema,
  type WorkspaceInvitationReadModel,
  type WorkspaceMemberReadModel
} from '@appsea/contracts'

type WorkspaceMembersPanelProps = {
  workspaceId: string
  currentUserId: string
  initialMembers: WorkspaceMemberReadModel[]
  initialInvitations: WorkspaceInvitationReadModel[]
  canManage: boolean
}

export function WorkspaceMembersPanel({
  workspaceId,
  currentUserId,
  initialMembers,
  initialInvitations,
  canManage
}: WorkspaceMembersPanelProps) {
  const [members, setMembers] = useState(initialMembers)
  const [invitations, setInvitations] = useState(initialInvitations)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null)
  const [invitationEmail, setInvitationEmail] = useState('')
  const [invitationRole, setInvitationRole] = useState<'editor' | 'viewer'>('viewer')
  const [error, setError] = useState<string | null>(null)
  const [reauthenticated, setReauthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [reauthenticating, setReauthenticating] = useState(false)

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setReauthenticating(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/reauthenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const body = (await response.json()) as { error?: unknown }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to verify password')
      setReauthenticated(true)
    } catch (cause) {
      setReauthenticated(false)
      setError(cause instanceof Error ? cause.message : 'Unable to verify password')
    } finally {
      setPassword('')
      setReauthenticating(false)
    }
  }

  async function updateRole(userId: string, role: WorkspaceMemberReadModel['role']) {
    setPendingUserId(userId)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role })
      })
      const body = (await response.json()) as { data?: unknown; error?: unknown }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before changing member access')
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to update member')
      const member = workspaceMemberReadModelSchema.parse(body.data)
      setMembers((current) => current.map((entry) => (entry.userId === userId ? member : entry)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update member')
    } finally {
      setPendingUserId(null)
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm('Remove this member from the workspace?')) return
    setPendingUserId(userId)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE'
      })
      const body = (await response.json()) as { error?: unknown }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before changing member access')
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to remove member')
      setMembers((current) => current.filter((entry) => entry.userId !== userId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove member')
    } finally {
      setPendingUserId(null)
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingInvitationId('new')
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: invitationEmail, role: invitationRole })
      })
      const body = (await response.json()) as { data?: unknown; error?: unknown }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before inviting a member')
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to create invitation')
      const invitation = workspaceInvitationReadModelSchema.parse(body.data)
      setInvitations((current) => [invitation, ...current])
      setInvitationEmail('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create invitation')
    } finally {
      setPendingInvitationId(null)
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!window.confirm('Revoke this workspace invitation?')) return
    setPendingInvitationId(invitationId)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
        method: 'DELETE'
      })
      const body = (await response.json()) as { error?: unknown }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before revoking an invitation')
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to revoke invitation')
      setInvitations((current) =>
        current.map((entry) =>
          entry.invitationId === invitationId ? { ...entry, state: 'revoked' as const } : entry
        )
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke invitation')
    } finally {
      setPendingInvitationId(null)
    }
  }

  return (
    <>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {canManage ? (
        <form className="workspace-step-up" onSubmit={(event) => void reauthenticate(event)}>
          <div>
            <strong>Verify owner access</strong>
            <p>Enter your password to enable member role and removal changes for 15 minutes.</p>
          </div>
          <label>
            <span className="sr-only">Account password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              minLength={12}
              maxLength={256}
              disabled={reauthenticating}
              required
            />
          </label>
          <button type="submit" className="quiet-button" disabled={reauthenticating}>
            {reauthenticating ? 'Verifying…' : reauthenticated ? 'Verify again' : 'Verify password'}
          </button>
        </form>
      ) : null}
      <ul className="workspace-member-list">
        {members.map((member) => {
          const isCurrentUser = member.userId === currentUserId
          const isPending = pendingUserId === member.userId
          return (
            <li key={member.userId}>
              <div>
                <strong>{member.displayName}</strong>
                <span>{member.email}</span>
              </div>
              {canManage ? (
                <div className="workspace-member-actions">
                  <label>
                    <span className="sr-only">Role for {member.displayName}</span>
                    <select
                      value={member.role}
                      disabled={isPending || !reauthenticated}
                      onChange={(event) => {
                        const parsed = workspaceRoleSchema.safeParse(event.target.value)
                        if (parsed.success) void updateRole(member.userId, parsed.data)
                      }}
                    >
                      {workspaceRoleSchema.options.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={isPending || !reauthenticated}
                    onClick={() => void removeMember(member.userId)}
                  >
                    {isCurrentUser ? 'Leave' : 'Remove'}
                  </button>
                </div>
              ) : (
                <span className="member-role">{member.role}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="member-policy">
        {canManage
          ? 'Owners can change roles or remove members. The workspace always retains an owner.'
          : 'Only workspace owners can change member access.'}
      </p>
      {canManage ? (
        <section className="workspace-invitations" aria-labelledby="invitations-heading">
          <div className="section-intro">
            <h2 id="invitations-heading">Invite existing accounts</h2>
            <p>Invitation links expire after three days.</p>
          </div>
          <form
            className="workspace-invitation-form"
            onSubmit={(event) => void createInvitation(event)}
          >
            <label>
              <span className="sr-only">Invitee email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={invitationEmail}
                onChange={(event) => setInvitationEmail(event.target.value)}
                disabled={pendingInvitationId === 'new' || !reauthenticated}
                required
              />
            </label>
            <label>
              <span className="sr-only">Invitation role</span>
              <select
                value={invitationRole}
                disabled={pendingInvitationId === 'new' || !reauthenticated}
                onChange={(event) => {
                  const parsed = workspaceInvitationRoleSchema.safeParse(event.target.value)
                  if (parsed.success) setInvitationRole(parsed.data)
                }}
              >
                {workspaceInvitationRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="quiet-button"
              type="submit"
              disabled={pendingInvitationId === 'new' || !reauthenticated}
            >
              {pendingInvitationId === 'new' ? 'Creating…' : 'Create invitation'}
            </button>
          </form>
          <ul className="workspace-member-list">
            {invitations.map((invitation) => (
              <li key={invitation.invitationId}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span>
                    {invitation.role} · {invitation.state} · expires{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                {invitation.state === 'pending' ? (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={pendingInvitationId === invitation.invitationId || !reauthenticated}
                    onClick={() => void revokeInvitation(invitation.invitationId)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="member-policy">
            Only existing AppSea accounts with the invited email can accept. Delivery is
            provider-controlled and may remain disabled.
          </p>
        </section>
      ) : null}
    </>
  )
}
