'use client'

import type { ComplaintAnalysis, EvidenceRedactionField } from '@appsea/contracts'
import { useState } from 'react'
import { ComplaintCorrectionForm } from './complaint-correction-form'
import { EvidenceRedactionActions } from './evidence-redaction-actions'

type ReviewState = 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'

export function ProductionComplaintReviewActions({
  workspaceId,
  runId,
  complaintId,
  evidenceId,
  redactedFields,
  canRedact,
  initialState,
  analysis
}: {
  workspaceId: string
  runId: string
  complaintId: string
  evidenceId: string
  redactedFields?: readonly EvidenceRedactionField[] | undefined
  canRedact: boolean
  initialState: ReviewState
  analysis?: ComplaintAnalysis
}) {
  const [reviewState, setReviewState] = useState<ReviewState>(initialState)
  const [pending, setPending] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function update(action: 'confirmed' | 'rejected'): Promise<void> {
    setPending(action)
    setError(null)
    setStatus(null)
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
      {reviewState !== 'rejected' ? (
        <ComplaintCorrectionForm
          workspaceId={workspaceId}
          runId={runId}
          complaintId={complaintId}
          analysis={analysis}
          onSubmitting={(submitting) => setPending(submitting ? 'corrected' : null)}
          onSaved={({ invalidatedAnalysisCount, invalidatedOpportunityCount }) => {
            setReviewState('corrected')
            setStatus(
              `Correction saved. ${invalidatedAnalysisCount} derived analysis run${invalidatedAnalysisCount === 1 ? '' : 's'} and ${invalidatedOpportunityCount} opportunity projection${invalidatedOpportunityCount === 1 ? '' : 's'} require a new reviewed analysis.`
            )
          }}
          onError={setError}
        />
      ) : null}
      <EvidenceRedactionActions
        workspaceId={workspaceId}
        runId={runId}
        complaintId={complaintId}
        evidenceId={evidenceId}
        initialFields={redactedFields}
        canRedact={canRedact}
      />
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
