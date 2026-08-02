'use client'

import { useState } from 'react'

export function ResearchCampaignRunAction({
  workspaceId,
  campaignId,
  ready
}: {
  workspaceId: string
  campaignId: string
  ready: boolean
}) {
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    setPending(true)
    setStatus(null)
    setError(null)
    const token = crypto.randomUUID().replaceAll('-', '')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns/${campaignId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: `run:${campaignId}:${token.slice(0, 24)}`,
          idempotencyKey: `campaign-run-${token}`,
          requestedAt: new Date().toISOString()
        })
      })
      const payload = (await response.json()) as {
        data?: { workflowId?: string }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to start collection')
      setStatus(`Queued ${payload.data?.workflowId ?? 'production collection'}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start collection')
    } finally {
      setPending(false)
    }
  }

  if (!ready) {
    return <p className="muted-note">Waiting for approved source policy before collection.</p>
  }

  return (
    <div className="workspace-campaign-run" aria-live="polite">
      <button className="quiet-button" type="button" disabled={pending} onClick={start}>
        {pending ? 'Queueing collection...' : 'Start collection'}
      </button>
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
