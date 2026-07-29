'use client'

import { useEffect, useState } from 'react'
import { workspaceInvitationAcceptedReadModelSchema } from '@appsea/contracts'

export function InvitationAcceptanceForm() {
  const [token, setToken] = useState('')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<{ workspaceId: string; role: string } | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    const value = new URLSearchParams(hash).get('token') ?? ''
    setToken(value)
    window.history.replaceState({}, document.title, '/invite')
    setReady(true)
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    setPending(true)
    try {
      const response = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
      })
      const body = (await response.json()) as { data?: unknown; error?: unknown }
      if (!response.ok) {
        setMessage(typeof body.error === 'string' ? body.error : 'Unable to accept invitation')
        return
      }
      const result = workspaceInvitationAcceptedReadModelSchema.parse(body.data)
      setAccepted({ workspaceId: result.workspaceId, role: result.role })
    } catch {
      setMessage('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  if (!ready) return <p className="auth-intro">Preparing the secure invitation form…</p>
  if (!token) return <p className="form-error">This invitation link is missing its token.</p>
  if (accepted) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-intro">You joined the workspace as a {accepted.role}.</p>
        <a className="quiet-button" href={`/workspace/${accepted.workspaceId}`}>
          Open workspace
        </a>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="auth-intro">The invitation will add this account to the private workspace.</p>
      <button disabled={pending} type="submit">
        {pending ? 'Joining…' : 'Accept invitation'}
      </button>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
