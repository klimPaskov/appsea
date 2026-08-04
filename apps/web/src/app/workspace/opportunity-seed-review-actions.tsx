'use client'

import { useState } from 'react'

type ReviewState = 'unreviewed' | 'reviewed' | 'approved' | 'withdrawn'

export function OpportunitySeedReviewActions({
  workspaceId,
  seedReviewId,
  initialState
}: {
  workspaceId: string
  seedReviewId: string
  initialState: ReviewState
}) {
  const [reviewState, setReviewState] = useState<ReviewState>(initialState)
  const [pending, setPending] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function update(action: 'reviewed' | 'approved' | 'withdrawn'): Promise<void> {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/seed-reviews/${seedReviewId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const payload = (await response.json()) as {
        data?: { reviewState?: ReviewState }
        error?: string
      }
      if (!response.ok || !payload.data?.reviewState) {
        throw new Error(payload.error ?? 'Unable to update seed review')
      }
      setReviewState(payload.data.reviewState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update seed review')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="review-actions" aria-live="polite">
      <span className="review-state">Review: {reviewState}</span>
      {reviewState === 'unreviewed' ? (
        <button
          className="quiet-button"
          type="button"
          disabled={pending !== null}
          onClick={() => update('reviewed')}
        >
          {pending === 'reviewed' ? 'Reviewing…' : 'Mark reviewed'}
        </button>
      ) : null}
      {reviewState === 'reviewed' ? (
        <button
          className="quiet-button"
          type="button"
          disabled={pending !== null}
          onClick={() => update('approved')}
        >
          {pending === 'approved' ? 'Approving…' : 'Approve for analysis'}
        </button>
      ) : null}
      {reviewState !== 'withdrawn' ? (
        <button
          className="quiet-button"
          type="button"
          disabled={pending !== null}
          onClick={() => update('withdrawn')}
        >
          {pending === 'withdrawn' ? 'Withdrawing…' : 'Withdraw'}
        </button>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}

export function OpportunitySeedReviewCreateForm({ workspaceId }: { workspaceId: string }) {
  const [seedReviewId, setSeedReviewId] = useState('seed-review-new')
  const [seedVersion, setSeedVersion] = useState('seed-v1')
  const [seedJson, setSeedJson] = useState(
    JSON.stringify(
      {
        id: 'opportunity:new',
        slug: 'new-opportunity',
        name: 'New opportunity',
        oneLine: 'A concise opportunity statement.',
        thesis: 'A human-reviewed thesis, separate from complaint evidence.',
        audience: 'The intended audience.',
        firstWedge: 'The smallest useful first wedge.',
        tags: ['reviewed-input'],
        competitors: [],
        contraryEvidence: ['Record contrary evidence before approval.'],
        scoreFactors: {
          complaintVolume: 0,
          painSeverity: 0,
          recurrence: 0,
          willingnessToPay: 0,
          competitiveGap: 0,
          buildFeasibility: 0,
          evidenceQuality: 0,
          contraryEvidencePenalty: 0
        },
        planFiles: [
          'README.md',
          '01-product-brief.md',
          '02-mvp-scope.md',
          '03-architecture.md',
          '04-task-graph.json',
          '05-validation.md'
        ]
      },
      null,
      2
    )
  )
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function create(): Promise<void> {
    setStatus(null)
    setError(null)
    let seed: unknown
    try {
      seed = JSON.parse(seedJson) as unknown
    } catch {
      setError('Seed JSON must be valid JSON')
      return
    }
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/seed-reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seedReviewId, seedVersion, seed })
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create seed review')
      setStatus('Saved as unreviewed. Mark it reviewed, then have an owner approve it.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create seed review')
    }
  }

  return (
    <div className="seed-review-create">
      <div className="workspace-seed-form-grid">
        <label>
          Seed review ID
          <input value={seedReviewId} onChange={(event) => setSeedReviewId(event.target.value)} />
        </label>
        <label>
          Seed version
          <input value={seedVersion} onChange={(event) => setSeedVersion(event.target.value)} />
        </label>
      </div>
      <label className="seed-json-label">
        Reviewed seed JSON
        <textarea
          value={seedJson}
          onChange={(event) => setSeedJson(event.target.value)}
          rows={18}
        />
      </label>
      <button className="quiet-button" type="button" onClick={create}>
        Save seed review
      </button>
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
