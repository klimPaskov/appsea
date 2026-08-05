'use client'

import { useState } from 'react'
import type { WorkspaceClusterReadModel, WorkspaceClusterReviewAction } from '@appsea/contracts'

const actionLabels: Record<WorkspaceClusterReviewAction, string> = {
  confirm: 'Confirm cluster',
  reject: 'Reject cluster',
  split: 'Record split',
  merge: 'Record merge'
}

function stateLabel(value: WorkspaceClusterReadModel['reviewState']): string {
  return value.replace('-', ' ')
}

export function ClusterReviewActions({
  workspaceId,
  slug,
  role,
  synthetic,
  initialClusters
}: {
  workspaceId: string
  slug: string
  role: 'owner' | 'editor' | 'viewer'
  synthetic: boolean
  initialClusters: WorkspaceClusterReadModel[]
}) {
  const [clusters, setClusters] = useState(initialClusters)
  const [note, setNote] = useState('')
  const [related, setRelated] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canMutate = !synthetic && (role === 'owner' || role === 'editor')

  async function submit(cluster: WorkspaceClusterReadModel, action: WorkspaceClusterReviewAction) {
    const trimmedNote = note.trim()
    if (!trimmedNote) {
      setError('Record why this cluster boundary is correct.')
      return
    }
    const relatedClusterVersionIds = related
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if ((action === 'split' || action === 'merge') && relatedClusterVersionIds.length < 2) {
      setError('Split and merge reviews require at least two related cluster version IDs.')
      return
    }
    setPending(`${cluster.clusterVersionId}:${action}`)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/opportunities/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(cluster.clusterVersionId)}/reviews`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID()
          },
          body: JSON.stringify({
            action,
            expectedInputHash: cluster.inputHash,
            note: trimmedNote,
            relatedClusterVersionIds:
              action === 'confirm' || action === 'reject' ? [] : relatedClusterVersionIds
          })
        }
      )
      const payload = (await response.json()) as {
        cluster?: WorkspaceClusterReadModel | null
        error?: string
      }
      if (!response.ok || !payload.cluster)
        throw new Error(payload.error ?? 'Unable to review cluster')
      setClusters((current) =>
        current.map((entry) =>
          entry.clusterVersionId === payload.cluster!.clusterVersionId ? payload.cluster! : entry
        )
      )
      setNote('')
      setRelated('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to review cluster')
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      className="workspace-section cluster-review-panel"
      aria-labelledby="cluster-review-heading"
    >
      <div className="section-intro">
        <div>
          <p className="eyebrow">Analysis curation</p>
          <h2 id="cluster-review-heading">Complaint clusters</h2>
        </div>
        <p>
          {clusters.length} versioned cluster{clusters.length === 1 ? '' : 's'} - deep research
          requires review
        </p>
      </div>
      {synthetic ? (
        <p className="fixture-note">
          Fixture clusters are visible for orientation but are read-only and cannot support market
          conclusions.
        </p>
      ) : !canMutate ? (
        <p className="decision-note">
          Editors and owners can curate cluster boundaries after step-up verification.
        </p>
      ) : null}
      {clusters.length === 0 ? (
        <p className="empty-state">No complaint clusters are linked to this opportunity.</p>
      ) : null}
      <ol className="cluster-review-list">
        {clusters.map((cluster) => (
          <li key={cluster.clusterVersionId} className="cluster-review-card">
            <div className="cluster-review-heading">
              <div>
                <p className="review-state">{stateLabel(cluster.reviewState)}</p>
                <h3>{cluster.workingLabel}</h3>
              </div>
              <span className="cluster-review-count">{cluster.complaintCount} complaints</span>
            </div>
            <p className="cluster-review-problem">{cluster.problemStatement}</p>
            <div className="complaint-meta">
              <span>{cluster.product}</span>
              <span>{cluster.category}</span>
              <span>
                {cluster.sourceCount} source{cluster.sourceCount === 1 ? '' : 's'}
              </span>
              <span>
                {
                  cluster.memberships.filter((membership) => membership.reviewState === 'confirmed')
                    .length
                }{' '}
                memberships confirmed
              </span>
            </div>
            <p className="cluster-review-lineage">
              Version {cluster.clusterVersion} - input {cluster.inputHash.slice(0, 12)}...
            </p>
            {cluster.redacted ? (
              <p className="fixture-note">
                Narrative fields are masked by workspace privacy policy.
              </p>
            ) : null}
            {canMutate &&
            (cluster.reviewState === 'provisional' || cluster.reviewState === 'reviewed') ? (
              <div className="cluster-review-form">
                <label htmlFor={`cluster-note-${cluster.clusterVersionId}`}>Review note</label>
                <textarea
                  id={`cluster-note-${cluster.clusterVersionId}`}
                  rows={2}
                  maxLength={2_000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Explain the boundary or correction."
                />
                <label htmlFor={`cluster-related-${cluster.clusterVersionId}`}>
                  Related cluster version IDs for split or merge
                </label>
                <input
                  id={`cluster-related-${cluster.clusterVersionId}`}
                  value={related}
                  onChange={(event) => setRelated(event.target.value)}
                  placeholder="cluster-version:other, cluster-version:next"
                />
                <div className="review-actions">
                  {(Object.keys(actionLabels) as WorkspaceClusterReviewAction[]).map((action) => {
                    const key = `${cluster.clusterVersionId}:${action}`
                    return (
                      <button
                        className="quiet-button"
                        type="button"
                        key={action}
                        disabled={pending !== null}
                        onClick={() => submit(cluster, action)}
                      >
                        {pending === key ? 'Recording...' : actionLabels[action]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {cluster.reviewHistory.length > 0 ? (
              <ol className="cluster-review-history">
                {cluster.reviewHistory.slice(0, 4).map((entry) => (
                  <li key={entry.reviewId}>
                    <strong>{actionLabels[entry.action]}</strong> - {entry.previousReviewState}{' '}
                    -&gt; {entry.nextReviewState} - {entry.actorId}
                    <p>{entry.note}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
