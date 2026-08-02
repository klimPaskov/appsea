'use client'

import type { EvidenceRedactionField, EvidenceRedactionReason } from '@appsea/contracts'
import { useMemo, useState } from 'react'

const fieldOptions: Array<{ value: EvidenceRedactionField; label: string }> = [
  { value: 'text', label: 'Narrative text' },
  { value: 'product', label: 'Product candidate' },
  { value: 'company', label: 'Company candidate' },
  { value: 'feature', label: 'Feature candidate' },
  { value: 'category', label: 'Category candidate' },
  { value: 'canonicalLocator', label: 'Canonical source locator' }
]

const reasonOptions: Array<{ value: EvidenceRedactionReason; label: string }> = [
  { value: 'pii', label: 'Personal information' },
  { value: 'legal_request', label: 'Legal request' },
  { value: 'policy_minimization', label: 'Policy minimization' },
  { value: 'operator_correction', label: 'Operator correction' }
]

function newRedactionId(): string {
  return `redaction:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

export function EvidenceRedactionActions({
  workspaceId,
  runId,
  complaintId,
  evidenceId,
  initialFields = [],
  canRedact
}: {
  workspaceId: string
  runId: string
  complaintId: string
  evidenceId: string
  initialFields?: readonly EvidenceRedactionField[] | undefined
  canRedact: boolean
}) {
  const initial = useMemo(() => new Set(initialFields), [initialFields])
  const [redactedFields, setRedactedFields] = useState<Set<EvidenceRedactionField>>(initial)
  const [selectedFields, setSelectedFields] = useState<EvidenceRedactionField[]>([])
  const [reason, setReason] = useState<EvidenceRedactionReason>('policy_minimization')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  if (!canRedact) return null

  function toggleField(field: EvidenceRedactionField): void {
    setSelectedFields((current) =>
      current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field]
    )
  }

  async function redact(): Promise<void> {
    if (selectedFields.length === 0) {
      setError('Select at least one field to redact')
      return
    }
    setPending(true)
    setError(null)
    setStatus(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/research/production/${runId}/complaints/${complaintId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            evidenceId,
            redactionId: newRedactionId(),
            fields: selectedFields,
            reason
          })
        }
      )
      const payload = (await response.json()) as {
        data?: { fields?: EvidenceRedactionField[]; replayed?: boolean }
        error?: string
      }
      if (!response.ok || !payload.data?.fields) {
        throw new Error(payload.error ?? 'Unable to redact evidence')
      }
      setRedactedFields((current) => new Set([...current, ...payload.data!.fields!]))
      setSelectedFields([])
      setStatus(
        payload.data.replayed
          ? 'This redaction was already applied.'
          : 'Selected evidence fields are now masked in private research views.'
      )
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : 'Unable to redact evidence')
    } finally {
      setPending(false)
    }
  }

  return (
    <details className="evidence-redaction">
      <summary>Privacy redaction</summary>
      <div className="evidence-redaction-content">
        <p className="muted-note">
          Editors and owners can mask selected fields in private projections. Source-object deletion
          and retention-policy purges remain separate operations.
        </p>
        <fieldset disabled={pending}>
          <legend>Fields to mask</legend>
          <div className="evidence-redaction-fields">
            {fieldOptions.map((field) => {
              const alreadyRedacted = redactedFields.has(field.value)
              return (
                <label key={field.value}>
                  <input
                    type="checkbox"
                    checked={alreadyRedacted || selectedFields.includes(field.value)}
                    disabled={alreadyRedacted}
                    onChange={() => toggleField(field.value)}
                  />{' '}
                  {field.label}
                  {alreadyRedacted ? ' (masked)' : ''}
                </label>
              )
            })}
          </div>
          <label>
            Reason
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as EvidenceRedactionReason)}
            >
              {reasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <button className="quiet-button" type="button" disabled={pending} onClick={redact}>
          {pending ? 'Applying…' : 'Mask selected fields'}
        </button>
        {status ? <p className="form-success">{status}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  )
}
