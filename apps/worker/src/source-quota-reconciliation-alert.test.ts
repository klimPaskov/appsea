import { describe, expect, it, vi } from 'vitest'
import type { SourceQuotaReconciliationCase } from '@appsea/contracts'
import { runSourceQuotaReconciliationAlert } from './source-quota-reconciliation-alert'

const observedAt = '2026-08-02T12:00:00.000Z'

function openCase(workspaceId: string, firstSeenAt: string): SourceQuotaReconciliationCase {
  return {
    workspaceId,
    reservationId: `quota:source:${workspaceId.replace(':', '-')}`,
    sourceId: 'source:fixture',
    policyVersion: 'policy-v1',
    runId: `run:${workspaceId.replace(':', '-')}`,
    requestedRecords: 1,
    requestedCostMicros: 1,
    actualRecords: null,
    actualCostMicros: null,
    state: 'open',
    firstSeenAt,
    lastSeenAt: firstSeenAt,
    resolutionCode: null,
    linkedRunId: null,
    resolutionActorId: null,
    resolvedAt: null
  }
}

describe('source quota reconciliation alert inspection', () => {
  it('scans deterministic workspace order and reports the oldest open case', async () => {
    const assertLease = vi.fn(async () => undefined)
    const listActiveWorkspaceIds = vi.fn(async () => [
      'workspace:zulu',
      'workspace:alpha',
      'workspace:alpha'
    ])
    const listReconciliationCases = vi.fn(
      async (workspaceId: string, query?: { limit: number }) => {
        void query
        return workspaceId === 'workspace:alpha'
          ? [openCase(workspaceId, '2026-08-02T11:40:00.000Z')]
          : []
      }
    )

    const result = await runSourceQuotaReconciliationAlert(
      {
        observedAt,
        maxWorkspaces: 10,
        maxCasesPerWorkspace: 10,
        alertAfterSeconds: 900
      },
      {
        assertLease,
        workspaces: { listActiveWorkspaceIds },
        cases: { listReconciliationCases }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 2,
      openCases: 1,
      oldestOpenCaseAgeSeconds: 1_200,
      alerted: true,
      truncated: false,
      state: 'alert'
    })
    expect(listReconciliationCases.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'workspace:alpha',
      'workspace:zulu'
    ])
    expect(listReconciliationCases.mock.calls.every(([, query]) => query?.limit === 10)).toBe(true)
    expect(assertLease).toHaveBeenCalledTimes(4)
  })

  it('marks capped scans incomplete unless an old case already proves an alert', async () => {
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:zulu', 'workspace:alpha'])
    const listReconciliationCases = vi.fn(async (workspaceId: string) => [
      openCase(workspaceId, '2026-08-02T11:59:00.000Z'),
      openCase(workspaceId, '2026-08-02T11:40:00.000Z')
    ])

    const incomplete = await runSourceQuotaReconciliationAlert(
      {
        observedAt,
        maxWorkspaces: 1,
        maxCasesPerWorkspace: 1,
        alertAfterSeconds: 900
      },
      {
        assertLease: vi.fn(async () => undefined),
        workspaces: { listActiveWorkspaceIds },
        cases: { listReconciliationCases }
      }
    )

    expect(incomplete).toMatchObject({
      workspacesScanned: 1,
      openCases: 2,
      oldestOpenCaseAgeSeconds: 1_200,
      alerted: true,
      truncated: true,
      state: 'alert'
    })
    expect(listReconciliationCases).toHaveBeenCalledTimes(1)
  })

  it('checks the scheduler lease before privileged reads and rejects invalid input', async () => {
    const assertLease = vi.fn(async () => {
      throw new Error('lease lost')
    })
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:alpha'])
    const listReconciliationCases = vi.fn(async () => [])

    await expect(
      runSourceQuotaReconciliationAlert(
        {
          observedAt,
          maxWorkspaces: 1,
          maxCasesPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease,
          workspaces: { listActiveWorkspaceIds },
          cases: { listReconciliationCases }
        }
      )
    ).rejects.toThrow('lease lost')
    expect(listActiveWorkspaceIds).not.toHaveBeenCalled()
    expect(listReconciliationCases).not.toHaveBeenCalled()
    await expect(
      runSourceQuotaReconciliationAlert(
        {
          observedAt,
          maxWorkspaces: 0,
          maxCasesPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease: vi.fn(async () => undefined),
          workspaces: { listActiveWorkspaceIds },
          cases: { listReconciliationCases }
        }
      )
    ).rejects.toThrow()
  })
})
