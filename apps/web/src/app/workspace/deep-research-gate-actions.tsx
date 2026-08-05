'use client'

import { useState } from 'react'

type GateStatus = 'not-ready' | 'passed' | 'stale' | 'withdrawn'

export function DeepResearchGateActions({
  workspaceId,
  slug,
  role,
  initialStatus
}: {
  workspaceId: string
  slug: string
  role: 'owner' | 'editor' | 'viewer'
  initialStatus: GateStatus
}) {
  const [status, setStatus] = useState<GateStatus>(initialStatus)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function withdraw(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/opportunities/${slug}/research-gate`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'withdraw' })
        }
      )
      const payload = (await response.json()) as { data?: { status?: GateStatus }; error?: string }
      if (!response.ok || !payload.data?.status) {
        throw new Error(payload.error ?? 'Unable to withdraw the research gate')
      }
      setStatus(payload.data.status)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to withdraw the research gate')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="review-actions" aria-live="polite">
      <span className="review-state">Current gate: {status}</span>
      {status === 'passed' && role === 'owner' ? (
        <button className="quiet-button" type="button" disabled={pending} onClick={withdraw}>
          {pending ? 'Withdrawing…' : 'Withdraw promotion'}
        </button>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
