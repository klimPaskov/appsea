'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { ManualImportBatchReadModel } from '@appsea/contracts'
import type { ManualImportCampaignOption } from './[workspaceId]/imports/page'

const MAX_IMPORT_BYTES = 2 * 1024 * 1024

function newIdempotencyKey(): string {
  return `manual-import-${crypto.randomUUID().replaceAll('-', '')}`
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function batchStateLabel(batch: ManualImportBatchReadModel): string {
  if (batch.state === 'staged') return 'Awaiting collection'
  if (batch.state === 'consumed') return 'Collected'
  if (batch.state === 'deleted') return 'Deleted'
  return 'Failed'
}

export function ManualImportActions({
  workspaceId,
  campaigns,
  batches,
  canUpload
}: {
  workspaceId: string
  campaigns: ManualImportCampaignOption[]
  batches: ManualImportBatchReadModel[]
  canUpload: boolean
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaignId ?? '')
  const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [content, setContent] = useState('')
  const [attested, setAttested] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function chooseFile(file: File | undefined): Promise<void> {
    if (!file) return
    setStatus(null)
    setError(null)
    if (file.size > MAX_IMPORT_BYTES) {
      setError('The selected file exceeds the approved 2 MiB limit.')
      return
    }
    const lowerName = file.name.toLocaleLowerCase('en-US')
    const detectedFormat = lowerName.endsWith('.json') ? 'json' : 'csv'
    try {
      const nextContent = await file.text()
      setFileName(file.name)
      setFormat(detectedFormat)
      setContent(nextContent)
      if (!idempotencyKey) setIdempotencyKey(newIdempotencyKey())
    } catch {
      setError('The selected file could not be read in this browser.')
    }
  }

  async function submit(): Promise<void> {
    if (!campaignId) {
      setError('Choose a campaign before staging an import.')
      return
    }
    if (!content || !fileName) {
      setError('Choose a CSV or JSON export before staging an import.')
      return
    }
    if (!attested) {
      setError('Confirm that this workspace is authorized to analyze the export.')
      return
    }
    const requestKey = idempotencyKey || newIdempotencyKey()
    if (!idempotencyKey) setIdempotencyKey(requestKey)
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          filename: fileName,
          format,
          content,
          idempotencyKey: requestKey,
          authorizationAttested: true
        })
      })
      const payload = (await response.json()) as {
        data?: { batch?: { batchId?: string }; workflowId?: string }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to stage the private import')
      setStatus(
        `Staged ${payload.data?.batch?.batchId ?? 'the import'}; collection workflow ${payload.data?.workflowId ?? 'queued'}.`
      )
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to stage the private import')
    } finally {
      setPending(false)
    }
  }

  async function deleteBatch(batch: ManualImportBatchReadModel): Promise<void> {
    if (!window.confirm(`Delete ${batch.filename}? Staged payloads will be cleared.`)) return
    setPending(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/imports/${encodeURIComponent(batch.batchId)}`,
        { method: 'DELETE' }
      )
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to delete the import')
      setStatus(`Deleted ${batch.batchId}; downstream tombstones were recorded.`)
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete the import')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="manual-import-actions" aria-live="polite">
      {canUpload ? (
        <div className="manual-import-form">
          {campaigns.length === 0 ? (
            <p className="empty-state">
              No active production campaign currently allows the owner-import source. Add it to a
              campaign first.
            </p>
          ) : (
            <>
              <label>
                Campaign
                <select
                  value={campaignId}
                  disabled={pending}
                  onChange={(event) => setCampaignId(event.target.value)}
                >
                  {campaigns.map((campaign) => (
                    <option key={campaign.campaignId} value={campaign.campaignId}>
                      {campaign.name} ({campaign.maxSourceItems.toLocaleString('en-US')} records)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Authorized CSV or JSON export
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  disabled={pending}
                  onChange={(event) => void chooseFile(event.target.files?.[0])}
                />
              </label>
              <p className="manual-import-file-note">
                {fileName
                  ? `${fileName} (${format.toUpperCase()}); ${content.length.toLocaleString('en-US')} characters loaded.`
                  : 'The browser reads the file for upload; AppSea does not retain raw upload bytes.'}
              </p>
              <label className="manual-import-attestation">
                <input
                  type="checkbox"
                  checked={attested}
                  disabled={pending}
                  onChange={(event) => setAttested(event.target.checked)}
                />
                <span>I am authorized to let this private workspace analyze this export.</span>
              </label>
              <button className="quiet-button" type="button" disabled={pending} onClick={submit}>
                {pending ? 'Staging import...' : 'Stage private import'}
              </button>
            </>
          )}
        </div>
      ) : null}
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="manual-import-history">
        <div className="section-intro">
          <h2>Import batches</h2>
          <p>Metadata only; source rows are inspected on the private research run.</p>
        </div>
        {batches.length === 0 ? (
          <p className="empty-state">No owner-authorized import batches are recorded.</p>
        ) : (
          <ul className="manual-import-batch-list">
            {batches.map((batch) => (
              <li key={batch.batchId}>
                <div className="manual-import-batch-heading">
                  <div>
                    <h3>{batch.filename}</h3>
                    <p className="complaint-meta">
                      <span>{batch.batchId}</span>
                      <span>{batch.format.toUpperCase()}</span>
                      <span>{batch.recordCount.toLocaleString('en-US')} records</span>
                    </p>
                  </div>
                  <strong>{batchStateLabel(batch)}</strong>
                </div>
                <p className="muted-note">
                  Staged {formatTimestamp(batch.createdAt)}; {batch.warningCount} policy/parser
                  warning{batch.warningCount === 1 ? '' : 's'}. Content hash {batch.contentHash}.
                </p>
                <div className="manual-import-batch-actions">
                  {batch.runId ? (
                    <Link
                      className="quiet-button"
                      href={`/workspace/${workspaceId}/research/${encodeURIComponent(batch.runId)}`}
                    >
                      Inspect collection
                    </Link>
                  ) : null}
                  {canUpload && batch.state !== 'deleted' ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={pending}
                      onClick={() => void deleteBatch(batch)}
                    >
                      Delete batch
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
