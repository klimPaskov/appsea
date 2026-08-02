import { describe, expect, it, vi } from 'vitest'
import { runProductionWorkflowCancellation } from './production-workflow-cancellation-runner'

const workflowId = 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('production workflow cancellation runner', () => {
  it('retries active durable intents with a bounded lease-aware pass', async () => {
    const cancelWorkflow = vi.fn().mockResolvedValue(undefined)
    const assertLease = vi.fn().mockResolvedValue(undefined)
    const result = await runProductionWorkflowCancellation(
      { batchSize: 1, assertLease },
      {
        workflows: {
          listWorkspaceIdsForService: vi.fn().mockResolvedValue(['workspace:one']),
          listCancellationTargetsForService: vi.fn().mockResolvedValue([workflowId]),
          prepareCancellationForService: vi.fn().mockResolvedValue({
            workspaceId: 'workspace:one',
            workflowId
          })
        },
        cancelWorkflow
      }
    )

    expect(result).toEqual({
      workspacesScanned: 1,
      targets: 1,
      attempted: 1,
      dispatched: 1,
      failed: 0
    })
    expect(cancelWorkflow).toHaveBeenCalledWith(workflowId)
    expect(assertLease).toHaveBeenCalledTimes(2)
  })

  it('keeps the durable intent pending when Temporal is unavailable', async () => {
    const cancelWorkflow = vi.fn().mockRejectedValue(new Error('Temporal unavailable'))
    const result = await runProductionWorkflowCancellation(
      { batchSize: 1 },
      {
        workflows: {
          listWorkspaceIdsForService: vi.fn().mockResolvedValue(['workspace:one']),
          listCancellationTargetsForService: vi.fn().mockResolvedValue([workflowId]),
          prepareCancellationForService: vi.fn().mockResolvedValue({
            workspaceId: 'workspace:one',
            workflowId
          })
        },
        cancelWorkflow
      }
    )

    expect(result).toMatchObject({ attempted: 1, dispatched: 0, failed: 1 })
  })

  it('does not call the provider for a target reconciled by the workflow', async () => {
    const cancelWorkflow = vi.fn()
    const result = await runProductionWorkflowCancellation(
      { batchSize: 1 },
      {
        workflows: {
          listWorkspaceIdsForService: vi.fn().mockResolvedValue(['workspace:one']),
          listCancellationTargetsForService: vi.fn().mockResolvedValue([workflowId]),
          prepareCancellationForService: vi.fn().mockResolvedValue(null)
        },
        cancelWorkflow
      }
    )

    expect(result).toMatchObject({ targets: 1, attempted: 0, dispatched: 0, failed: 0 })
    expect(cancelWorkflow).not.toHaveBeenCalled()
  })
})
