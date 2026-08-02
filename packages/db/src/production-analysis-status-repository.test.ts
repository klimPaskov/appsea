import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  authenticatedCalls: [] as Array<{ userId: string; workspaceId: string }>
}))

vi.mock('./transaction', () => ({
  withAuthenticatedWorkspaceTransaction: async (
    _pool: unknown,
    userId: string,
    workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => {
    mocks.authenticatedCalls.push({ userId, workspaceId })
    return operation({ query: mocks.query })
  },
  withWorkspaceTransaction: async (
    _pool: unknown,
    _workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => operation({ query: mocks.query })
}))

const at = '2026-08-02T00:00:00.000Z'

describe('production analysis status projection', () => {
  beforeEach(() => {
    mocks.query.mockReset()
    mocks.authenticatedCalls.length = 0
    mocks.query.mockResolvedValue({
      rows: [
        {
          analysis_run_id: 'analysis:one',
          collection_run_id: 'run:one',
          state: 'running',
          availability_state: 'active',
          opportunity_id: null,
          opportunity_slug: null,
          failure_code: null,
          failure_summary: null,
          requested_at: at,
          started_at: at,
          completed_at: null,
          input_hash: 'a'.repeat(64),
          artifact_object_ref: { uri: 'appsea-object://workspace:one/workflow-artifact/hash' }
        }
      ]
    })
  })

  it('returns a workspace-authorized safe status without hashes or object references', async () => {
    const { PostgresProductionAnalysisRepository } =
      await import('./production-analysis-repository')
    const status = await new PostgresProductionAnalysisRepository(
      {} as never,
      {} as never
    ).readStatusForUser('user:one', 'workspace:one', 'analysis:one')

    expect(status).toEqual({
      analysisRunId: 'analysis:one',
      collectionRunId: 'run:one',
      state: 'running',
      checkpoint: 'persisting',
      activityAttempts: 0,
      availabilityState: 'active',
      opportunityId: null,
      opportunitySlug: null,
      failureCode: null,
      failureSummary: null,
      requestedAt: at,
      startedAt: at,
      completedAt: null
    })
    expect(status).not.toHaveProperty('inputHash')
    expect(status).not.toHaveProperty('artifactObjectRef')
    expect(mocks.authenticatedCalls).toEqual([{ userId: 'user:one', workspaceId: 'workspace:one' }])
    expect(mocks.query.mock.calls[0]?.[0]).toContain("workspace.visibility = 'private'")
  })
})
