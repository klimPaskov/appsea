import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { evidenceRedactionMarker } from '@appsea/contracts'
import {
  ClusterReviewConflictError,
  PostgresClusterReviewRepository
} from './cluster-review-repository'

function mockPool(rowsForCluster: unknown[] = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes("set_config('appsea.auth_user_id'")) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes("set_config('appsea.workspace_id'")) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('FROM appsea.workspace_memberships')) {
      return { rows: [{ role: 'owner' }], rowCount: 1 }
    }
    if (sql.includes('FROM appsea.workspaces')) {
      return { rows: [{ one: 1 }], rowCount: 1 }
    }
    if (sql.includes('FROM appsea.opportunity_clusters relation')) {
      return { rows: rowsForCluster, rowCount: rowsForCluster.length }
    }
    if (sql.includes('FROM appsea.cluster_memberships')) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('FROM appsea.cluster_review_events')) {
      return { rows: [], rowCount: 0 }
    }
    throw new Error(`Unexpected query: ${sql}`)
  })
  const client = { query, release: vi.fn() }
  return { pool: { connect: vi.fn(async () => client) } as unknown as Pool, query }
}

describe('PostgresClusterReviewRepository', () => {
  it('masks redacted narrative fields while preserving cluster provenance', async () => {
    const { pool } = mockPool([
      {
        cluster_version_id: 'cluster-version:one',
        cluster_id: 'cluster:one',
        opportunity_id: 'opportunity:one',
        run_id: 'run:one',
        cluster_version: 'production-cluster-v1',
        working_label: 'Private source label',
        problem_statement: 'Private source narrative',
        product: 'Inbox Relay',
        category: 'workflow_gap',
        complaint_count: 2,
        unique_observation_count: 2,
        source_count: 1,
        confidence: 0.8,
        review_state: 'provisional',
        input_hash: 'a'.repeat(64),
        synthetic: false,
        redacted: true
      }
    ])
    const result = await new PostgresClusterReviewRepository(pool).listForUser(
      'user:owner',
      'workspace:one',
      'opportunity:one'
    )
    expect(result[0]).toMatchObject({
      clusterVersionId: 'cluster-version:one',
      workingLabel: evidenceRedactionMarker,
      problemStatement: evidenceRedactionMarker,
      product: evidenceRedactionMarker,
      redacted: true
    })
  })

  it('rejects malformed idempotency before opening a database transaction', async () => {
    const { pool } = mockPool()
    const repository = new PostgresClusterReviewRepository(pool)
    await expect(
      repository.createForUser(
        'user:owner',
        'workspace:one',
        'opportunity:one',
        'cluster-version:one',
        {
          action: 'confirm',
          expectedInputHash: 'a'.repeat(64),
          note: 'Review the boundary.',
          relatedClusterVersionIds: []
        },
        'short'
      )
    ).rejects.toBeInstanceOf(ClusterReviewConflictError)
    expect((pool.connect as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})
