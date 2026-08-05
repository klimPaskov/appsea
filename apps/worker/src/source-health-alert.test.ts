import { describe, expect, it, vi } from 'vitest'
import type { SourceHealthAlertObservation } from '@appsea/contracts'
import { runSourceHealthAlert } from './source-health-alert'

const observedAt = '2026-08-06T12:00:00.000Z'

function observation(
  sourceId: string,
  overrides: Partial<SourceHealthAlertObservation> = {}
): SourceHealthAlertObservation {
  return {
    sourceId,
    collectible: true,
    healthState: 'healthy',
    healthLastAttemptAt: '2026-08-06T11:59:00.000Z',
    freshnessState: 'fresh',
    freshnessAgeHours: 1,
    quotaState: 'available',
    ...overrides
  }
}

describe('source health alert inspection', () => {
  it('scans deterministic workspace order and reports stale, exhausted, and aged degraded sources', async () => {
    const assertLease = vi.fn(async () => undefined)
    const listActiveWorkspaceIds = vi.fn(async () => [
      'workspace:zulu',
      'workspace:alpha',
      'workspace:alpha'
    ])
    const listSourceHealthAlertObservations = vi.fn(async (workspaceId: string, limit?: number) => {
      void limit
      if (workspaceId === 'workspace:alpha') {
        return [
          observation('source:stale', { freshnessState: 'stale', freshnessAgeHours: 40 }),
          observation('source:exhausted', { quotaState: 'exhausted' }),
          observation('source:degraded', {
            healthState: 'degraded',
            healthLastAttemptAt: '2026-08-06T10:00:00.000Z'
          })
        ]
      }
      return [
        observation('source:blocked', { collectible: false, healthState: 'blocked' }),
        observation('source:unknown', {
          healthState: 'unknown',
          freshnessState: 'unknown',
          quotaState: 'unknown',
          healthLastAttemptAt: null,
          freshnessAgeHours: null
        })
      ]
    })

    const result = await runSourceHealthAlert(
      {
        observedAt,
        maxWorkspaces: 10,
        maxSourcesPerWorkspace: 10,
        alertAfterSeconds: 900
      },
      {
        assertLease,
        workspaces: { listActiveWorkspaceIds },
        observations: { listSourceHealthAlertObservations }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 2,
      sourcesObserved: 5,
      collectibleSources: 4,
      blockedSources: 1,
      unknownSources: 1,
      degradedSources: 1,
      staleSources: 1,
      exhaustedSources: 1,
      oldestDegradedAgeSeconds: 7_200,
      alerted: true,
      truncated: false,
      state: 'alert'
    })
    expect(
      listSourceHealthAlertObservations.mock.calls.map(([workspaceId]) => workspaceId)
    ).toEqual(['workspace:alpha', 'workspace:zulu'])
    expect(listSourceHealthAlertObservations.mock.calls.every(([, limit]) => limit === 10)).toBe(
      true
    )
    expect(assertLease).toHaveBeenCalledTimes(4)
  })

  it('keeps a capped scan incomplete when no source proves an alert', async () => {
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:zulu', 'workspace:alpha'])
    const listSourceHealthAlertObservations = vi.fn(async () => [observation('source:one')])

    const result = await runSourceHealthAlert(
      {
        observedAt,
        maxWorkspaces: 1,
        maxSourcesPerWorkspace: 1,
        alertAfterSeconds: 900
      },
      {
        assertLease: vi.fn(async () => undefined),
        workspaces: { listActiveWorkspaceIds },
        observations: { listSourceHealthAlertObservations }
      }
    )

    expect(result).toMatchObject({
      workspacesScanned: 1,
      sourcesObserved: 1,
      alerted: false,
      truncated: true,
      state: 'incomplete'
    })
    expect(listSourceHealthAlertObservations).toHaveBeenCalledTimes(1)
  })

  it('checks the lease before reading source health and rejects invalid input', async () => {
    const assertLease = vi.fn(async () => {
      throw new Error('lease lost')
    })
    const listActiveWorkspaceIds = vi.fn(async () => ['workspace:alpha'])
    const listSourceHealthAlertObservations = vi.fn(async () => [])

    await expect(
      runSourceHealthAlert(
        {
          observedAt,
          maxWorkspaces: 1,
          maxSourcesPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease,
          workspaces: { listActiveWorkspaceIds },
          observations: { listSourceHealthAlertObservations }
        }
      )
    ).rejects.toThrow('lease lost')
    expect(listActiveWorkspaceIds).not.toHaveBeenCalled()
    expect(listSourceHealthAlertObservations).not.toHaveBeenCalled()
    await expect(
      runSourceHealthAlert(
        {
          observedAt,
          maxWorkspaces: 0,
          maxSourcesPerWorkspace: 1,
          alertAfterSeconds: 900
        },
        {
          assertLease: vi.fn(async () => undefined),
          workspaces: { listActiveWorkspaceIds },
          observations: { listSourceHealthAlertObservations }
        }
      )
    ).rejects.toThrow()
  })
})
