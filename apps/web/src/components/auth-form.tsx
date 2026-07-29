'use client'

import { useState } from 'react'

type AuthMode = 'login' | 'signup'

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'signup' ? { email, password, displayName, workspaceName } : { email, password }
        )
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setMessage(body.error ?? 'Unable to continue')
        return
      }
      window.location.assign('/workspace')
    } catch {
      setMessage('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === 'signup' ? (
        <>
          <label>
            Name
            <input
              autoComplete="name"
              name="displayName"
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
          <label>
            Workspace name
            <input
              autoComplete="organization"
              name="workspaceName"
              onChange={(event) => setWorkspaceName(event.target.value)}
              required
              value={workspaceName}
            />
          </label>
        </>
      ) : null}
      <label>
        Email
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          minLength={12}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? 'Working…' : mode === 'signup' ? 'Create workspace' : 'Sign in'}
      </button>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
