'use client'

import { useState } from 'react'

export function ResearchCampaignOrchestrationCancelAction({
  workspaceId,
  campaignId,
  orchestrationId,
  canCancel,
  cancellationRequestedAt,
  terminal
}: {
  workspaceId: string
  campaignId: string
  orchestrationId: string
  canCancel: boolean
  cancellationRequestedAt: string | null
  terminal: boolean
}) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (terminal) return null
  if (cancellationRequestedAt) {
    return (
      <p className="muted-note">
        Cancellation requested; active source workflows will stop at a safe boundary.
      </p>
    )
  }
  if (!canCancel) return null

  async function requestCancellation(): Promise<void> {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/campaigns/${campaignId}/orchestrations/${orchestrationId}`,
        { method: 'POST' }
      )
      const payload = (await response.json()) as {
        data?: { state?: string }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to request cancellation')
      setMessage(
        payload.data?.state === 'already_terminal'
          ? 'This orchestration has already finished.'
          : 'Cancellation requested. The worker will finish the safe stop.'
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to request cancellation')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="workspace-campaign-run" aria-live="polite">
      <button
        className="quiet-button"
        type="button"
        disabled={pending}
        onClick={requestCancellation}
      >
        {pending ? 'Requesting cancellation...' : 'Cancel collection'}
      </button>
      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
