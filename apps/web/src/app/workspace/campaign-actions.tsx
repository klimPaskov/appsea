'use client'

import { useState } from 'react'

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

export function ResearchCampaignCreateForm({ workspaceId }: { workspaceId: string }) {
  const [campaignId, setCampaignId] = useState('campaign-new')
  const [name, setName] = useState('New research campaign')
  const [purpose, setPurpose] = useState('opportunity-research')
  const [configuration, setConfiguration] = useState(JSON.stringify(initialConfiguration, null, 2))
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
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          name,
          purpose,
          configuration: parsedConfiguration,
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
      <label className="seed-json-label">
        Campaign configuration JSON
        <textarea
          value={configuration}
          onChange={(event) => setConfiguration(event.target.value)}
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
