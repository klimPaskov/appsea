import { describe, expect, it, vi } from 'vitest'
import type { ProductionAnalysisRecomputeAlertObservation } from '@appsea/contracts'
import { runProductionAnalysisRecomputeAlert } from './production-analysis-recompute-alert'

const observedAt = '2026-08-02T12:00:00.000Z'

function observation(
  state: ProductionAnalysisRecomputeAlertObservation['state'],
  requestedAt: string,
  updatedAt = requestedAt
): ProductionAnalysisRecomputeAlertObservation {
  return {
    state,
    attemptCount: 1,
    requestedAt,
    nextAttemptAt: requestedAt,
    updatedAt
  }
}

describe('production analysis recomputation alert inspection', () => {
  it('scans deterministic workspace order and counts failures, blocks, and stale jobs', async () => {
    const assertLease = vi.fn(async () => undefined)
    const listActiveWorkspaceIds = vi.fn(async () => [
      'workspace:zulu',
      'workspace:alpha',
      'workspace:alpha'
    ])
    const listAlertObservations = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'workspace:alpha') {
        return [
          observation('queued', '2026-08-02T11:00:00.000Z', '2026-08-02T11:40:00.000Z'),
          observation('failed', '2026-08-02T11:50:00.000Z'),
          observation('blocked', '2026-08-02T11:55:00.000Z')
        ]
      }
      return []
    })

    const result = await runProductionAnalysisRecomputeAlert(
      {
        observedAt,
        maxWorkspaces: 10,
        maxJobsPerWorkspace: 10,
        alertAfterSeconds: 900
      },
      {
        assertLease,
        workspaces: { listActiveWorkspaceIds },
        observations: { listAlertObservations }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 2,
      jobsObserved: 3,
      failedJobs: 1,
      blockedJobs: 1,
      staleJobs: 1,
      oldestOpenJobAgeSeconds: 3_600,
      alerted: true,
      truncated: false,
      state: 'alert'
    })
    expect(listAlertObservations.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'workspace:alpha',
      'workspace:zulu'
    ])
    expect(assertLease).toHaveBeenCalledTimes(4)
  })

  it('keeps a capped scan incomplete when no observed job proves an alert', async () => {
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:zulu', 'workspace:alpha'])
    const listAlertObservations = vi.fn(async () => [
      observation('queued', '2026-08-02T11:59:00.000Z')
    ])

    const result = await runProductionAnalysisRecomputeAlert(
      {
        observedAt,
        maxWorkspaces: 1,
        maxJobsPerWorkspace: 1,
        alertAfterSeconds: 900
      },
      {
        assertLease: vi.fn(async () => undefined),
        workspaces: { listActiveWorkspaceIds },
        observations: { listAlertObservations }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 1,
      jobsObserved: 1,
      failedJobs: 0,
      blockedJobs: 0,
      staleJobs: 0,
      oldestOpenJobAgeSeconds: 60,
      alerted: false,
      truncated: true,
      state: 'incomplete'
    })
    expect(listAlertObservations).toHaveBeenCalledTimes(1)
  })

  it('checks the scheduler lease before reads and rejects invalid input', async () => {
    const assertLease = vi.fn(async () => {
      throw new Error('lease lost')
    })
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:alpha'])
    const listAlertObservations = vi.fn(async () => [])

    await expect(
      runProductionAnalysisRecomputeAlert(
        {
          observedAt,
          maxWorkspaces: 1,
          maxJobsPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease,
          workspaces: { listActiveWorkspaceIds },
          observations: { listAlertObservations }
        }
      )
    ).rejects.toThrow('lease lost')
    expect(listActiveWorkspaceIds).not.toHaveBeenCalled()
    expect(listAlertObservations).not.toHaveBeenCalled()
    await expect(
      runProductionAnalysisRecomputeAlert(
        {
          observedAt,
          maxWorkspaces: 0,
          maxJobsPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease: vi.fn(async () => undefined),
          workspaces: { listActiveWorkspaceIds },
          observations: { listAlertObservations }
        }
      )
    ).rejects.toThrow()
  })
})
