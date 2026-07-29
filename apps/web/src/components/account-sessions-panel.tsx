'use client'

import { useState, type FormEvent } from 'react'
import type { AuthSessionSummaryReadModel } from '@appsea/contracts'

type AccountSessionsPanelProps = {
  initialSessions: AuthSessionSummaryReadModel[]
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').replace('.000Z', ' UTC')
}

export function AccountSessionsPanel({ initialSessions }: AccountSessionsPanelProps) {
  const [sessions, setSessions] = useState(initialSessions)
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [reauthenticated, setReauthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [reauthenticating, setReauthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function revokeSession(session: AuthSessionSummaryReadModel) {
    if (!reauthenticated || session.current) return
    if (!window.confirm('Revoke this session? It will be signed out on its next request.')) return
    setPendingSessionId(session.id)
    setError(null)
    try {
      const response = await fetch(`/api/auth/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE'
      })
      const body = (await response.json()) as { error?: unknown }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before revoking a session')
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to revoke session')
      setSessions((current) => current.filter((entry) => entry.id !== session.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke session')
    } finally {
      setPendingSessionId(null)
    }
  }

  return (
    <>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="workspace-step-up account-security-step-up"
        onSubmit={(event) => void reauthenticate(event)}
      >
        <div>
          <strong>Verify before revoking access</strong>
          <p>Enter your password to enable session revocation for 15 minutes.</p>
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
      <ul className="account-session-list">
        {sessions.map((session) => {
          const isPending = pendingSessionId === session.id
          return (
            <li key={session.id}>
              <div className="account-session-main">
                <strong>{session.current ? 'Current session' : 'AppSea session'}</strong>
                <span className="account-session-id">{session.id}</span>
              </div>
              <dl className="account-session-meta">
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(session.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{formatTimestamp(session.lastSeenAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{formatTimestamp(session.expiresAt)}</dd>
                </div>
              </dl>
              {session.current ? (
                <span className="account-session-current">This device</span>
              ) : (
                <button
                  className="quiet-button"
                  type="button"
                  aria-label={`Revoke ${session.id}`}
                  disabled={!reauthenticated || isPending}
                  onClick={() => void revokeSession(session)}
                >
                  {isPending ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="member-policy">
        Session identifiers are shown for review only. AppSea never displays session tokens or
        password material.
      </p>
      {sessions.length === 0 ? <p className="empty-state">No active sessions remain.</p> : null}
    </>
  )
}
