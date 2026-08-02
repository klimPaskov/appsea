'use client'

import { useState } from 'react'

export function ProductionWorkflowCancelAction({
  workspaceId,
  workflowId,
  state,
  cancellationRequestedAt
}: {
  workspaceId: string
  workflowId: string
  state: string
  cancellationRequestedAt: string | null
}) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (['completed', 'failed', 'canceled', 'budget_rejected'].includes(state)) return null
  if (cancellationRequestedAt || message) {
    return (
      <p className="muted-note" aria-live="polite">
        {message ?? 'Cancellation requested; waiting for the durable workflow boundary.'}
      </p>
    )
  }

  async function cancel(): Promise<void> {
    if (!window.confirm('Cancel this production collection?')) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/research/production/workflow/${workflowId}`,
        { method: 'POST' }
      )
      const payload = (await response.json()) as {
        data?: { state?: string }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to cancel collection')
      setMessage(
        payload.data?.state === 'already_terminal'
          ? 'The collection had already reached a terminal state.'
          : 'Cancellation requested; waiting for the durable workflow boundary.'
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to cancel collection')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="workspace-actions" aria-live="polite">
      <button className="quiet-button" type="button" disabled={pending} onClick={cancel}>
        {pending ? 'Requesting cancellation...' : 'Cancel collection'}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
