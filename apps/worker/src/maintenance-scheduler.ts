import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  databaseConfigFromEnv,
  maintenanceSchedulerLeaseLimits,
  type DatabaseConfig
} from '@appsea/db'
import {
  maintenanceSchedulerLeaseResultSchema,
  maintenanceSchedulerLeaseTokenSchema,
  maintenanceSchedulerNameSchema,
  maintenanceSchedulerOwnerIdSchema,
  maintenanceSchedulerRenewResultSchema,
  maintenanceSchedulerReleaseResultSchema,
  type MaintenanceSchedulerLeaseToken
} from '@appsea/contracts'

export interface MaintenanceSchedulerLeaseStore {
  acquire(
    schedulerName: string,
    ownerId: string,
    leaseToken: string,
    leaseSeconds: number
  ): Promise<{ acquired: boolean; leaseUntil: string | null; leaseToken: string | null }>
  renew(
    schedulerName: string,
    ownerId: string,
    leaseToken: string,
    leaseSeconds: number
  ): Promise<{ renewed: boolean; leaseUntil: string | null }>
  release(
    schedulerName: string,
    ownerId: string,
    leaseToken: string
  ): Promise<{ released: boolean }>
}

export interface MaintenanceSchedulerLeaseOptions {
  schedulerName: string
  ownerId: string
  leaseSeconds: number
  renewEveryMs?: number
}

export interface MaintenanceSchedulerLeaseContext {
  /** Check the server-backed lease before a privileged mutation or delivery. */
  assertLease(): Promise<void>
}

export class MaintenanceSchedulerLeaseLostError extends Error {
  constructor(schedulerName: string) {
    super(`Maintenance scheduler lease was lost: ${schedulerName}`)
    this.name = 'MaintenanceSchedulerLeaseLostError'
  }
}

export class MaintenanceSchedulerLeaseReleaseError extends Error {
  constructor(schedulerName: string) {
    super(`Maintenance scheduler lease could not be released: ${schedulerName}`)
    this.name = 'MaintenanceSchedulerLeaseReleaseError'
  }
}

export function maintenanceSchedulerFailureCode(error: unknown, fallback: string): string {
  if (error instanceof MaintenanceSchedulerLeaseLostError) {
    return 'APPSEA_MAINTENANCE_SCHEDULER_LEASE_LOST'
  }
  if (error instanceof MaintenanceSchedulerLeaseReleaseError) {
    return 'APPSEA_MAINTENANCE_SCHEDULER_LEASE_RELEASE_FAILED'
  }
  return fallback
}

export function maintenanceSchedulerOwnerIdFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const configured = environment.APPSEA_SCHEDULER_OWNER_ID?.trim()
  if (configured) return maintenanceSchedulerOwnerIdSchema.parse(configured)
  if (!['development', 'test'].includes(environment.NODE_ENV ?? '')) {
    throw new Error(
      'APPSEA_SCHEDULER_OWNER_ID is required unless NODE_ENV is explicitly development or test'
    )
  }
  const localHost = hostname().replace(/[^a-zA-Z0-9._:-]/g, '-')
  const localOwner = `appsea-local:${localHost}:${process.pid}:${randomUUID()}`
  return maintenanceSchedulerOwnerIdSchema.parse(localOwner)
}

export function maintenanceDatabaseConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  const connectionString = environment.APPSEA_MAINTENANCE_DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('APPSEA_MAINTENANCE_DATABASE_URL is required for maintenance commands')
  }
  return databaseConfigFromEnv({
    ...environment,
    DATABASE_URL: connectionString,
    APPSEA_DATABASE_APPLICATION_NAME:
      environment.APPSEA_MAINTENANCE_DATABASE_APPLICATION_NAME ?? 'appsea-maintenance'
  })
}

export function maintenanceSchedulerLeaseSecondsFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const value = Number(
    environment.APPSEA_MAINTENANCE_LEASE_SECONDS ??
      String(maintenanceSchedulerLeaseLimits.defaultLeaseSeconds)
  )
  if (
    !Number.isSafeInteger(value) ||
    value < maintenanceSchedulerLeaseLimits.minLeaseSeconds ||
    value > maintenanceSchedulerLeaseLimits.maxLeaseSeconds
  ) {
    throw new Error('APPSEA_MAINTENANCE_LEASE_SECONDS must be an integer between 30 and 3600')
  }
  return value
}

function validatedOptions(
  options: MaintenanceSchedulerLeaseOptions
): MaintenanceSchedulerLeaseOptions {
  const schedulerName = maintenanceSchedulerNameSchema.parse(options.schedulerName)
  const ownerId = maintenanceSchedulerOwnerIdSchema.parse(options.ownerId)
  if (
    !Number.isSafeInteger(options.leaseSeconds) ||
    options.leaseSeconds < maintenanceSchedulerLeaseLimits.minLeaseSeconds ||
    options.leaseSeconds > maintenanceSchedulerLeaseLimits.maxLeaseSeconds
  ) {
    throw new Error('leaseSeconds must be an integer between 30 and 3600')
  }
  const renewEveryMs =
    options.renewEveryMs ?? Math.max(1_000, Math.floor((options.leaseSeconds * 1_000) / 3))
  if (
    !Number.isSafeInteger(renewEveryMs) ||
    renewEveryMs < 1_000 ||
    renewEveryMs > Math.floor((options.leaseSeconds * 1_000) / 2)
  ) {
    throw new Error(
      'renewEveryMs must be at most half the lease window and at least 1000 milliseconds'
    )
  }
  return { schedulerName, ownerId, leaseSeconds: options.leaseSeconds, renewEveryMs }
}

function assertFutureLeaseUntil(value: string | null, schedulerName: string): void {
  // The database function validates the expiry against PostgreSQL's server
  // clock. This local check is conservative; an immediate server-backed
  // renewal below confirms the lease before any privileged work begins.
  if (!value || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) {
    throw new MaintenanceSchedulerLeaseLostError(schedulerName)
  }
}

export type MaintenanceSchedulerLeaseRun<T> = { acquired: false } | { acquired: true; result: T }

export async function runWithMaintenanceSchedulerLease<T>(
  options: MaintenanceSchedulerLeaseOptions,
  leases: MaintenanceSchedulerLeaseStore,
  work: (context: MaintenanceSchedulerLeaseContext) => Promise<T>
): Promise<MaintenanceSchedulerLeaseRun<T>> {
  const parsed = validatedOptions(options)
  const leaseToken: MaintenanceSchedulerLeaseToken =
    maintenanceSchedulerLeaseTokenSchema.parse(randomUUID())
  const releaseAfterAcquisitionFailure = async (): Promise<void> => {
    try {
      await leases.release(parsed.schedulerName, parsed.ownerId, leaseToken)
    } catch {
      // The lease has a bounded expiry; a malformed response must never make
      // cleanup failure replace the fixed lease-loss signal.
    }
  }
  let acquired: ReturnType<typeof maintenanceSchedulerLeaseResultSchema.parse>
  try {
    acquired = maintenanceSchedulerLeaseResultSchema.parse(
      await leases.acquire(parsed.schedulerName, parsed.ownerId, leaseToken, parsed.leaseSeconds)
    )
  } catch {
    await releaseAfterAcquisitionFailure()
    throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
  }
  if (!acquired.acquired) return { acquired: false }
  try {
    if (acquired.leaseToken !== leaseToken) {
      throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    }
    assertFutureLeaseUntil(acquired.leaseUntil, parsed.schedulerName)
  } catch (error) {
    await releaseAfterAcquisitionFailure()
    throw error
  }

  let leaseLost = false
  let renewal: Promise<void> | undefined
  let lastRenewalAt = Date.now()
  const renewNow = async (): Promise<void> => {
    if (renewal) return renewal
    renewal = (async () => {
      try {
        const result = maintenanceSchedulerRenewResultSchema.parse(
          await leases.renew(parsed.schedulerName, parsed.ownerId, leaseToken, parsed.leaseSeconds)
        )
        if (!result.renewed) {
          leaseLost = true
          return
        }
        assertFutureLeaseUntil(result.leaseUntil, parsed.schedulerName)
        lastRenewalAt = Date.now()
      } catch {
        leaseLost = true
      } finally {
        renewal = undefined
      }
    })()
    return renewal
  }
  const assertLease = async (): Promise<void> => {
    if (leaseLost) throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    if (Date.now() - lastRenewalAt >= Math.max(1_000, Math.floor(parsed.renewEveryMs! / 2))) {
      await renewNow()
    }
    if (leaseLost) throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
  }
  const timer = setInterval(() => {
    void renewNow()
  }, parsed.renewEveryMs)
  timer.unref?.()

  let result!: T
  let workError: unknown
  let releaseError: MaintenanceSchedulerLeaseReleaseError | undefined
  try {
    await renewNow()
    if (leaseLost) throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    result = await work({ assertLease })
    if (renewal) await renewal
  } catch (error) {
    workError = error
  } finally {
    clearInterval(timer)
    if (renewal) await renewal
    try {
      const released = maintenanceSchedulerReleaseResultSchema.parse(
        await leases.release(parsed.schedulerName, parsed.ownerId, leaseToken)
      )
      if (!released.released) {
        releaseError = new MaintenanceSchedulerLeaseReleaseError(parsed.schedulerName)
      }
    } catch {
      releaseError = new MaintenanceSchedulerLeaseReleaseError(parsed.schedulerName)
    }
  }
  if (workError) throw workError
  if (leaseLost) throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
  if (releaseError) throw releaseError
  return { acquired: true, result }
}
