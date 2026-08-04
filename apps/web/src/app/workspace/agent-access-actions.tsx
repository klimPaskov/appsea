'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type {
  AgentAccessTokenCreateResult,
  AgentAccessTokenReadModel,
  AgentAccessTokenScope
} from '@appsea/contracts'

const scopeOptions: ReadonlyArray<{
  value: AgentAccessTokenScope
  label: string
  description: string
}> = [
  {
    value: 'opportunities:read',
    label: 'Opportunities',
    description: 'Search and inspect private opportunity summaries.'
  },
  {
    value: 'evidence:read',
    label: 'Evidence',
    description: 'Read policy-bounded evidence references and coverage gaps.'
  },
  {
    value: 'reports:read',
    label: 'Reports',
    description: 'Read approved reports or labelled synthetic reports.'
  },
  {
    value: 'plans:read',
    label: 'Plan packages',
    description: 'Read ready, approved coding-agent packages.'
  },
  {
    value: 'sources:read',
    label: 'Source coverage',
    description: 'Read source-policy readiness, quotas, and coverage gaps.'
  }
]

function formatTimestamp(value: string | null): string {
  if (!value) return 'Never'
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime())
    ? 'Unavailable'
    : timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function scopeLabel(scope: AgentAccessTokenScope): string {
  return scopeOptions.find((option) => option.value === scope)?.label ?? scope
}

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: unknown }).error === 'string'
  ) {
    return (payload as { error: string }).error
  }
  return fallback
}

export function AgentAccessActions({ workspaceId }: { workspaceId: string }) {
  const [tokens, setTokens] = useState<AgentAccessTokenReadModel[] | null>(null)
  const [label, setLabel] = useState('')
  const [scopes, setScopes] = useState<AgentAccessTokenScope[]>(['opportunities:read'])
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [issued, setIssued] = useState<AgentAccessTokenCreateResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setError(null)
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-tokens`,
          {
            cache: 'no-store'
          }
        )
        const payload = (await response.json()) as {
          data?: AgentAccessTokenReadModel[]
          error?: string
        }
        if (!response.ok || !payload.data) {
          throw new Error(errorMessage(payload, 'Unable to read agent access tokens'))
        }
        if (!cancelled) setTokens(payload.data)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to read agent access tokens')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  function toggleScope(scope: AgentAccessTokenScope): void {
    setScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]
    )
  }

  async function createToken(): Promise<void> {
    if (!label.trim()) {
      setError('Give the token a recognizable label before creating it.')
      return
    }
    if (scopes.length === 0) {
      setError('Choose at least one read scope.')
      return
    }
    setPending(true)
    setStatus(null)
    setError(null)
    setIssued(null)
    setCopied(false)
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-tokens`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: label.trim(),
            scopes,
            expiresInDays: Number(expiresInDays)
          })
        }
      )
      const payload = (await response.json()) as {
        data?: AgentAccessTokenCreateResult
        error?: string
      }
      if (!response.ok || !payload.data) {
        throw new Error(
          errorMessage(
            payload,
            response.status === 428
              ? 'Recent password and MFA verification are required. Open Account security and try again.'
              : 'Unable to create the agent access token'
          )
        )
      }
      setIssued(payload.data)
      setLabel('')
      setStatus('Token created. It is shown once; copy it into the agent secret store now.')
      const refresh = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-tokens`,
        { cache: 'no-store' }
      )
      const refreshed = (await refresh.json()) as { data?: AgentAccessTokenReadModel[] }
      if (refresh.ok && refreshed.data) setTokens(refreshed.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the agent access token')
    } finally {
      setPending(false)
    }
  }

  async function revokeToken(token: AgentAccessTokenReadModel): Promise<void> {
    if (token.revokedAt) return
    if (!window.confirm(`Revoke the ${token.label} token? Existing agent requests will stop.`))
      return
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-tokens/${encodeURIComponent(token.tokenId)}`,
        { method: 'DELETE' }
      )
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(
          errorMessage(
            payload,
            response.status === 428
              ? 'Recent password and MFA verification are required. Open Account security and try again.'
              : 'Unable to revoke the agent access token'
          )
        )
      }
      setStatus(`Revoked ${token.label}.`)
      setTokens(
        (current) =>
          current?.map((candidate) =>
            candidate.tokenId === token.tokenId
              ? { ...candidate, revokedAt: new Date().toISOString() }
              : candidate
          ) ?? current
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke the agent access token')
    } finally {
      setPending(false)
    }
  }

  async function copyIssuedToken(): Promise<void> {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
      setStatus('Token copied. Store it in the agent secret store and do not commit it.')
    } catch {
      setError('The browser could not copy the token. Select the value and copy it manually.')
    }
  }

  return (
    <div className="agent-access-actions" aria-live="polite">
      <section
        className="workspace-section agent-access-panel"
        aria-labelledby="agent-access-create"
      >
        <div className="section-intro">
          <h2 id="agent-access-create">Create a read-only token</h2>
          <p>
            Tokens are workspace-scoped and expire within 90 days. They can read through{' '}
            <code>/api/mcp</code>; they cannot start research, change policies, or write data.
          </p>
        </div>
        <div className="agent-access-form">
          <label>
            Token label
            <input
              value={label}
              maxLength={120}
              disabled={pending}
              placeholder="Build agent"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            Expires in
            <select
              value={expiresInDays}
              disabled={pending}
              onChange={(event) => setExpiresInDays(event.target.value)}
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <fieldset className="agent-access-scope-fieldset">
            <legend>Read scopes</legend>
            <div className="agent-access-scope-list">
              {scopeOptions.map((option) => (
                <label key={option.value} className="agent-access-scope-option">
                  <input
                    type="checkbox"
                    checked={scopes.includes(option.value)}
                    disabled={pending}
                    onChange={() => toggleScope(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="quiet-button"
            type="button"
            disabled={pending}
            onClick={() => void createToken()}
          >
            {pending ? 'Working…' : 'Create token'}
          </button>
          <p className="muted-note">
            Creation and revocation require recent password reauthentication and, when enabled, MFA.{' '}
            <Link href="/account/security">Open account security</Link> if the action is blocked.
          </p>
        </div>
      </section>

      {issued ? (
        <section className="agent-access-issued" aria-labelledby="agent-access-issued-heading">
          <div className="section-intro">
            <h2 id="agent-access-issued-heading">Copy this token now</h2>
            <p>AppSea will not show the raw credential again after you leave this page.</p>
          </div>
          <code className="agent-access-token-value">{issued.token}</code>
          <div className="agent-access-issued-actions">
            <button className="quiet-button" type="button" onClick={() => void copyIssuedToken()}>
              {copied ? 'Copied' : 'Copy token'}
            </button>
            <span className="muted-note">
              {issued.scopes.map(scopeLabel).join(' · ')} · expires{' '}
              {formatTimestamp(issued.expiresAt)}
            </span>
          </div>
        </section>
      ) : null}

      <section className="workspace-section" aria-labelledby="agent-access-existing">
        <div className="section-intro">
          <h2 id="agent-access-existing">Issued tokens</h2>
          <p>Only token metadata is retained here. Raw credentials are never listed.</p>
        </div>
        {tokens === null ? (
          <p className="empty-state">Loading token metadata…</p>
        ) : tokens.length === 0 ? (
          <p className="empty-state">No agent access tokens have been issued.</p>
        ) : (
          <ul className="agent-access-token-list">
            {tokens.map((token) => (
              <li key={token.tokenId} className="agent-access-token-row">
                <div className="agent-access-token-main">
                  <strong>{token.label}</strong>
                  <span className="complaint-meta">
                    <span>{token.tokenId}</span>
                    <span>{token.revokedAt ? 'Revoked' : 'Active'}</span>
                  </span>
                </div>
                <dl className="agent-access-token-meta">
                  <div>
                    <dt>Scopes</dt>
                    <dd>{token.scopes.map(scopeLabel).join(' · ')}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{formatTimestamp(token.expiresAt)}</dd>
                  </div>
                  <div>
                    <dt>Last used</dt>
                    <dd>{formatTimestamp(token.lastUsedAt)}</dd>
                  </div>
                </dl>
                {!token.revokedAt ? (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void revokeToken(token)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}

export { scopeOptions, formatTimestamp }
