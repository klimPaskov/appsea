import { describe, expect, it } from 'vitest'
import {
  MaintenanceSchedulerLeaseLostError,
  MaintenanceSchedulerLeaseReleaseError,
  maintenanceDatabaseConfigFromEnv,
  maintenanceSchedulerLeaseSecondsFromEnv,
  maintenanceSchedulerMetricsPurgeBatchSizeFromEnv,
  maintenanceSchedulerMetricsRetentionDaysFromEnv,
  maintenanceSchedulerOwnerIdFromEnv,
  maintenanceSchedulerFailureCode,
  runWithMaintenanceSchedulerLease,
  type MaintenanceSchedulerRunMetricsStore,
  type MaintenanceSchedulerLeaseStore
} from './maintenance-scheduler'

function futureLease(): string {
  return new Date(Date.now() + 60_000).toISOString()
}

function fakeLeases(
  options: {
    acquired?: boolean
    renewed?: boolean
    released?: boolean
    releaseThrows?: boolean
    leaseUntil?: string | null
    leaseToken?: string | null
  } = {}
): MaintenanceSchedulerLeaseStore & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    acquire: async (_schedulerName, _ownerId, token) => {
      calls.push('acquire')
      return {
        acquired: options.acquired ?? true,
        leaseUntil: options.leaseUntil !== undefined ? options.leaseUntil : futureLease(),
        leaseToken: options.leaseToken !== undefined ? options.leaseToken : token
      }
    },
    renew: async () => {
      calls.push('renew')
      return {
        renewed: options.renewed ?? true,
        leaseUntil:
          options.leaseUntil !== undefined
            ? options.leaseUntil
            : options.renewed === false
              ? null
              : futureLease()
      }
    },
    release: async () => {
      calls.push('release')
      if (options.releaseThrows) throw new Error('database unavailable')
      return { released: options.released ?? true }
    }
  }
}

function fakeMetrics(): MaintenanceSchedulerRunMetricsStore & {
  records: Array<Record<string, unknown>>
  purges: Array<Record<string, unknown>>
} {
  const records: Array<Record<string, unknown>> = []
  const purges: Array<Record<string, unknown>> = []
  return {
    records,
    purges,
    record: async (input) => {
      records.push(input)
      return { recorded: true }
    },
    purge: async (input) => {
      purges.push(input)
      return 0
    }
  }
}

describe('maintenance scheduler lease wrapper', () => {
  it('skips contended work and releases an owned lease after success', async () => {
    const contended = fakeLeases({ acquired: false, leaseToken: null })
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30
        },
        contended,
        async () => 'not-run'
      )
    ).resolves.toEqual({ acquired: false })
    expect(contended.calls).toEqual(['acquire'])

    const owned = fakeLeases()
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30
        },
        owned,
        async () => 'done'
      )
    ).resolves.toEqual({ acquired: true, result: 'done' })
    expect(owned.calls).toEqual(['acquire', 'renew', 'release'])
  })

  it('records bounded success and contention metrics without lease secrets', async () => {
    const successMetrics = fakeMetrics()
    await expect(
      runWithMaintenanceSchedulerLease<{ sourceItems: number }>(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          metrics: {
            store: successMetrics,
            summarize: (result) => ({ sourceItems: result.sourceItems })
          }
        },
        fakeLeases(),
        async () => ({ sourceItems: 4 })
      )
    ).resolves.toEqual({ acquired: true, result: { sourceItems: 4 } })
    expect(successMetrics.records[0]).toMatchObject({
      schedulerName: 'appsea-source-maintenance-v1',
      ownerId: 'worker:host:1',
      state: 'succeeded',
      failureCode: null,
      counters: { sourceItems: 4 }
    })
    expect(successMetrics.records[0]).not.toHaveProperty('leaseToken')
    expect(successMetrics.purges).toHaveLength(1)

    const contendedMetrics = fakeMetrics()
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          metrics: { store: contendedMetrics }
        },
        fakeLeases({ acquired: false, leaseToken: null }),
        async () => 'not-run'
      )
    ).resolves.toEqual({ acquired: false })
    expect(contendedMetrics.records[0]).toMatchObject({
      state: 'contended',
      failureCode: null,
      counters: {}
    })
  })

  it('passes a private fence identity to work without exposing the token to metrics', async () => {
    const metrics = fakeMetrics()
    let receivedFence: { schedulerName: string; ownerId: string; leaseToken: string } | undefined
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          metrics: { store: metrics }
        },
        fakeLeases(),
        async ({ fence }) => {
          receivedFence = fence
          return 'done'
        }
      )
    ).resolves.toEqual({ acquired: true, result: 'done' })
    expect(receivedFence).toMatchObject({
      schedulerName: 'appsea-source-maintenance-v1',
      ownerId: 'worker:host:1'
    })
    expect(receivedFence?.leaseToken).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/)
    expect(metrics.records[0]).not.toHaveProperty('fence')
    expect(metrics.records[0]).not.toHaveProperty('leaseToken')
  })

  it('persists a fixed failure code while preserving the original work failure', async () => {
    const metrics = fakeMetrics()
    const workError = new Error('database secret must never be persisted')
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          metrics: {
            store: metrics,
            failureCode: () => 'APPSEA_SOURCE_MAINTENANCE_FAILED'
          }
        },
        fakeLeases(),
        async () => {
          throw workError
        }
      )
    ).rejects.toBe(workError)
    expect(metrics.records[0]).toMatchObject({
      state: 'failed',
      failureCode: 'APPSEA_SOURCE_MAINTENANCE_FAILED',
      counters: {}
    })
  })

  it('fails closed when renewal is lost and still releases by token', async () => {
    const leases = fakeLeases({ renewed: false })
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          renewEveryMs: 1_000
        },
        leases,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1_050))
          return 'unsafe'
        }
      )
    ).rejects.toBeInstanceOf(MaintenanceSchedulerLeaseLostError)
    expect(leases.calls).toEqual(['acquire', 'renew', 'release'])
  })

  it('rejects malformed or expired acquisition responses', async () => {
    const malformed = fakeLeases({ leaseUntil: null })
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30
        },
        malformed,
        async () => 'unsafe'
      )
    ).rejects.toBeInstanceOf(MaintenanceSchedulerLeaseLostError)
    expect(malformed.calls).toEqual(['acquire', 'release'])
  })

  it('normalizes release failures and suppresses success after lease loss', async () => {
    const releaseFailure = fakeLeases({ releaseThrows: true })
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30
        },
        releaseFailure,
        async () => 'done'
      )
    ).rejects.toBeInstanceOf(MaintenanceSchedulerLeaseReleaseError)
    expect(
      maintenanceSchedulerFailureCode(new MaintenanceSchedulerLeaseReleaseError('x'), 'fallback')
    ).toBe('APPSEA_MAINTENANCE_SCHEDULER_LEASE_RELEASE_FAILED')
    const fenceError = new Error('fence rejected')
    fenceError.name = 'MaintenanceSchedulerFenceError'
    expect(maintenanceSchedulerFailureCode(fenceError, 'fallback')).toBe(
      'APPSEA_MAINTENANCE_SCHEDULER_LEASE_LOST'
    )
  })

  it('requires explicit production and environment identities and bounds lease configuration', () => {
    expect(() => maintenanceSchedulerOwnerIdFromEnv({ NODE_ENV: 'production' })).toThrow(/OWNER_ID/)
    expect(() => maintenanceSchedulerOwnerIdFromEnv({ NODE_ENV: 'staging' })).toThrow(/OWNER_ID/)
    expect(maintenanceSchedulerOwnerIdFromEnv({ NODE_ENV: 'development' })).toMatch(
      /^appsea-local:/
    )
    expect(
      maintenanceSchedulerOwnerIdFromEnv({
        NODE_ENV: 'production',
        APPSEA_SCHEDULER_OWNER_ID: 'worker:prod-1'
      })
    ).toBe('worker:prod-1')
    expect(
      maintenanceSchedulerLeaseSecondsFromEnv({ APPSEA_MAINTENANCE_LEASE_SECONDS: '60' })
    ).toBe(60)
    expect(
      maintenanceSchedulerMetricsRetentionDaysFromEnv({
        APPSEA_MAINTENANCE_METRICS_RETENTION_DAYS: '45'
      })
    ).toBe(45)
    expect(
      maintenanceSchedulerMetricsPurgeBatchSizeFromEnv({
        APPSEA_MAINTENANCE_METRICS_PURGE_BATCH_SIZE: '250'
      })
    ).toBe(250)
    expect(() =>
      maintenanceSchedulerLeaseSecondsFromEnv({ APPSEA_MAINTENANCE_LEASE_SECONDS: '29' })
    ).toThrow(/between 30 and 3600/)
    expect(() => maintenanceDatabaseConfigFromEnv({ NODE_ENV: 'development' })).toThrow(
      /MAINTENANCE_DATABASE_URL/
    )
  })

  it('does not allow a renewal interval beyond half the lease window', async () => {
    await expect(
      runWithMaintenanceSchedulerLease(
        {
          schedulerName: 'appsea-source-maintenance-v1',
          ownerId: 'worker:host:1',
          leaseSeconds: 30,
          renewEveryMs: 15_001
        },
        fakeLeases(),
        async () => 'not-run'
      )
    ).rejects.toThrow(/at most half the lease window/)
  })
})
