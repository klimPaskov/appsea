import { describe, expect, it } from 'vitest'
import { workspaceClusterReviewInputSchema, workspaceClusterReviewSnapshotSchema } from './index'

const hash = 'a'.repeat(64)
const base = {
  expectedInputHash: hash,
  note: 'Reviewed the retained observations and cluster boundary.'
}

describe('cluster review contracts', () => {
  it('accepts confirm and split actions with bounded lineage', () => {
    expect(workspaceClusterReviewInputSchema.parse({ action: 'confirm', ...base })).toMatchObject({
      action: 'confirm',
      relatedClusterVersionIds: []
    })
    expect(
      workspaceClusterReviewInputSchema.parse({
        action: 'split',
        ...base,
        relatedClusterVersionIds: ['cluster:v1', 'cluster:v2']
      }).relatedClusterVersionIds
    ).toHaveLength(2)
  })

  it('rejects unknown fields, duplicate lineage, and raw snapshot content', () => {
    expect(() =>
      workspaceClusterReviewInputSchema.parse({ ...base, action: 'confirm', unexpected: true })
    ).toThrow()
    expect(() =>
      workspaceClusterReviewInputSchema.parse({
        ...base,
        action: 'merge',
        relatedClusterVersionIds: ['cluster:v1', 'cluster:v1']
      })
    ).toThrow()
    expect(() =>
      workspaceClusterReviewSnapshotSchema.parse({
        workspaceId: 'workspace:one',
        clusterVersionId: 'cluster:v1',
        clusterId: 'cluster:one',
        opportunityId: 'opportunity:one',
        runId: 'run:one',
        previousReviewState: 'provisional',
        nextReviewState: 'confirmed',
        inputHash: hash,
        complaintIds: ['complaint:one'],
        membershipReviewStates: [{ complaintId: 'complaint:one', reviewState: 'unreviewed' }],
        relatedClusterVersionIds: [],
        snapshotHash: hash,
        capturedAt: new Date().toISOString(),
        rawComplaintText: 'must never be persisted'
      })
    ).toThrow()
  })
})
