'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface ApprovedProductionSeedOption {
  seedReviewId: string
  name: string
  slug: string
}

export function ProductionAnalysisStartAction({
  workspaceId,
  collectionRunId,
  approvedSeeds
}: {
  workspaceId: string
  collectionRunId: string
  approvedSeeds: ApprovedProductionSeedOption[]
}) {
  const [seedReviewId, setSeedReviewId] = useState(approvedSeeds[0]?.seedReviewId ?? '')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [analysisLink, setAnalysisLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    if (!seedReviewId) {
      setError('Select an approved seed review before starting analysis')
      return
    }
    setPending(true)
    setStatus(null)
    setAnalysisLink(null)
    setError(null)
    try {
      const token = crypto.randomUUID().replaceAll('-', '')
      const analysisRunId = `analysis:${token.slice(0, 32)}`
      const response = await fetch(
        `/api/workspaces/${workspaceId}/research/production/${collectionRunId}/analysis`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            analysisRunId,
            idempotencyKey: `production-analysis-${token}`,
            requestedAt: new Date().toISOString(),
            seedReviewId
          })
        }
      )
      const payload = (await response.json()) as {
        data?: { workflowId?: string; analysisRunId?: string }
        error?: string
      }
      if (!response.ok || !payload.data?.analysisRunId) {
        throw new Error(payload.error ?? 'Unable to start production analysis')
      }
      const workflowId = payload.data.workflowId
      const href = `/workspace/${workspaceId}/research/analysis/${payload.data.analysisRunId}${
        workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ''
      }`
      setStatus('Analysis queued from the approved seed review.')
      setAnalysisLink(href)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start production analysis')
    } finally {
      setPending(false)
    }
  }

  if (approvedSeeds.length === 0) {
    return (
      <p className="muted-note">
        No approved seed review is available. Review one in{' '}
        <Link href={`/workspace/${workspaceId}/seed-reviews`}>Seed reviews</Link> before analysis.
      </p>
    )
  }

  return (
    <div className="production-analysis-start" aria-live="polite">
      <label>
        Approved seed review
        <select value={seedReviewId} onChange={(event) => setSeedReviewId(event.target.value)}>
          {approvedSeeds.map((seed) => (
            <option key={seed.seedReviewId} value={seed.seedReviewId}>
              {seed.name} ({seed.slug})
            </option>
          ))}
        </select>
      </label>
      <button
        className="quiet-button"
        type="button"
        disabled={pending || analysisLink !== null}
        onClick={start}
      >
        {pending ? 'Queueing analysis...' : 'Start reviewed analysis'}
      </button>
      {status ? <p className="form-success">{status}</p> : null}
      {analysisLink ? (
        <Link className="quiet-button" href={analysisLink}>
          View analysis status
        </Link>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
