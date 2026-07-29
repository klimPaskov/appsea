'use client'

import { useState, type FormEvent } from 'react'

export function AccountClosurePanel() {
  const [password, setPassword] = useState('')
  const [reauthenticated, setReauthenticated] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blockingWorkspaceIds, setBlockingWorkspaceIds] = useState<string[]>([])

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
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
      setPending(false)
    }
  }

  async function closeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reauthenticated) return
    setPending(true)
    setError(null)
    setBlockingWorkspaceIds([])
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation })
      })
      const body = (await response.json()) as {
        error?: unknown
        blockingWorkspaceIds?: unknown
      }
      if (response.status === 428) {
        setReauthenticated(false)
        throw new Error('Verify your password before closing the account')
      }
      if (response.status === 409) {
        const ids = Array.isArray(body.blockingWorkspaceIds)
          ? body.blockingWorkspaceIds.filter((value): value is string => typeof value === 'string')
          : []
        setBlockingWorkspaceIds(ids)
      }
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : 'Unable to close the account')
      window.location.assign('/login?closed=1')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to close the account')
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className="workspace-section account-closure-section"
      aria-labelledby="close-account-heading"
    >
      <div className="section-intro">
        <h2 id="close-account-heading">Close account</h2>
        <p>
          Closing removes your sign-in, sessions, password-recovery material, and profile details.
          Workspace research is retained for other members and its provenance is not rewritten.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {blockingWorkspaceIds.length > 0 ? (
        <div className="member-policy" role="status">
          <p>Transfer ownership before closing. You still own:</p>
          <ul>
            {blockingWorkspaceIds.map((workspaceId) => (
              <li key={workspaceId}>
                <a href={`/workspace/${encodeURIComponent(workspaceId)}/members`}>{workspaceId}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!reauthenticated ? (
        <form className="workspace-step-up" onSubmit={(event) => void reauthenticate(event)}>
          <div>
            <strong>Verify before closing</strong>
            <p>Enter your password to enable account closure for 15 minutes.</p>
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
              disabled={pending}
              required
            />
          </label>
          <button type="submit" className="quiet-button" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify password'}
          </button>
        </form>
      ) : (
        <form className="workspace-step-up" onSubmit={(event) => void closeAccount(event)}>
          <div>
            <strong>Type DELETE MY ACCOUNT to continue</strong>
            <p>This action cannot restore the closed profile or sessions.</p>
          </div>
          <label>
            <span className="sr-only">Closure confirmation</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE MY ACCOUNT"
              autoComplete="off"
              disabled={pending}
              required
            />
          </label>
          <button type="submit" className="quiet-button" disabled={pending}>
            {pending ? 'Closing…' : 'Close account'}
          </button>
        </form>
      )}
      <p className="member-policy">
        Account closure is blocked until every owned workspace has another owner. This protects
        private research from becoming ownerless.
      </p>
    </section>
  )
}
