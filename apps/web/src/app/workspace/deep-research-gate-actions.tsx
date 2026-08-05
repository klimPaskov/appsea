'use client'

import { useState } from 'react'
import type {
  DeepResearchGate,
  DeepResearchGateCheck,
  DeepResearchGateChecks
} from '@appsea/contracts'

type GateAction = 'submit' | 'pass' | 'withdraw'

const checkDefinitions = [
  {
    key: 'coherentCluster',
    label: 'Coherent complaint cluster',
    description: 'The opportunity describes one narrow, repeated user problem.'
  },
  {
    key: 'provenanceComplete',
    label: 'Provenance is complete',
    description: 'Each important claim retains an inspectable source and evidence trail.'
  },
  {
    key: 'copiedContentInfluence',
    label: 'Copied-content influence checked',
    description: 'Copied, syndicated, or derivative content cannot inflate recurrence.'
  },
  {
    key: 'uniqueAuthorEstimate',
    label: 'Unique-author limitations assessed',
    description: 'The review records what can and cannot be inferred about distinct authors.'
  },
  {
    key: 'contraryEvidenceSearch',
    label: 'Contrary evidence searched',
    description:
      'Evidence that weakens the opportunity or suggests a different explanation is recorded.'
  },
  {
    key: 'competitorCoverage',
    label: 'Competitor coverage reviewed',
    description: 'Direct, adjacent, and platform alternatives are considered separately.'
  },
  {
    key: 'substituteCoverage',
    label: 'Substitute coverage reviewed',
    description: 'Workarounds and the choice to do nothing are included where relevant.'
  },
  {
    key: 'sourceGapsReviewed',
    label: 'Source gaps reviewed',
    description:
      'Restricted routes, quotas, missing narratives, and other coverage limits stay visible.'
  },
  {
    key: 'policyRisksReviewed',
    label: 'Policy risks reviewed',
    description:
      'Retention, deletion, display, attribution, and source-policy constraints are understood.'
  },
  {
    key: 'reproducibleSnapshot',
    label: 'Snapshot is reproducible',
    description: 'The decision is tied to a stable analysis snapshot and versioned inputs.'
  },
  {
    key: 'manipulationRiskReviewed',
    label: 'Manipulation risk reviewed',
    description:
      'Astroturfing, coordinated repetition, and other demand-quality risks are considered.'
  },
  {
    key: 'extractionAgreement',
    label: 'Extraction agreement reviewed',
    description: 'The normalized interpretation is sufficiently consistent for this decision.'
  }
] as const satisfies ReadonlyArray<{
  key: keyof DeepResearchGateChecks
  label: string
  description: string
}>

export { checkDefinitions as deepResearchGateCheckDefinitions }

function emptyCheck(): DeepResearchGateCheck {
  return { state: 'not-reviewed', note: null, evidenceIds: [] }
}

export function initialDeepResearchGateChecks(
  gate: Pick<DeepResearchGate, 'checks'> | null | undefined
): DeepResearchGateChecks {
  if (gate) {
    return Object.fromEntries(
      checkDefinitions.map(({ key }) => [
        key,
        { ...gate.checks[key], evidenceIds: [...gate.checks[key].evidenceIds] }
      ])
    ) as DeepResearchGateChecks
  }
  return Object.fromEntries(
    checkDefinitions.map(({ key }) => [key, emptyCheck()])
  ) as DeepResearchGateChecks
}

export function parseEvidenceIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ]
}

function statusLabel(status: DeepResearchGate['status']): string {
  return status === 'not-ready' ? 'Not ready' : status.replace('-', ' ')
}

export function DeepResearchGateActions({
  workspaceId,
  slug,
  role,
  initialGate
}: {
  workspaceId: string
  slug: string
  role: 'owner' | 'editor' | 'viewer'
  initialGate: DeepResearchGate | null
}) {
  const [gate, setGate] = useState<DeepResearchGate | null>(initialGate)
  const [checks, setChecks] = useState<DeepResearchGateChecks>(() =>
    initialDeepResearchGateChecks(initialGate)
  )
  const [reviewNotes, setReviewNotes] = useState('')
  const [pending, setPending] = useState<GateAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const status = gate?.status ?? 'not-ready'
  const canSubmit = role === 'owner' || role === 'editor'
  const canPass = role === 'owner'
  const canEdit = canSubmit && status !== 'passed'

  function updateCheck(
    key: keyof DeepResearchGateChecks,
    update: Partial<DeepResearchGateCheck>
  ): void {
    setChecks((current) => ({
      ...current,
      [key]: { ...current[key], ...update }
    }))
  }

  async function transition(action: GateAction): Promise<void> {
    setPending(action)
    setError(null)
    const body =
      action === 'withdraw'
        ? { action }
        : {
            action,
            checks,
            ...(action === 'submit' && reviewNotes.trim() ? { notes: [reviewNotes.trim()] } : {})
          }
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/opportunities/${slug}/research-gate`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }
      )
      const payload = (await response.json()) as {
        data?: DeepResearchGate | null
        error?: string
      }
      if (payload.data) {
        setGate(payload.data)
        setChecks(initialDeepResearchGateChecks(payload.data))
      }
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? 'Unable to update the deep-research gate')
      }
      setReviewNotes('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the deep-research gate')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="deep-research-gate-actions" aria-live="polite">
      <div className="review-actions">
        <span className="review-state">Current gate: {statusLabel(status)}</span>
        {status === 'passed' && canPass ? (
          <button
            className="quiet-button"
            type="button"
            disabled={pending !== null}
            onClick={() => transition('withdraw')}
          >
            {pending === 'withdraw' ? 'Withdrawing…' : 'Withdraw promotion'}
          </button>
        ) : null}
      </div>

      {gate?.blockingReasons.length ? (
        <div className="deep-research-gate-blockers">
          <p className="label">Current blockers</p>
          <ul>
            {gate.blockingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {gate || canSubmit ? (
        <fieldset className="deep-research-checklist" disabled={!canEdit || pending !== null}>
          <legend>Reviewed checklist</legend>
          <p className="deep-research-checklist-intro">
            Record the decision against the current analysis snapshot. A pass requires every item,
            source-backed competitor evidence, contrary evidence, and substitute or do-nothing
            coverage.
          </p>
          {checkDefinitions.map(({ key, label, description }) => {
            const check = checks[key]
            return (
              <div className="deep-research-check-row" key={key}>
                <div className="deep-research-check-copy">
                  <h3>{label}</h3>
                  <p>{description}</p>
                </div>
                <div className="deep-research-check-controls">
                  <label>
                    State
                    {canEdit ? (
                      <select
                        aria-label={`${label} state`}
                        value={check.state}
                        onChange={(event) =>
                          updateCheck(key, {
                            state: event.target.value as DeepResearchGateCheck['state']
                          })
                        }
                      >
                        <option value="not-reviewed">Not reviewed</option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </select>
                    ) : (
                      <span className="deep-research-check-state">{check.state}</span>
                    )}
                  </label>
                  {canEdit ? (
                    <label>
                      Evidence IDs
                      <input
                        aria-label={`${label} evidence IDs`}
                        value={check.evidenceIds.join(', ')}
                        placeholder="evidence:…"
                        onChange={(event) =>
                          updateCheck(key, { evidenceIds: parseEvidenceIds(event.target.value) })
                        }
                      />
                    </label>
                  ) : check.evidenceIds.length > 0 ? (
                    <span className="deep-research-check-evidence">
                      {check.evidenceIds.join(' · ')}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <label>
                      Review note
                      <textarea
                        aria-label={`${label} review note`}
                        rows={2}
                        value={check.note ?? ''}
                        onChange={(event) =>
                          updateCheck(key, { note: event.target.value.trim() || null })
                        }
                      />
                    </label>
                  ) : check.note ? (
                    <p className="deep-research-check-note">{check.note}</p>
                  ) : null}
                </div>
              </div>
            )
          })}
          {canEdit ? (
            <>
              <label className="deep-research-review-notes">
                Submission note (optional)
                <textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder="Explain what was reviewed or what remains blocked."
                />
              </label>
              <div className="review-actions">
                <button
                  className="quiet-button"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => transition('submit')}
                >
                  {pending === 'submit' ? 'Submitting…' : 'Submit review'}
                </button>
                {canPass ? (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => transition('pass')}
                  >
                    {pending === 'pass' ? 'Checking…' : 'Pass and promote'}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
