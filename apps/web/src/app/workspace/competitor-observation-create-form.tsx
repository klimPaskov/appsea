'use client'

import { useMemo, useState, type FormEvent } from 'react'
import type { WorkspaceCompetitorTarget, WorkspaceEvidenceReadModel } from '@appsea/contracts'

const claimTypes = [
  ['positioning', 'Positioning'],
  ['feature', 'Feature'],
  ['pricing', 'Pricing'],
  ['weakness', 'Weakness'],
  ['contrary_signal', 'Contrary signal'],
  ['availability', 'Availability'],
  ['recent_change', 'Recent change']
] as const

function defaultObservedAt(): string {
  return new Date().toISOString().slice(0, 16)
}

function evidenceLabel(evidence: WorkspaceEvidenceReadModel): string {
  return `${evidence.product} · ${evidence.feature} · ${evidence.category} · captured ${evidence.capturedAt.slice(0, 10)}`
}

export function CompetitorObservationCreateForm({
  workspaceId,
  slug,
  targets,
  evidence
}: {
  workspaceId: string
  slug: string
  targets: WorkspaceCompetitorTarget[]
  evidence: WorkspaceEvidenceReadModel[]
}) {
  const eligibleEvidence = useMemo(
    () => evidence.filter((item) => !item.synthetic && item.allowedRepresentation !== 'fixture'),
    [evidence]
  )
  const [competitorId, setCompetitorId] = useState(targets[0]?.competitorId ?? '')
  const [sourceItemId, setSourceItemId] = useState(eligibleEvidence[0]?.sourceItemId ?? '')
  const [evidenceId, setEvidenceId] = useState(eligibleEvidence[0]?.id ?? '')
  const [claimType, setClaimType] = useState<(typeof claimTypes)[number][0]>('positioning')
  const [claim, setClaim] = useState('')
  const [observedAt, setObservedAt] = useState(defaultObservedAt)
  const [confidence, setConfidence] = useState('0.75')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (targets.length === 0 || eligibleEvidence.length === 0) return null

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    const selectedEvidence = eligibleEvidence.find((item) => item.id === evidenceId)
    if (!selectedEvidence) {
      setError('Select retained evidence for this claim.')
      setPending(false)
      return
    }
    const observed = new Date(observedAt)
    const numericConfidence = Number(confidence)
    if (!Number.isFinite(observed.getTime())) {
      setError('Enter a valid observation time.')
      setPending(false)
      return
    }
    if (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) {
      setError('Confidence must be between 0 and 1.')
      setPending(false)
      return
    }
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/opportunities/${slug}/competitor-observations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            observationId: `observation:${crypto.randomUUID()}`,
            competitorId,
            sourceItemId: sourceItemId || selectedEvidence.sourceItemId,
            evidenceId: selectedEvidence.id,
            claimType,
            claim: claim.trim(),
            observedAt: observed.toISOString(),
            confidence: numericConfidence
          })
        }
      )
      const payload = (await response.json()) as { data?: unknown; error?: string }
      if (!response.ok || !payload.data) {
        throw new Error(
          response.status === 428
            ? 'Recent step-up authentication is required before adding research.'
            : (payload.error ?? 'Unable to add competitor observation')
        )
      }
      setMessage('Observation submitted for review. Refreshing the private evidence view…')
      window.setTimeout(() => window.location.reload(), 250)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add competitor observation')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="competitor-observation-create" onSubmit={submit}>
      <div className="section-intro">
        <h3>Add an evidence observation</h3>
        <p>
          Use retained non-synthetic evidence only. The claim starts unreviewed and cannot affect
          the opportunity state until an editor or owner reviews it.
        </p>
      </div>
      <div className="competitor-observation-form-grid">
        <label>
          Competitor or alternative
          <select
            value={competitorId}
            onChange={(event) => setCompetitorId(event.target.value)}
            required
          >
            {targets.map((target) => (
              <option key={target.competitorId} value={target.competitorId}>
                {target.name} ({target.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          Claim type
          <select
            value={claimType}
            onChange={(event) => setClaimType(event.target.value as (typeof claimTypes)[number][0])}
            required
          >
            {claimTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Retained evidence
          <select
            value={evidenceId}
            onChange={(event) => {
              const selected = eligibleEvidence.find((item) => item.id === event.target.value)
              setEvidenceId(event.target.value)
              setSourceItemId(selected?.sourceItemId ?? '')
            }}
            required
          >
            {eligibleEvidence.map((item) => (
              <option key={item.id} value={item.id}>
                {evidenceLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Observed at
          <input
            type="datetime-local"
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
            required
          />
        </label>
        <label>
          Confidence (0–1)
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={confidence}
            onChange={(event) => setConfidence(event.target.value)}
            required
          />
        </label>
      </div>
      <label>
        Claim
        <textarea
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          maxLength={2_000}
          rows={4}
          placeholder="Describe the competitor or weak-market signal supported by the retained evidence."
          required
        />
      </label>
      <p className="muted-note">
        Imported content is evidence data, not instructions. Keep the source record and coverage
        limits visible in the accompanying evidence route.
      </p>
      <button
        className="quiet-button"
        type="submit"
        disabled={pending || claim.trim().length === 0}
      >
        {pending ? 'Submitting…' : 'Submit for review'}
      </button>
      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  )
}
