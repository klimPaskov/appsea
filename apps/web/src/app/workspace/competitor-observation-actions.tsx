'use client'

import { useState } from 'react'

type ReviewState = 'unreviewed' | 'confirmed' | 'rejected'

export function CompetitorObservationActions({
  workspaceId,
  slug,
  observationId,
  initialState
}: {
  workspaceId: string
  slug: string
  observationId: string
  initialState: ReviewState
}) {
  const [reviewState, setReviewState] = useState<ReviewState>(initialState)
  const [pending, setPending] = useState<'confirmed' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function update(action: 'confirmed' | 'rejected'): Promise<void> {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/opportunities/${slug}/competitor-observations/${observationId}`,
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
        throw new Error(payload.error ?? 'Unable to update competitor observation')
      }
      setReviewState(payload.data.reviewState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update competitor observation')
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
            {pending === 'confirmed' ? 'Confirming…' : 'Confirm claim'}
          </button>
          <button
            className="quiet-button"
            type="button"
            disabled={pending !== null}
            onClick={() => update('rejected')}
          >
            {pending === 'rejected' ? 'Rejecting…' : 'Reject claim'}
          </button>
        </>
      ) : null}
      {reviewState === 'confirmed' ? (
        <button
          className="quiet-button"
          type="button"
          disabled={pending !== null}
          onClick={() => update('rejected')}
        >
          {pending === 'rejected' ? 'Rejecting…' : 'Reject claim'}
        </button>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
