'use client'

import { useState } from 'react'
import type { ResearchCampaignReadModel, WorkspaceSourceReadModel } from '@appsea/contracts'

type CampaignSourceOption = Pick<
  WorkspaceSourceReadModel,
  'sourceId' | 'displayName' | 'policyState' | 'collectible' | 'synthetic'
>

export function extractCampaignSourceIds(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const sourceIds = (value as Record<string, unknown>).sourceIds
  if (!Array.isArray(sourceIds)) return []
  return [
    ...new Set(sourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string'))
  ]
}

export function withCampaignSourceIds(value: unknown, sourceIds: string[]): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Campaign configuration must be a JSON object')
  }
  return {
    ...(value as Record<string, unknown>),
    sourceIds: [...new Set(sourceIds)]
  }
}

function sourceState(option: CampaignSourceOption): string {
  if (option.synthetic) return 'Fixture only'
  if (option.collectible) return 'Collectible'
  if (option.policyState === 'pending_review') return 'Pending review'
  if (option.policyState === 'expired') return 'Expired'
  if (option.policyState === 'revoked') return 'Revoked'
  return 'Not collectible'
}

function CampaignSourcePicker({
  options,
  selectedSourceIds,
  disabled,
  onChange
}: {
  options: CampaignSourceOption[]
  selectedSourceIds: string[]
  disabled: boolean
  onChange: (sourceIds: string[]) => void
}) {
  const selected = new Set(selectedSourceIds)
  return (
    <fieldset className="campaign-source-picker">
      <legend>Source allowlist</legend>
      <p className="muted-note">
        Drafts may name pending sources, but only a current approved policy can make a campaign
        collectible.
      </p>
      {options.length === 0 ? (
        <p className="empty-state">The private source registry is temporarily unavailable.</p>
      ) : (
        <div className="campaign-source-options">
          {options.map((option) => {
            const checked = selected.has(option.sourceId)
            return (
              <label className="campaign-source-option" key={option.sourceId}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = new Set(selected)
                    if (event.target.checked) next.add(option.sourceId)
                    else next.delete(option.sourceId)
                    onChange([...next])
                  }}
                />
                <span>
                  <strong>{option.displayName}</strong>
                  <small>{option.sourceId}</small>
                </span>
                <em>{sourceState(option)}</em>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

const initialConfiguration = {
  schemaVersion: 'campaign-v1',
  goal: 'Find recurring software workflow problems.',
  query: 'workflow problem',
  seeds: ['workflow problem'],
  sourceIds: ['cfpb-consumer-complaints'],
  languages: ['en'],
  geographies: [],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 100,
  refreshPolicy: 'manual',
  sensitiveTopicPolicy: 'review',
  requestedDisplayMode: 'excerpt'
}

const initialBudget = {
  currency: 'USD',
  maxSourceItems: 100,
  maxCostMicros: 0,
  maxActivityAttempts: 3
}

export function ResearchCampaignCreateForm({
  workspaceId,
  sourceOptions
}: {
  workspaceId: string
  sourceOptions: CampaignSourceOption[]
}) {
  const [campaignId, setCampaignId] = useState('campaign-new')
  const [name, setName] = useState('New research campaign')
  const [purpose, setPurpose] = useState('opportunity-research')
  const [configuration, setConfiguration] = useState(JSON.stringify(initialConfiguration, null, 2))
  const [selectedSourceIds, setSelectedSourceIds] = useState(
    extractCampaignSourceIds(initialConfiguration)
  )
  const [budget, setBudget] = useState(JSON.stringify(initialBudget, null, 2))
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function create(): Promise<void> {
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const parsedConfiguration = JSON.parse(configuration) as unknown
      const parsedBudget = JSON.parse(budget) as unknown
      const parsedWithSources = withCampaignSourceIds(parsedConfiguration, selectedSourceIds)
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          name,
          purpose,
          configuration: parsedWithSources,
          budget: parsedBudget
        })
      })
      const payload = (await response.json()) as { data?: { state?: string }; error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create research campaign')
      setStatus(`Campaign saved as ${payload.data?.state ?? 'draft'}. No connector was activated.`)
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create research campaign')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="seed-review-create">
      <div className="workspace-seed-form-grid">
        <label>
          Campaign ID
          <input value={campaignId} onChange={(event) => setCampaignId(event.target.value)} />
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Purpose
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
      </div>
      <CampaignSourcePicker
        options={sourceOptions}
        selectedSourceIds={selectedSourceIds}
        disabled={pending}
        onChange={setSelectedSourceIds}
      />
      <label className="seed-json-label">
        Campaign configuration JSON
        <textarea
          value={configuration}
          onChange={(event) => {
            const nextConfiguration = event.target.value
            setConfiguration(nextConfiguration)
            try {
              setSelectedSourceIds(
                extractCampaignSourceIds(JSON.parse(nextConfiguration) as unknown)
              )
            } catch {
              // The server reports malformed JSON after submit; keep the draft editable meanwhile.
            }
          }}
          rows={18}
        />
      </label>
      <label className="seed-json-label">
        Research budget JSON
        <textarea value={budget} onChange={(event) => setBudget(event.target.value)} rows={8} />
      </label>
      <button className="quiet-button" type="button" disabled={pending} onClick={create}>
        {pending ? 'Saving campaign…' : 'Save draft campaign'}
      </button>
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}

export function ResearchCampaignEditForm({
  workspaceId,
  campaign,
  sourceOptions
}: {
  workspaceId: string
  campaign: ResearchCampaignReadModel
  sourceOptions: CampaignSourceOption[]
}) {
  const [name, setName] = useState(campaign.name)
  const [purpose, setPurpose] = useState(campaign.purpose)
  const [configuration, setConfiguration] = useState(
    JSON.stringify(campaign.configuration, null, 2)
  )
  const [selectedSourceIds, setSelectedSourceIds] = useState(
    extractCampaignSourceIds(campaign.configuration)
  )
  const [budget, setBudget] = useState(JSON.stringify(campaign.budget, null, 2))
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function update(): Promise<void> {
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(
        '/api/workspaces/' + workspaceId + '/campaigns/' + campaign.campaignId,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            purpose,
            configuration: withCampaignSourceIds(
              JSON.parse(configuration) as unknown,
              selectedSourceIds
            ),
            budget: JSON.parse(budget) as unknown
          })
        }
      )
      const payload = (await response.json()) as { data?: { state?: string }; error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update research campaign')
      setStatus('Campaign updated as ' + (payload.data?.state ?? 'draft') + '.')
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update research campaign')
    } finally {
      setPending(false)
    }
  }

  async function archive(): Promise<void> {
    if (!window.confirm('Archive this campaign? Existing runs and evidence will be preserved.')) {
      return
    }
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(
        '/api/workspaces/' + workspaceId + '/campaigns/' + campaign.campaignId,
        { method: 'DELETE' }
      )
      const payload = (await response.json()) as { data?: { state?: string }; error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to archive research campaign')
      setStatus('Campaign ' + (payload.data?.state ?? 'archived') + '.')
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to archive research campaign')
    } finally {
      setPending(false)
    }
  }

  return (
    <details className="workspace-campaign-edit">
      <summary>Edit campaign</summary>
      <div className="seed-review-create">
        <div className="workspace-seed-form-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Purpose
            <input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
          </label>
        </div>
        <CampaignSourcePicker
          options={sourceOptions}
          selectedSourceIds={selectedSourceIds}
          disabled={pending}
          onChange={setSelectedSourceIds}
        />
        <label className="seed-json-label">
          Campaign configuration JSON
          <textarea
            value={configuration}
            onChange={(event) => {
              const nextConfiguration = event.target.value
              setConfiguration(nextConfiguration)
              try {
                setSelectedSourceIds(
                  extractCampaignSourceIds(JSON.parse(nextConfiguration) as unknown)
                )
              } catch {
                // The server reports malformed JSON after submit; keep the draft editable meanwhile.
              }
            }}
            rows={18}
          />
        </label>
        <label className="seed-json-label">
          Research budget JSON
          <textarea value={budget} onChange={(event) => setBudget(event.target.value)} rows={8} />
        </label>
        <div className="workspace-actions">
          <button className="quiet-button" type="button" disabled={pending} onClick={update}>
            {pending ? 'Saving campaign...' : 'Save campaign changes'}
          </button>
          <button className="quiet-button" type="button" disabled={pending} onClick={archive}>
            Archive campaign
          </button>
        </div>
        {status ? <p className="form-success">{status}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  )
}
