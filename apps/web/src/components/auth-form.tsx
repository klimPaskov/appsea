'use client'

import { useState } from 'react'

type AuthMode = 'login' | 'signup'

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    try {
      const response = await fetch(
        mfaChallengeToken
          ? '/api/auth/mfa/login'
          : `/api/auth/${mode === 'signup' ? 'signup' : 'login'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            mfaChallengeToken
              ? { challengeToken: mfaChallengeToken, code: mfaCode }
              : mode === 'signup'
                ? { email, password, displayName, workspaceName }
                : { email, password }
          )
        }
      )
      const body = (await response.json()) as {
        error?: string
        data?: { mfaRequired?: boolean; challengeToken?: string }
      }
      if (!response.ok) {
        setMessage(body.error ?? 'Unable to continue')
        return
      }
      if (body.data?.mfaRequired === true && body.data.challengeToken) {
        setMfaChallengeToken(body.data.challengeToken)
        setMfaCode('')
        setMessage('Enter the six-digit code from your authenticator app.')
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
      {mode === 'signup' && !mfaChallengeToken ? (
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
      {!mfaChallengeToken ? (
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
      ) : null}
      {!mfaChallengeToken ? (
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
      ) : null}
      {mfaChallengeToken ? (
        <label>
          Authenticator code
          <input
            autoComplete="one-time-code"
            maxLength={19}
            minLength={6}
            name="mfaCode"
            onChange={(event) => setMfaCode(event.target.value)}
            required
            value={mfaCode}
          />
          <span className="form-help">Use a recovery code if you cannot access the app.</span>
        </label>
      ) : null}
      <button disabled={pending} type="submit">
        {pending
          ? 'Working…'
          : mfaChallengeToken
            ? 'Verify code'
            : mode === 'signup'
              ? 'Create workspace'
              : 'Sign in'}
      </button>
      {mfaChallengeToken ? (
        <button
          className="quiet-button"
          disabled={pending}
          type="button"
          onClick={() => {
            setMfaChallengeToken(null)
            setMfaCode('')
            setMessage(null)
          }}
        >
          Start over
        </button>
      ) : null}
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
