import { describe, expect, it, vi } from 'vitest'
import { emitWorkerEvent } from './observability'

describe('worker observability', () => {
  it('emits bounded, secret-free JSON events', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    emitWorkerEvent({
      event: 'workflow_finished',
      taskQueue: 'appsea-research-v1',
      jobId: 'maintenance:source:123',
      workflowId: 'workflow:fixture:one',
      state: 'completed',
      sourceItems: 20,
      costMicros: 0
    })
    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).toMatchObject({
      schemaVersion: 1,
      service: 'appsea-worker',
      event: 'workflow_finished',
      workflowId: 'workflow:fixture:one',
      sourceItems: 20
    })
    expect(payload).not.toHaveProperty('password')
    expect(JSON.stringify(payload)).not.toContain('DATABASE_URL')
    expect(JSON.stringify(payload)).not.toContain('password')
    log.mockRestore()
  })

  it('drops invalid counters instead of logging unsafe values', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    emitWorkerEvent({
      event: 'workflow_failed',
      taskQueue: 'appsea-research-v1',
      attempt: -1,
      sourceItems: Number.NaN,
      costMicros: Number.POSITIVE_INFINITY
    })
    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).not.toHaveProperty('attempt')
    expect(payload).not.toHaveProperty('sourceItems')
    expect(payload).not.toHaveProperty('costMicros')
    log.mockRestore()
  })

  it('keeps maintenance identifiers and counters bounded', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    emitWorkerEvent({
      event: 'source_maintenance_finished',
      taskQueue: 'appsea-source-maintenance-v1',
      jobId: 'maintenance:source:123',
      workspacesScanned: 4,
      deletionTombstonesProcessed: 2,
      deletionObjectsAffected: 8,
      deletionOpportunitiesInvalidated: 1,
      recomputationJobsQueued: 2,
      passwordResetDeliveriesClaimed: 3,
      passwordResetDeliveriesSent: 2,
      passwordResetDeliveriesFailed: 1,
      workspaceInvitationsDeleted: 5,
      productionWorkflowAdmissionsPurged: 6,
      sourceCollectionLeasesPurged: 7,
      workspaceInvitationDeliveriesClaimed: 4,
      workspaceInvitationDeliveriesSent: 3,
      workspaceInvitationDeliveriesFailed: 1
    })
    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).toMatchObject({
      jobId: 'maintenance:source:123',
      workspacesScanned: 4,
      deletionTombstonesProcessed: 2,
      deletionObjectsAffected: 8,
      deletionOpportunitiesInvalidated: 1,
      recomputationJobsQueued: 2,
      passwordResetDeliveriesClaimed: 3,
      passwordResetDeliveriesSent: 2,
      passwordResetDeliveriesFailed: 1,
      workspaceInvitationsDeleted: 5,
      productionWorkflowAdmissionsPurged: 6,
      sourceCollectionLeasesPurged: 7,
      workspaceInvitationDeliveriesClaimed: 4,
      workspaceInvitationDeliveriesSent: 3,
      workspaceInvitationDeliveriesFailed: 1
    })
    expect(JSON.stringify(payload)).not.toContain('source text')
    log.mockRestore()
  })
})
