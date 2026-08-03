'use client'

import { useState, type FormEvent } from 'react'
import type { AuthExternalIdentityReadModel } from '@appsea/contracts'

type AccountExternalIdentitiesPanelProps = {
  initialIdentities: AuthExternalIdentityReadModel[]
  oidcConfigured: boolean
  mfaEnabled: boolean
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').replace('.000Z', ' UTC')
}

export function AccountExternalIdentitiesPanel({
  initialIdentities,
  oidcConfigured,
  mfaEnabled
}: AccountExternalIdentitiesPanelProps) {
  const [identities, setIdentities] = useState(initialIdentities)
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [stepUpReady, setStepUpReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function responseBody(response: Response): Promise<{ error?: unknown }> {
    return (await response.json()) as { error?: unknown }
  }

  async function prepareStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const reauth = await fetch('/api/auth/reauthenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const reauthBody = await responseBody(reauth)
      if (!reauth.ok) {
        setError(
          typeof reauthBody.error === 'string' ? reauthBody.error : 'Unable to verify password'
        )
        setStepUpReady(false)
        return
      }
      if (mfaEnabled) {
        const mfa = await fetch('/api/auth/mfa/step-up', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: mfaCode })
        })
        const mfaBody = await responseBody(mfa)
        if (!mfa.ok) {
          setError(typeof mfaBody.error === 'string' ? mfaBody.error : 'Unable to verify MFA')
          setStepUpReady(false)
          return
        }
      }
      setStepUpReady(true)
      setMessage('Identity changes are enabled for the next 15 minutes.')
    } catch {
      setError('The service is unavailable. Try again shortly.')
      setStepUpReady(false)
    } finally {
      setPassword('')
      setMfaCode('')
      setPending(false)
    }
  }

  async function unlink(identity: AuthExternalIdentityReadModel) {
    if (!stepUpReady || !window.confirm(`Unlink the ${identity.issuerHost} identity?`)) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/auth/oidc/identities/${encodeURIComponent(identity.identityId)}`,
        { method: 'DELETE' }
      )
      const body = await responseBody(response)
      if (!response.ok) {
        if (response.status === 428) setStepUpReady(false)
        setError(typeof body.error === 'string' ? body.error : 'Unable to unlink identity')
        return
      }
      setIdentities((current) =>
        current.filter((entry) => entry.identityId !== identity.identityId)
      )
      setMessage('The external identity was unlinked.')
    } catch {
      setError('The service is unavailable. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="workspace-section" aria-labelledby="external-identities-heading">
      <div className="section-intro">
        <h2 id="external-identities-heading">External identity</h2>
        <p>
          Link a verified provider identity only after completing the password and MFA step-up.
          Email addresses never link accounts automatically.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="member-policy">{message}</p> : null}
      {identities.length > 0 ? (
        <ul className="account-session-list">
          {identities.map((identity) => (
            <li key={identity.identityId}>
              <div className="account-session-main">
                <strong>{identity.provider.toUpperCase()} identity</strong>
                <span className="account-session-id">{identity.issuerHost}</span>
              </div>
              <dl className="account-session-meta">
                <div>
                  <dt>Verified email</dt>
                  <dd>{identity.email}</dd>
                </div>
                <div>
                  <dt>Linked</dt>
                  <dd>{formatTimestamp(identity.linkedAt)}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>
                    {identity.lastAuthenticatedAt
                      ? formatTimestamp(identity.lastAuthenticatedAt)
                      : 'Not used yet'}
                  </dd>
                </div>
              </dl>
              <button
                className="quiet-button"
                disabled={!stepUpReady || pending}
                onClick={() => void unlink(identity)}
                type="button"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">No external identity is linked.</p>
      )}
      <form
        className="workspace-step-up"
        id="external-identity-step-up"
        onSubmit={(event) => void prepareStepUp(event)}
      >
        <div>
          <strong>Verify before changing identities</strong>
          <p>
            Enter your password{mfaEnabled ? ' and a current MFA code' : ''} to enable linking or
            unlinking.
          </p>
        </div>
        <label>
          <span className="sr-only">Account password</span>
          <input
            autoComplete="current-password"
            disabled={pending}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
        </label>
        {mfaEnabled ? (
          <label>
            <span className="sr-only">MFA code</span>
            <input
              autoComplete="one-time-code"
              disabled={pending}
              maxLength={19}
              minLength={6}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="Authenticator or recovery code"
              required
              value={mfaCode}
            />
          </label>
        ) : null}
        <button className="quiet-button" disabled={pending} type="submit">
          {pending ? 'Verifying…' : stepUpReady ? 'Verify again' : 'Verify identity changes'}
        </button>
      </form>
      {oidcConfigured ? (
        <form action="/api/auth/oidc/start" method="post">
          <button className="quiet-button" disabled={!stepUpReady || pending} type="submit">
            {identities.length > 0 ? 'Link another identity' : 'Link identity provider'}
          </button>
        </form>
      ) : (
        <p className="member-policy">
          Provider identity linking is disabled until a reviewed OIDC deployment is configured.
        </p>
      )}
    </section>
  )
}
