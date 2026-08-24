'use client'

import { useMemo, useState } from 'react'
import type {
  ProductionCollectionRecollectionTarget,
  ProductionCollectionWorkflowStartRequest,
  ResearchDateRange,
  ResearchJobBudget
} from '@appsea/contracts'

export interface ProductionRecollectionCampaignOption {
  campaignId: string
  campaignName: string
  policyVersion: string
  query: string
  dateRange: ResearchDateRange
  purpose: string
  requestedDisplayMode: 'excerpt' | 'metadata-only' | 'aggregate-only'
  budget: ResearchJobBudget
}

export function buildProductionRecollectionRequest(
  workspaceId: string,
  target: ProductionCollectionRecollectionTarget,
  campaign: ProductionRecollectionCampaignOption,
  token: string,
  requestedAt: string
): ProductionCollectionWorkflowStartRequest {
  return {
    workspaceId,
    campaignId: campaign.campaignId,
    runId: `run:recollection:${token.slice(0, 24)}`,
    idempotencyKey: `recollection-${token}`,
    workflowVersion: 'production-collection-v1',
    sourceId: target.sourceId,
    policyVersion: campaign.policyVersion,
    query: campaign.query,
    dateRange: campaign.dateRange,
    limit: 1,
    purpose: campaign.purpose,
    requestedDisplayMode: campaign.requestedDisplayMode,
    budget: {
      ...campaign.budget,
      maxSourceItems: 1
    },
    requestedAt,
    recollectionTombstoneId: target.tombstoneId
  }
}

export function ProductionRecollectionAction({
  workspaceId,
  target,
  campaigns,
  canStart
}: {
  workspaceId: string
  target: ProductionCollectionRecollectionTarget
  campaigns: ProductionRecollectionCampaignOption[]
  canStart: boolean
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaignId ?? '')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<{ workflowId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.campaignId === campaignId) ?? campaigns[0],
    [campaignId, campaigns]
  )

  if (target.activeWorkflowId) {
    return (
      <p className="muted-note" aria-live="polite">
        A re-collection is already in flight for this tombstone.{' '}
        <a
          href={`/workspace/${encodeURIComponent(workspaceId)}/research/workflows/${encodeURIComponent(target.activeWorkflowId)}`}
        >
          View workflow status
        </a>
        .
      </p>
    )
  }
  if (target.activeSourceItem) {
    return (
      <p className="muted-note" aria-live="polite">
        This tombstone already has an active re-collected source item. Review its collection run
        instead of submitting another request.
      </p>
    )
  }
  if (!canStart) {
    return <p className="muted-note">Only a workspace owner or editor can request re-collection.</p>
  }
  if (campaigns.length === 0 || !selectedCampaign) {
    return (
      <p className="muted-note">
        No current private campaign has an approved policy for this source and purpose. The
        tombstone remains visible, but no request can be submitted.
      </p>
    )
  }

  async function submit(): Promise<void> {
    if (!selectedCampaign) return
    setPending(true)
    setStatus(null)
    setError(null)
    const token = crypto.randomUUID().replaceAll('-', '')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/research/production`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          buildProductionRecollectionRequest(
            workspaceId,
            target,
            selectedCampaign,
            token,
            new Date().toISOString()
          )
        )
      })
      const payload = (await response.json()) as {
        data?: { workflowId?: string }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to request re-collection')
      const workflowId = payload.data?.workflowId
      if (!workflowId) throw new Error('The re-collection workflow did not return an identifier')
      setStatus({ workflowId })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to request re-collection')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="workspace-recollection-action" aria-live="polite">
      <label>
        <span className="label">Approved campaign</span>
        <select
          value={campaignId}
          disabled={pending}
          onChange={(event) => setCampaignId(event.target.value)}
        >
          {campaigns.map((campaign) => (
            <option key={campaign.campaignId} value={campaign.campaignId}>
              {campaign.campaignName} · {campaign.purpose}
            </option>
          ))}
        </select>
      </label>
      <p className="muted-note">
        This fetches exactly one source-native record through the normal policy, quota, admission,
        and durable workflow gates. It does not restore the deleted row or start analysis.
      </p>
      <button className="quiet-button" type="button" disabled={pending} onClick={submit}>
        {pending ? 'Queueing re-collection...' : 'Request one-record re-collection'}
      </button>
      {status ? (
        <p className="form-success">
          Re-collection queued.{' '}
          <a
            href={`/workspace/${encodeURIComponent(workspaceId)}/research/workflows/${encodeURIComponent(status.workflowId)}`}
          >
            View workflow status
          </a>
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
