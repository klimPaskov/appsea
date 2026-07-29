'use client'

import { useState } from 'react'

type ReviewState = 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'

export function ProductionComplaintReviewActions({
  workspaceId,
  runId,
  complaintId,
  initialState
}: {
  workspaceId: string
  runId: string
  complaintId: string
  initialState: ReviewState
}) {
  const [reviewState, setReviewState] = useState<ReviewState>(initialState)
  const [pending, setPending] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function update(action: 'confirmed' | 'rejected'): Promise<void> {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/research/production/${runId}/complaints/${complaintId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action })
        }
      )
      const payload = (await response.json()) as {
        data?: { reviewState?: ReviewState }
        error?: string
      }
      if (!response.ok || !payload.data?.reviewState) {
        throw new Error(payload.error ?? 'Unable to update review state')
      }
      setReviewState(payload.data.reviewState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update review state')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="review-actions" aria-live="polite">
      <span className="review-state">Review: {reviewState}</span>
      {reviewState === 'unreviewed' ? (
        <>
          <button
            className="quiet-button"
            type="button"
            disabled={pending !== null}
            onClick={() => update('confirmed')}
          >
            {pending === 'confirmed' ? 'Confirming…' : 'Confirm complaint'}
          </button>
          <button
            className="quiet-button"
            type="button"
            disabled={pending !== null}
            onClick={() => update('rejected')}
          >
            {pending === 'rejected' ? 'Rejecting…' : 'Reject complaint'}
          </button>
        </>
      ) : reviewState === 'confirmed' ? (
        <button
          className="quiet-button"
          type="button"
          disabled={pending !== null}
          onClick={() => update('rejected')}
        >
          {pending === 'rejected' ? 'Rejecting…' : 'Reject complaint'}
        </button>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
