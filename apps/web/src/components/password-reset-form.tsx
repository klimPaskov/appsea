'use client'

import { useEffect, useState } from 'react'

export function PasswordResetForm() {
  const [token, setToken] = useState('')
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    const value = new URLSearchParams(hash).get('token') ?? ''
    setToken(value)
    // The fragment is not sent to the server, but remove it before any
    // navigation, screenshots, or browser history snapshots can retain it.
    window.history.replaceState({}, document.title, '/reset-password')
    setReady(true)
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    if (password !== confirmation) {
      setMessage('Passwords do not match')
      return
    }
    setPending(true)
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setMessage(body.error ?? 'Password reset is temporarily unavailable')
        return
      }
      setCompleted(true)
    } catch {
      setMessage('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  if (!ready) {
    return <p className="auth-intro">Preparing the secure reset form…</p>
  }

  if (!token) {
    return <p className="form-error">This password reset link is missing its token.</p>
  }

  if (completed) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-intro">
          Your password was updated and existing sessions were signed out.
        </p>
        <a className="quiet-button" href="/login">
          Return to sign in
        </a>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        New password
        <input
          autoComplete="new-password"
          minLength={12}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <label>
        Confirm password
        <input
          autoComplete="new-password"
          minLength={12}
          name="confirmation"
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? 'Updating…' : 'Update password'}
      </button>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
