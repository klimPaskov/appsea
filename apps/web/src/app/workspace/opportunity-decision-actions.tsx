'use client'

import { useState } from 'react'
import type {
  WorkspaceOpportunityDecisionReadModel,
  WorkspaceOpportunityState
} from '@appsea/contracts'

type Decision = WorkspaceOpportunityDecisionReadModel['decision']

const labels: Record<Decision, string> = {
  approve: 'Approve',
  watch: 'Watch',
  reject: 'Reject',
  archive: 'Archive'
}

function stateLabel(state: WorkspaceOpportunityState): string {
  return state.replace('-', ' ')
}

export function OpportunityDecisionActions({
  workspaceId,
  slug,
  role,
  synthetic,
  initialState,
  initialHistory
}: {
  workspaceId: string
  slug: string
  role: 'owner' | 'editor' | 'viewer'
  synthetic: boolean
  initialState: WorkspaceOpportunityState
  initialHistory: WorkspaceOpportunityDecisionReadModel[]
}) {
  const [currentState, setCurrentState] = useState(initialState)
  const [history, setHistory] = useState(initialHistory)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canMutate = role === 'owner' || role === 'editor'
  const active = currentState !== 'archived'
  const canWatch = active && currentState !== 'monitoring'
  const canApprove = active && currentState === 'planned'

  async function submit(decision: Decision): Promise<void> {
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setError('Record why this decision was made.')
      return
    }
    if (decision === 'archive' && !window.confirm('Archive this opportunity?')) return
    setPending(decision)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/opportunities/${encodeURIComponent(slug)}/decisions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID()
          },
          body: JSON.stringify({
            decision,
            reason: trimmedReason,
            expectedState: currentState
          })
        }
      )
      const payload = (await response.json()) as {
        data?: WorkspaceOpportunityDecisionReadModel
        error?: string
      }
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? 'Unable to record the opportunity decision')
      }
      setHistory((current) => [payload.data!, ...current])
      setCurrentState(payload.data.nextState)
      setReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record the opportunity decision')
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="opportunity-decision-panel" aria-labelledby="decision-heading">
      <div className="section-intro">
        <div>
          <p className="eyebrow">Workspace governance</p>
          <h2 id="decision-heading">Decision record</h2>
        </div>
        <p>Current lifecycle: {stateLabel(currentState)}</p>
      </div>

      {synthetic ? (
        <p className="decision-note">
          Fixture opportunities are read-only. Synthetic rankings are not market research.
        </p>
      ) : canMutate && active ? (
        <div className="opportunity-decision-form">
          <label htmlFor="opportunity-decision-reason">Reason</label>
          <textarea
            id="opportunity-decision-reason"
            rows={3}
            maxLength={2_000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What evidence or constraint led to this decision?"
          />
          <div className="review-actions">
            {canApprove ? (
              <button
                className="quiet-button"
                type="button"
                disabled={pending !== null}
                onClick={() => submit('approve')}
              >
                {pending === 'approve' ? 'Recording...' : labels.approve}
              </button>
            ) : null}
            {canWatch ? (
              <button
                className="quiet-button"
                type="button"
                disabled={pending !== null}
                onClick={() => submit('watch')}
              >
                {pending === 'watch' ? 'Recording...' : labels.watch}
              </button>
            ) : null}
            <button
              className="quiet-button"
              type="button"
              disabled={pending !== null}
              onClick={() => submit('reject')}
            >
              {pending === 'reject' ? 'Recording...' : labels.reject}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={pending !== null}
              onClick={() => submit('archive')}
            >
              {pending === 'archive' ? 'Recording...' : labels.archive}
            </button>
          </div>
        </div>
      ) : (
        <p className="decision-note">
          {currentState === 'archived'
            ? 'Archived opportunities cannot be reopened from this workspace.'
            : 'Editors and owners can record lifecycle decisions after step-up verification.'}
        </p>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {history.length > 0 ? (
        <ol className="decision-history">
          {history.slice(0, 8).map((entry) => (
            <li key={entry.decisionId}>
              <div>
                <strong>{labels[entry.decision]}</strong>
                <span>
                  {stateLabel(entry.previousState)} to {stateLabel(entry.nextState)}
                </span>
              </div>
              <p>{entry.reason}</p>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()} · {entry.actorId}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="decision-note">No lifecycle decisions have been recorded.</p>
      )}
    </section>
  )
}
