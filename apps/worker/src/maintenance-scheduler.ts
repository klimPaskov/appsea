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
  maintenanceSchedulerRunIdSchema,
  maintenanceSchedulerRunMetricSchema,
  type MaintenanceSchedulerLeaseToken,
  type MaintenanceSchedulerRunMetric
} from '@appsea/contracts'
import { emitWorkerEvent } from './observability'

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

export interface MaintenanceSchedulerRunMetricsStore {
  record(input: MaintenanceSchedulerRunMetric): Promise<{ recorded: boolean }>
  purge(input: { before: string; limit: number }): Promise<number>
}

export interface MaintenanceSchedulerRunMetricsOptions<T> {
  store: MaintenanceSchedulerRunMetricsStore
  summarize?: (result: T) => Record<string, number>
  failureCode?: (error: unknown) => string
  retentionDays?: number
  purgeBatchSize?: number
}

export interface MaintenanceSchedulerLeaseOptions<T = unknown> {
  schedulerName: string
  ownerId: string
  leaseSeconds: number
  renewEveryMs?: number
  metrics?: MaintenanceSchedulerRunMetricsOptions<T>
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

export function maintenanceSchedulerMetricsRetentionDaysFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const value = Number(environment.APPSEA_MAINTENANCE_METRICS_RETENTION_DAYS ?? '30')
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_650) {
    throw new Error(
      'APPSEA_MAINTENANCE_METRICS_RETENTION_DAYS must be an integer between 1 and 3650'
    )
  }
  return value
}

export function maintenanceSchedulerMetricsPurgeBatchSizeFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const value = Number(environment.APPSEA_MAINTENANCE_METRICS_PURGE_BATCH_SIZE ?? '1000')
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error(
      'APPSEA_MAINTENANCE_METRICS_PURGE_BATCH_SIZE must be an integer between 1 and 10000'
    )
  }
  return value
}

function validatedMetrics<T>(
  metrics: MaintenanceSchedulerRunMetricsOptions<T> | undefined
): MaintenanceSchedulerRunMetricsOptions<T> | undefined {
  if (!metrics) return undefined
  const retentionDays = metrics.retentionDays ?? 30
  const purgeBatchSize = metrics.purgeBatchSize ?? 1_000
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
    throw new Error('Maintenance scheduler metric retention must be between 1 and 3650 days')
  }
  if (!Number.isSafeInteger(purgeBatchSize) || purgeBatchSize < 1 || purgeBatchSize > 10_000) {
    throw new Error('Maintenance scheduler metric purge batch must be between 1 and 10000')
  }
  return { ...metrics, retentionDays, purgeBatchSize }
}

function validatedOptions<T>(
  options: MaintenanceSchedulerLeaseOptions<T>
): MaintenanceSchedulerLeaseOptions<T> {
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
  const metrics = validatedMetrics(options.metrics)
  return {
    schedulerName,
    ownerId,
    leaseSeconds: options.leaseSeconds,
    renewEveryMs,
    ...(metrics ? { metrics } : {})
  }
}

async function persistRunMetric<T>(
  metrics: MaintenanceSchedulerRunMetricsOptions<T> | undefined,
  runId: string,
  schedulerName: string,
  ownerId: string,
  startedAtMs: number,
  state: 'contended' | 'succeeded' | 'failed',
  result: T | undefined,
  error: unknown
): Promise<void> {
  if (!metrics) return
  const parsedRunId = maintenanceSchedulerRunIdSchema.parse(runId)
  const finishedAtMs = Date.now()
  const failureCode =
    state === 'failed'
      ? (metrics.failureCode?.(error) ??
        maintenanceSchedulerFailureCode(error, 'APPSEA_MAINTENANCE_SCHEDULER_WORK_FAILED'))
      : null
  try {
    const metric = maintenanceSchedulerRunMetricSchema.parse({
      runId: parsedRunId,
      schedulerName,
      ownerId,
      state,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.min(86_400_000, Math.max(0, finishedAtMs - startedAtMs)),
      failureCode,
      counters: result === undefined ? {} : (metrics.summarize?.(result) ?? {})
    })
    await metrics.store.record(metric)
    const retentionBefore = new Date(
      finishedAtMs - (metrics.retentionDays ?? 30) * 24 * 60 * 60 * 1_000
    ).toISOString()
    await metrics.store.purge({ before: retentionBefore, limit: metrics.purgeBatchSize ?? 1_000 })
  } catch {
    // Telemetry must never replace a durable job result. Emit only a fixed,
    // secret-free signal so an operator can repair the metrics boundary.
    emitWorkerEvent({
      event: 'maintenance_scheduler_metrics_failed',
      taskQueue: schedulerName,
      schedulerName,
      failureCode: 'APPSEA_MAINTENANCE_SCHEDULER_METRICS_FAILED'
    })
  }
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
  options: MaintenanceSchedulerLeaseOptions<T>,
  leases: MaintenanceSchedulerLeaseStore,
  work: (context: MaintenanceSchedulerLeaseContext) => Promise<T>
): Promise<MaintenanceSchedulerLeaseRun<T>> {
  const parsed = validatedOptions(options)
  const metricRunId = maintenanceSchedulerRunIdSchema.parse(`maintenance:run:${randomUUID()}`)
  const metricStartedAt = Date.now()
  let metricRecorded = false
  const recordMetric = async (
    state: 'contended' | 'succeeded' | 'failed',
    result: T | undefined,
    error: unknown = undefined
  ): Promise<void> => {
    if (metricRecorded) return
    metricRecorded = true
    await persistRunMetric(
      parsed.metrics,
      metricRunId,
      parsed.schedulerName,
      parsed.ownerId,
      metricStartedAt,
      state,
      result,
      error
    )
  }
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
  } catch (error) {
    await releaseAfterAcquisitionFailure()
    const leaseError = new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    await recordMetric('failed', undefined, error ?? leaseError)
    throw leaseError
  }
  if (!acquired.acquired) {
    await recordMetric('contended', undefined)
    return { acquired: false }
  }
  try {
    if (acquired.leaseToken !== leaseToken) {
      throw new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    }
    assertFutureLeaseUntil(acquired.leaseUntil, parsed.schedulerName)
  } catch (error) {
    await releaseAfterAcquisitionFailure()
    await recordMetric('failed', undefined, error)
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
  if (workError) {
    await recordMetric('failed', undefined, workError)
    throw workError
  }
  if (leaseLost) {
    const leaseError = new MaintenanceSchedulerLeaseLostError(parsed.schedulerName)
    await recordMetric('failed', undefined, leaseError)
    throw leaseError
  }
  if (releaseError) {
    await recordMetric('failed', undefined, releaseError)
    throw releaseError
  }
  await recordMetric('succeeded', result)
  return { acquired: true, result }
}
