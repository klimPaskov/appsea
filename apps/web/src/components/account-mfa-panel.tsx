'use client'

import { useState, type FormEvent } from 'react'
import type { AuthMfaEnrollmentReadModel, AuthMfaStatusReadModel } from '@appsea/contracts'

type AccountMfaPanelProps = {
  initialStatus: AuthMfaStatusReadModel
}

async function responseBody(response: Response): Promise<{ error?: unknown; data?: unknown }> {
  return (await response.json()) as { error?: unknown; data?: unknown }
}

export function AccountMfaPanel({ initialStatus }: AccountMfaPanelProps) {
  const [status, setStatus] = useState(initialStatus)
  const [enrollment, setEnrollment] = useState<AuthMfaEnrollmentReadModel | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function reauthenticate(): Promise<boolean> {
    const response = await fetch('/api/auth/reauthenticate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    })
    const body = await responseBody(response)
    if (!response.ok) {
      setError(typeof body.error === 'string' ? body.error : 'Unable to verify password')
      return false
    }
    setPassword('')
    return true
  }

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      if (!(await reauthenticate())) return
      const response = await fetch('/api/auth/mfa/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      const body = await responseBody(response)
      if (!response.ok || !body.data) {
        setError(typeof body.error === 'string' ? body.error : 'Unable to begin MFA enrollment')
        return
      }
      setEnrollment(body.data as AuthMfaEnrollmentReadModel)
      setMessage('Add the account to your authenticator app, then confirm with its six-digit code.')
    } catch {
      setError('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/mfa/enroll/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const body = await responseBody(response)
      if (!response.ok || !body.data) {
        setError(typeof body.error === 'string' ? body.error : 'Unable to confirm MFA enrollment')
        return
      }
      setStatus(body.data as AuthMfaStatusReadModel)
      setEnrollment(null)
      setCode('')
      setMessage('MFA is enabled. Store the recovery codes somewhere safe.')
    } catch {
      setError('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      if (!(await reauthenticate())) return
      const response = await fetch('/api/auth/mfa', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const body = await responseBody(response)
      if (!response.ok || !body.data) {
        setError(typeof body.error === 'string' ? body.error : 'Unable to disable MFA')
        return
      }
      setStatus(body.data as AuthMfaStatusReadModel)
      setCode('')
      setMessage('MFA is disabled for this account.')
    } catch {
      setError('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="workspace-section account-mfa-panel" aria-labelledby="mfa-heading">
      <div className="section-intro">
        <h2 id="mfa-heading">Multi-factor authentication</h2>
        <p>
          {status.enabled
            ? `Enabled with ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} remaining.`
            : 'Protect sign-in with a time-based authenticator code.'}
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="member-policy">{message}</p> : null}
      {enrollment ? (
        <div className="account-mfa-enrollment">
          <p className="member-policy">
            This secret and these recovery codes are shown only during enrollment. Do not paste them
            into a ticket or commit them to source control.
          </p>
          <dl className="account-mfa-details">
            <div>
              <dt>Manual setup key</dt>
              <dd>
                <code>{enrollment.secret}</code>
              </dd>
            </div>
            <div>
              <dt>Provisioning URI</dt>
              <dd className="account-mfa-uri">
                <code>{enrollment.otpauthUri}</code>
              </dd>
            </div>
          </dl>
          <div className="account-mfa-recovery" aria-labelledby="recovery-codes-heading">
            <strong id="recovery-codes-heading">Recovery codes</strong>
            <ul>
              {enrollment.recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>
                  <code>{recoveryCode}</code>
                </li>
              ))}
            </ul>
          </div>
          <form className="workspace-step-up" onSubmit={(event) => void confirmEnrollment(event)}>
            <label>
              <span>Authenticator code</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
            <button className="quiet-button" disabled={pending} type="submit">
              {pending ? 'Confirming…' : 'Confirm MFA'}
            </button>
          </form>
        </div>
      ) : status.enabled ? (
        <form className="workspace-step-up" onSubmit={(event) => void disable(event)}>
          <div>
            <strong>Disable MFA</strong>
            <p>Verify your password and a current authenticator or recovery code.</p>
          </div>
          <label>
            <span className="sr-only">Account password</span>
            <input
              autoComplete="current-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
          </label>
          <label>
            <span className="sr-only">MFA code</span>
            <input
              autoComplete="one-time-code"
              maxLength={19}
              minLength={6}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Authenticator or recovery code"
              required
              value={code}
            />
          </label>
          <button className="quiet-button" disabled={pending} type="submit">
            {pending ? 'Disabling…' : 'Disable MFA'}
          </button>
        </form>
      ) : (
        <form className="workspace-step-up" onSubmit={(event) => void beginEnrollment(event)}>
          <div>
            <strong>Enable MFA</strong>
            <p>Enter your password to start an enrollment that requires a second confirmation.</p>
          </div>
          <label>
            <span className="sr-only">Account password</span>
            <input
              autoComplete="current-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
          </label>
          <button className="quiet-button" disabled={pending} type="submit">
            {pending ? 'Starting…' : 'Set up MFA'}
          </button>
        </form>
      )}
    </section>
  )
}
