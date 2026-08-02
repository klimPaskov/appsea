'use client'

import type { ComplaintAnalysis } from '@appsea/contracts'
import { useState } from 'react'

type ReviewState = 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'

export function ProductionComplaintReviewActions({
  workspaceId,
  runId,
  complaintId,
  initialState,
  analysis
}: {
  workspaceId: string
  runId: string
  complaintId: string
  initialState: ReviewState
  analysis?: ComplaintAnalysis
}) {
  const [reviewState, setReviewState] = useState<ReviewState>(initialState)
  const [pending, setPending] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [correctionJson, setCorrectionJson] = useState(() =>
    JSON.stringify(
      analysis
        ? {
            complaintType: analysis.complaintType,
            severity: analysis.severity,
            recurrence: analysis.recurrence,
            switchingIntent: analysis.switchingIntent,
            paymentSignal: analysis.paymentSignal
          }
        : {},
      null,
      2
    )
  )

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

  async function correct(): Promise<void> {
    setPending('corrected')
    setError(null)
    setStatus(null)
    let analysisCorrection: unknown
    try {
      analysisCorrection = JSON.parse(correctionJson) as unknown
    } catch {
      setError('Correction must be valid JSON.')
      setPending(null)
      return
    }
    try {
      const correctionId = `correction:analysis:${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID().replaceAll('-', '')
          : `${Date.now()}${Math.random().toString(16).slice(2)}`
      }`
      const response = await fetch(
        `/api/workspaces/${workspaceId}/research/production/${runId}/complaints/${complaintId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'corrected', correctionId, analysisCorrection })
        }
      )
      const payload = (await response.json()) as {
        data?: {
          reviewState?: ReviewState
          invalidatedAnalysisCount?: number
          invalidatedOpportunityCount?: number
        }
        error?: string
      }
      if (!response.ok || payload.data?.reviewState !== 'corrected') {
        throw new Error(payload.error ?? 'Unable to save analysis correction')
      }
      setReviewState('corrected')
      const analysisCount = payload.data.invalidatedAnalysisCount ?? 0
      const opportunityCount = payload.data.invalidatedOpportunityCount ?? 0
      setStatus(
        `Correction saved. ${analysisCount} derived analysis run${analysisCount === 1 ? '' : 's'} and ${opportunityCount} opportunity projection${opportunityCount === 1 ? '' : 's'} require a new reviewed analysis.`
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save analysis correction')
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
        <details className="analysis-correction">
          <summary>Correct derived analysis</summary>
          <p className="muted-note">
            Edit derived fields only. Source text, provenance, policy metadata, and captured times
            cannot be changed here.
          </p>
          <label htmlFor={`correction-${complaintId}`}>Correction JSON</label>
          <textarea
            id={`correction-${complaintId}`}
            value={correctionJson}
            onChange={(event) => setCorrectionJson(event.target.value)}
            rows={8}
            spellCheck={false}
          />
          <button
            className="quiet-button"
            type="button"
            disabled={pending !== null}
            onClick={() => void correct()}
          >
            {pending === 'corrected' ? 'Saving correction…' : 'Save correction'}
          </button>
        </details>
      ) : null}
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
