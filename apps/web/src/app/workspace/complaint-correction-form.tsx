'use client'

import type {
  ComplaintAnalysis,
  ComplaintAnalysisCorrection,
  ComplaintEntityReference,
  ComplaintEntityResolution
} from '@appsea/contracts'
import { useState } from 'react'

type EntityReferenceDraft = {
  entityType: ComplaintEntityReference['entityType']
  surfaceText: string
  canonicalName: string
  confidence: string
  resolution: ComplaintEntityReference['resolution']
  /** Provenance for an entity reference stays fixed from the stored snapshot. */
  evidence: ComplaintEntityReference['evidence']
}

type EntityDraft = {
  product: EntityReferenceDraft
  company: EntityReferenceDraft
  feature: EntityReferenceDraft
  substitutes: EntityReferenceDraft[]
  competitors: EntityReferenceDraft[]
}

export type CorrectionFormDraft = {
  classification: ComplaintAnalysis['classification']
  complaintType: ComplaintAnalysis['complaintType']
  problemStatement: string
  expectedOutcome: string
  observedOutcome: string
  consequence: string
  affectedWorkflow: string
  workaround: string
  featureMentions: string
  userSegmentHints: string
  severity: string
  recurrence: ComplaintAnalysis['recurrence']
  switchingIntent: ComplaintAnalysis['switchingIntent']
  paymentSignal: ComplaintAnalysis['paymentSignal']
  actionabilityProbability: string
  classificationConfidence: string
  entityConfidence: string
  manipulationRisk: string
  piiFlags: string
  entities: EntityDraft
}

const classificationOptions: ComplaintAnalysis['classification'][] = [
  'complaint',
  'feature_request',
  'question',
  'praise',
  'support_response',
  'joke',
  'spam',
  'unrelated'
]

const complaintTypeOptions: ComplaintAnalysis['complaintType'][] = [
  'missing_capability',
  'broken_behavior',
  'usability',
  'performance',
  'reliability',
  'integration',
  'pricing',
  'privacy',
  'security',
  'support',
  'accessibility',
  'platform_restriction',
  'workflow_gap',
  'other'
]

const recurrenceOptions: ComplaintAnalysis['recurrence'][] = [
  'none',
  'occasional',
  'repeated',
  'persistent',
  'unknown'
]

const switchingOptions: ComplaintAnalysis['switchingIntent'][] = [
  'none',
  'possible',
  'explicit',
  'unknown'
]

const paymentOptions: ComplaintAnalysis['paymentSignal'][] = ['none', 'weak', 'explicit', 'unknown']

const resolutionOptions: ComplaintEntityReference['resolution'][] = [
  'exact',
  'normalized',
  'contextual',
  'ambiguous',
  'unresolved'
]

function referenceDraft(reference: ComplaintEntityReference): EntityReferenceDraft {
  return {
    entityType: reference.entityType,
    surfaceText: reference.surfaceText,
    canonicalName: reference.canonicalName ?? '',
    confidence: String(reference.confidence),
    resolution: reference.resolution,
    evidence: reference.evidence
  }
}

export function draftFromAnalysis(analysis: ComplaintAnalysis): CorrectionFormDraft {
  return {
    classification: analysis.classification,
    complaintType: analysis.complaintType,
    problemStatement: analysis.problemStatement,
    expectedOutcome: analysis.expectedOutcome ?? '',
    observedOutcome: analysis.observedOutcome,
    consequence: analysis.consequence ?? '',
    affectedWorkflow: analysis.affectedWorkflow,
    workaround: analysis.workaround ?? '',
    featureMentions: analysis.featureMentions.join('\n'),
    userSegmentHints: analysis.userSegmentHints.join('\n'),
    severity: String(analysis.severity),
    recurrence: analysis.recurrence,
    switchingIntent: analysis.switchingIntent,
    paymentSignal: analysis.paymentSignal,
    actionabilityProbability: String(analysis.actionabilityProbability),
    classificationConfidence: String(analysis.classificationConfidence),
    entityConfidence: String(analysis.entityConfidence),
    manipulationRisk: String(analysis.manipulationRisk),
    piiFlags: analysis.piiFlags.join('\n'),
    entities: {
      product: referenceDraft(analysis.entities.product),
      company: referenceDraft(analysis.entities.company),
      feature: referenceDraft(analysis.entities.feature),
      substitutes: analysis.entities.substitutes.map(referenceDraft),
      competitors: analysis.entities.competitors.map(referenceDraft)
    }
  }
}

function parseNumber(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

function parseInteger(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = parseNumber(value, label, minimum, maximum)
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be a whole number`)
  return parsed
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function lines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ]
}

function entityReferenceValue(reference: EntityReferenceDraft): ComplaintEntityReference {
  return {
    entityType: reference.entityType,
    surfaceText: requiredText(reference.surfaceText, `${reference.entityType} surface text`),
    canonicalName: optionalText(reference.canonicalName),
    confidence: parseNumber(`${reference.confidence}`, `${reference.entityType} confidence`, 0, 1),
    resolution: reference.resolution,
    evidence: reference.evidence
  }
}

function entityResolutionValue(draft: EntityDraft): ComplaintEntityResolution {
  const product = entityReferenceValue(draft.product)
  const company = entityReferenceValue(draft.company)
  const feature = entityReferenceValue(draft.feature)
  const substitutes = draft.substitutes.map(entityReferenceValue)
  const competitors = draft.competitors.map(entityReferenceValue)
  const unresolvedTypes: ComplaintEntityResolution['unresolvedTypes'] = []
  if (product.canonicalName === null) unresolvedTypes.push('product')
  if (company.canonicalName === null) unresolvedTypes.push('company')
  if (feature.canonicalName === null) unresolvedTypes.push('feature')
  if (!substitutes.some((entry) => entry.canonicalName !== null)) {
    unresolvedTypes.push('substitute')
  }
  if (!competitors.some((entry) => entry.canonicalName !== null)) {
    unresolvedTypes.push('competitor')
  }
  return { product, company, feature, substitutes, competitors, unresolvedTypes }
}

export function correctionPayloadFromDraft(
  draft: CorrectionFormDraft
): ComplaintAnalysisCorrection {
  return {
    classification: draft.classification,
    complaintType: draft.complaintType,
    problemStatement: requiredText(draft.problemStatement, 'Problem statement'),
    expectedOutcome: optionalText(draft.expectedOutcome),
    observedOutcome: requiredText(draft.observedOutcome, 'Observed outcome'),
    consequence: optionalText(draft.consequence),
    affectedWorkflow: requiredText(draft.affectedWorkflow, 'Affected workflow'),
    workaround: optionalText(draft.workaround),
    featureMentions: lines(draft.featureMentions),
    userSegmentHints: lines(draft.userSegmentHints),
    severity: parseInteger(draft.severity, 'Severity', 0, 5),
    recurrence: draft.recurrence,
    switchingIntent: draft.switchingIntent,
    paymentSignal: draft.paymentSignal,
    actionabilityProbability: parseNumber(
      draft.actionabilityProbability,
      'Actionability probability',
      0,
      1
    ),
    classificationConfidence: parseNumber(
      draft.classificationConfidence,
      'Classification confidence',
      0,
      1
    ),
    entityConfidence: parseNumber(draft.entityConfidence, 'Entity confidence', 0, 1),
    manipulationRisk: parseNumber(draft.manipulationRisk, 'Manipulation risk', 0, 1),
    piiFlags: lines(draft.piiFlags),
    entities: entityResolutionValue(draft.entities)
  }
}

function EntityReferenceEditor({
  label,
  reference,
  disabled,
  removable,
  onChange,
  onRemove
}: {
  label: string
  reference: EntityReferenceDraft
  disabled: boolean
  removable: boolean
  onChange: (reference: EntityReferenceDraft) => void
  onRemove?: () => void
}) {
  function update<K extends keyof EntityReferenceDraft>(
    key: K,
    value: EntityReferenceDraft[K]
  ): void {
    onChange({ ...reference, [key]: value })
  }

  return (
    <fieldset className="correction-entity-card">
      <legend>{label}</legend>
      <label>
        Surface text
        <input
          value={reference.surfaceText}
          disabled={disabled}
          onChange={(event) => update('surfaceText', event.target.value)}
        />
      </label>
      <label>
        Canonical name
        <input
          value={reference.canonicalName}
          disabled={disabled}
          onChange={(event) => update('canonicalName', event.target.value)}
        />
      </label>
      <div className="correction-control-grid">
        <label>
          Confidence
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={reference.confidence}
            disabled={disabled}
            onChange={(event) => update('confidence', event.target.value)}
          />
        </label>
        <label>
          Resolution
          <select
            value={reference.resolution}
            disabled={disabled}
            onChange={(event) =>
              update('resolution', event.target.value as EntityReferenceDraft['resolution'])
            }
          >
            {resolutionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="correction-readonly">
        Evidence basis: <strong>{reference.evidence}</strong>
      </p>
      {removable && onRemove ? (
        <button className="quiet-button" type="button" disabled={disabled} onClick={onRemove}>
          Remove {label.toLowerCase()}
        </button>
      ) : null}
    </fieldset>
  )
}

function EntityEditor({
  complaintId,
  draft,
  disabled,
  onChange
}: {
  complaintId: string
  draft: EntityDraft
  disabled: boolean
  onChange: (draft: EntityDraft) => void
}) {
  function updatePrimary(
    key: 'product' | 'company' | 'feature',
    reference: EntityReferenceDraft
  ): void {
    onChange({ ...draft, [key]: reference })
  }

  function updateList(
    key: 'substitutes' | 'competitors',
    index: number,
    reference: EntityReferenceDraft
  ): void {
    const next = [...draft[key]]
    next[index] = reference
    onChange({ ...draft, [key]: next })
  }

  function addList(key: 'substitutes' | 'competitors'): void {
    const entityType = key === 'substitutes' ? 'substitute' : 'competitor'
    const blank: EntityReferenceDraft = {
      entityType,
      surfaceText: '',
      canonicalName: '',
      confidence: '0',
      resolution: 'unresolved',
      evidence: 'not-inferred'
    }
    onChange({ ...draft, [key]: [...draft[key], blank] })
  }

  function removeList(key: 'substitutes' | 'competitors', index: number): void {
    onChange({ ...draft, [key]: draft[key].filter((_, entryIndex) => entryIndex !== index) })
  }

  return (
    <details className="correction-entities">
      <summary>Entity resolution</summary>
      <p className="muted-note">
        Product, company, feature, substitute, and competitor labels are derived fields. Evidence
        basis is retained from the stored snapshot and cannot be changed here.
      </p>
      <div className="correction-entity-grid">
        <EntityReferenceEditor
          label="Product"
          reference={draft.product}
          disabled={disabled}
          removable={false}
          onChange={(reference) => updatePrimary('product', reference)}
        />
        <EntityReferenceEditor
          label="Company"
          reference={draft.company}
          disabled={disabled}
          removable={false}
          onChange={(reference) => updatePrimary('company', reference)}
        />
        <EntityReferenceEditor
          label="Feature"
          reference={draft.feature}
          disabled={disabled}
          removable={false}
          onChange={(reference) => updatePrimary('feature', reference)}
        />
      </div>
      <div className="correction-entity-list">
        <div className="correction-entity-list-heading">
          <h4>Substitutes and workarounds</h4>
          <button
            className="quiet-button"
            type="button"
            disabled={disabled}
            onClick={() => addList('substitutes')}
          >
            Add substitute
          </button>
        </div>
        {draft.substitutes.map((reference, index) => (
          <EntityReferenceEditor
            key={`substitute-${complaintId}-${index}`}
            label={`Substitute ${index + 1}`}
            reference={reference}
            disabled={disabled}
            removable
            onChange={(next) => updateList('substitutes', index, next)}
            onRemove={() => removeList('substitutes', index)}
          />
        ))}
      </div>
      <div className="correction-entity-list">
        <div className="correction-entity-list-heading">
          <h4>Competitors</h4>
          <button
            className="quiet-button"
            type="button"
            disabled={disabled}
            onClick={() => addList('competitors')}
          >
            Add competitor
          </button>
        </div>
        {draft.competitors.map((reference, index) => (
          <EntityReferenceEditor
            key={`competitor-${complaintId}-${index}`}
            label={`Competitor ${index + 1}`}
            reference={reference}
            disabled={disabled}
            removable
            onChange={(next) => updateList('competitors', index, next)}
            onRemove={() => removeList('competitors', index)}
          />
        ))}
      </div>
    </details>
  )
}

export function ComplaintCorrectionForm({
  workspaceId,
  runId,
  complaintId,
  analysis,
  onSubmitting,
  onSaved,
  onError
}: {
  workspaceId: string
  runId: string
  complaintId: string
  analysis?: ComplaintAnalysis | undefined
  onSubmitting: (submitting: boolean) => void
  onSaved: (result: {
    invalidatedAnalysisCount: number
    invalidatedOpportunityCount: number
  }) => void
  onError: (message: string | null) => void
}) {
  const [draft, setDraft] = useState<CorrectionFormDraft | null>(() =>
    analysis ? draftFromAnalysis(analysis) : null
  )
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof CorrectionFormDraft>(
    key: K,
    value: CorrectionFormDraft[K]
  ): void {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  async function submit(): Promise<void> {
    if (!draft) {
      onError('Derived analysis is unavailable for this complaint.')
      return
    }
    setSubmitting(true)
    onSubmitting(true)
    onError(null)
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
          body: JSON.stringify({
            action: 'corrected',
            correctionId,
            analysisCorrection: correctionPayloadFromDraft(draft)
          })
        }
      )
      const payload = (await response.json()) as {
        data?: {
          reviewState?: string
          invalidatedAnalysisCount?: number
          invalidatedOpportunityCount?: number
        }
        error?: string
      }
      if (!response.ok || payload.data?.reviewState !== 'corrected') {
        throw new Error(payload.error ?? 'Unable to save analysis correction')
      }
      onSaved({
        invalidatedAnalysisCount: payload.data.invalidatedAnalysisCount ?? 0,
        invalidatedOpportunityCount: payload.data.invalidatedOpportunityCount ?? 0
      })
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Unable to save analysis correction')
    } finally {
      setSubmitting(false)
      onSubmitting(false)
    }
  }

  return (
    <details className="analysis-correction">
      <summary>Correct derived analysis</summary>
      <p className="muted-note">
        Edit derived interpretation only. Source text, provenance, policy metadata, captured times,
        and derivation versions cannot be changed here.
      </p>
      {!draft ? (
        <p className="muted-note">Derived analysis is unavailable for this complaint.</p>
      ) : (
        <div className="analysis-correction-fields">
          <fieldset className="correction-form-fieldset" disabled={submitting}>
            <div className="correction-control-grid">
              <label>
                Classification
                <select
                  value={draft.classification}
                  onChange={(event) =>
                    update(
                      'classification',
                      event.target.value as CorrectionFormDraft['classification']
                    )
                  }
                >
                  {classificationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Complaint type
                <select
                  value={draft.complaintType}
                  onChange={(event) =>
                    update(
                      'complaintType',
                      event.target.value as CorrectionFormDraft['complaintType']
                    )
                  }
                >
                  {complaintTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Problem statement
              <textarea
                value={draft.problemStatement}
                rows={3}
                onChange={(event) => update('problemStatement', event.target.value)}
              />
            </label>
            <label>
              Observed outcome
              <textarea
                value={draft.observedOutcome}
                rows={3}
                onChange={(event) => update('observedOutcome', event.target.value)}
              />
            </label>
            <div className="correction-control-grid">
              <label>
                Expected outcome (optional)
                <textarea
                  value={draft.expectedOutcome}
                  rows={2}
                  onChange={(event) => update('expectedOutcome', event.target.value)}
                />
              </label>
              <label>
                Consequence (optional)
                <textarea
                  value={draft.consequence}
                  rows={2}
                  onChange={(event) => update('consequence', event.target.value)}
                />
              </label>
            </div>
            <div className="correction-control-grid">
              <label>
                Affected workflow
                <textarea
                  value={draft.affectedWorkflow}
                  rows={2}
                  onChange={(event) => update('affectedWorkflow', event.target.value)}
                />
              </label>
              <label>
                Workaround (optional)
                <textarea
                  value={draft.workaround}
                  rows={2}
                  onChange={(event) => update('workaround', event.target.value)}
                />
              </label>
            </div>
            <div className="correction-control-grid">
              <label>
                Feature mentions (one per line)
                <textarea
                  className="correction-array"
                  value={draft.featureMentions}
                  rows={3}
                  onChange={(event) => update('featureMentions', event.target.value)}
                />
              </label>
              <label>
                User segments (one per line)
                <textarea
                  className="correction-array"
                  value={draft.userSegmentHints}
                  rows={3}
                  onChange={(event) => update('userSegmentHints', event.target.value)}
                />
              </label>
            </div>
            <div className="correction-control-grid">
              <label>
                Severity (0-5)
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="1"
                  value={draft.severity}
                  onChange={(event) => update('severity', event.target.value)}
                />
              </label>
              <label>
                Recurrence
                <select
                  value={draft.recurrence}
                  onChange={(event) =>
                    update('recurrence', event.target.value as CorrectionFormDraft['recurrence'])
                  }
                >
                  {recurrenceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Switching intent
                <select
                  value={draft.switchingIntent}
                  onChange={(event) =>
                    update(
                      'switchingIntent',
                      event.target.value as CorrectionFormDraft['switchingIntent']
                    )
                  }
                >
                  {switchingOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Payment signal
                <select
                  value={draft.paymentSignal}
                  onChange={(event) =>
                    update(
                      'paymentSignal',
                      event.target.value as CorrectionFormDraft['paymentSignal']
                    )
                  }
                >
                  {paymentOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="correction-control-grid">
              <label>
                Actionability probability (0-1)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.actionabilityProbability}
                  onChange={(event) => update('actionabilityProbability', event.target.value)}
                />
              </label>
              <label>
                Classification confidence (0-1)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.classificationConfidence}
                  onChange={(event) => update('classificationConfidence', event.target.value)}
                />
              </label>
              <label>
                Entity confidence (0-1)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.entityConfidence}
                  onChange={(event) => update('entityConfidence', event.target.value)}
                />
              </label>
              <label>
                Manipulation risk (0-1)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.manipulationRisk}
                  onChange={(event) => update('manipulationRisk', event.target.value)}
                />
              </label>
            </div>
            <label>
              PII flags (one per line)
              <textarea
                className="correction-array"
                value={draft.piiFlags}
                rows={2}
                onChange={(event) => update('piiFlags', event.target.value)}
              />
            </label>
            <EntityEditor
              complaintId={complaintId}
              draft={draft.entities}
              disabled={submitting}
              onChange={(entities) => update('entities', entities)}
            />
            <button className="quiet-button" type="button" onClick={() => void submit()}>
              Save derived correction
            </button>
          </fieldset>
        </div>
      )}
    </details>
  )
}
