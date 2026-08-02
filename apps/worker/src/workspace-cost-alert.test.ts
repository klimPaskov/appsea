import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceCostAlertObservation } from '@appsea/contracts'
import { runWorkspaceCostAlert } from './workspace-cost-alert'

const observedAt = '2026-08-02T12:00:00.000Z'

function observation(
  currency: string,
  actualCostMicros: string,
  estimatedCostMicros: string,
  entryCount = 1
): WorkspaceCostAlertObservation {
  return {
    currency,
    entryCount,
    totalCostMicros: (BigInt(actualCostMicros) + BigInt(estimatedCostMicros)).toString(),
    estimatedCostMicros,
    actualCostMicros
  }
}

describe('workspace cost alert inspection', () => {
  it('scans deterministic workspace order and reports threshold breaches', async () => {
    const assertLease = vi.fn(async () => undefined)
    const listActiveWorkspaceIds = vi.fn(async () => [
      'workspace:zulu',
      'workspace:alpha',
      'workspace:alpha'
    ])
    const listAlertObservations = vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'workspace:alpha') {
        return [observation('USD', '1500000', '200000'), observation('EUR', '100000', '100000')]
      }
      return [observation('USD', '100000', '200000')]
    })

    const result = await runWorkspaceCostAlert(
      {
        observedAt,
        maxWorkspaces: 10,
        maxCurrenciesPerWorkspace: 10,
        periodSeconds: 3_600,
        thresholdCurrency: 'USD',
        actualThresholdMicros: '1000000',
        estimatedThresholdMicros: '150000'
      },
      {
        assertLease,
        workspaces: { listActiveWorkspaceIds },
        costs: { listAlertObservations }
      }
    )

    expect(result).toMatchObject({
      periodStart: '2026-08-02T11:00:00.000Z',
      periodEnd: observedAt,
      workspacesScanned: 2,
      rowsObserved: 3,
      entriesObserved: 3,
      targetCurrencyRows: 2,
      unsupportedCurrencyRows: 1,
      actualTargetCostMicros: '1600000',
      estimatedTargetCostMicros: '400000',
      workspacesOverActualThreshold: 1,
      workspacesOverEstimatedThreshold: 2,
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

  it('keeps capped or non-comparable scans incomplete when no breach is observed', async () => {
    const result = await runWorkspaceCostAlert(
      {
        observedAt,
        maxWorkspaces: 1,
        maxCurrenciesPerWorkspace: 1,
        periodSeconds: 3_600,
        thresholdCurrency: 'USD',
        actualThresholdMicros: '1000000',
        estimatedThresholdMicros: '1000000'
      },
      {
        assertLease: vi.fn(async () => undefined),
        workspaces: {
          listActiveWorkspaceIds: vi.fn(async () => ['workspace:zulu', 'workspace:alpha'])
        },
        costs: {
          listAlertObservations: vi.fn(async () => [observation('EUR', '1', '1')])
        }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 1,
      rowsObserved: 1,
      unsupportedCurrencyRows: 1,
      alerted: false,
      truncated: true,
      state: 'incomplete'
    })
  })

  it('checks the scheduler lease before reads and rejects invalid input', async () => {
    const assertLease = vi.fn(async () => {
      throw new Error('lease lost')
    })
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:alpha'])
    const listAlertObservations = vi.fn(async () => [])

    await expect(
      runWorkspaceCostAlert(
        {
          observedAt,
          maxWorkspaces: 1,
          maxCurrenciesPerWorkspace: 1,
          periodSeconds: 3_600,
          thresholdCurrency: 'USD',
          actualThresholdMicros: '1',
          estimatedThresholdMicros: '1'
        },
        {
          assertLease,
          workspaces: { listActiveWorkspaceIds },
          costs: { listAlertObservations }
        }
      )
    ).rejects.toThrow('lease lost')
    expect(listActiveWorkspaceIds).not.toHaveBeenCalled()
    expect(listAlertObservations).not.toHaveBeenCalled()
    await expect(
      runWorkspaceCostAlert(
        {
          observedAt,
          maxWorkspaces: 0,
          maxCurrenciesPerWorkspace: 1,
          periodSeconds: 3_600,
          thresholdCurrency: 'USD',
          actualThresholdMicros: '1',
          estimatedThresholdMicros: '1'
        },
        {
          assertLease: vi.fn(async () => undefined),
          workspaces: { listActiveWorkspaceIds },
          costs: { listAlertObservations }
        }
      )
    ).rejects.toThrow()
  })
})
