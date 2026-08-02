import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { emitWorkerEvent, type WorkerEvent } from './observability'

export const maintenanceLoopTaskQueue = 'appsea-source-maintenance-v1'
export const maintenanceLoopFailureCode = 'APPSEA_MAINTENANCE_LOOP_PASS_FAILED'
export const maintenanceLoopConfigurationFailureCode =
  'APPSEA_MAINTENANCE_LOOP_CONFIGURATION_INVALID'

const defaultIntervalSeconds = 60
const defaultFailureBackoffSeconds = 30
const minIntervalSeconds = 10
const maxIntervalSeconds = 86_400
const minFailureBackoffSeconds = 10
const maxFailureBackoffSeconds = 3_600

function boundedSeconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  const parsed = Number(value ?? String(fallback))
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum} seconds`)
  }
  return parsed
}

export function maintenanceLoopIntervalSecondsFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedSeconds(
    environment.APPSEA_MAINTENANCE_INTERVAL_SECONDS,
    defaultIntervalSeconds,
    minIntervalSeconds,
    maxIntervalSeconds,
    'APPSEA_MAINTENANCE_INTERVAL_SECONDS'
  )
}

export function maintenanceLoopFailureBackoffSecondsFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedSeconds(
    environment.APPSEA_MAINTENANCE_FAILURE_BACKOFF_SECONDS,
    defaultFailureBackoffSeconds,
    minFailureBackoffSeconds,
    maxFailureBackoffSeconds,
    'APPSEA_MAINTENANCE_FAILURE_BACKOFF_SECONDS'
  )
}

export interface MaintenanceLoopOptions {
  taskQueue: string
  intervalMs: number
  failureBackoffMs: number
  signal: AbortSignal
  runPass: (signal: AbortSignal) => Promise<void>
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  emit?: (event: WorkerEvent) => void
}

export interface MaintenanceLoopResult {
  passes: number
  failures: number
}

function validateMilliseconds(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 86_400_000) {
    throw new Error(`${name} must be an integer between 1000 and 86400000 milliseconds`)
  }
}

function waitForSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Runs the durable one-shot maintenance command until shutdown. The loop is
 * only a deployment supervisor: each pass still acquires the PostgreSQL
 * scheduler lease and all work remains idempotent and crash-recoverable.
 */
export async function runMaintenanceLoop(
  options: MaintenanceLoopOptions
): Promise<MaintenanceLoopResult> {
  validateMilliseconds(options.intervalMs, 'intervalMs')
  validateMilliseconds(options.failureBackoffMs, 'failureBackoffMs')
  const emit = options.emit ?? emitWorkerEvent
  const sleep = options.sleep ?? waitForSignal
  let passes = 0
  let failures = 0
  let consecutiveFailures = 0

  emit({
    event: 'maintenance_loop_started',
    taskQueue: options.taskQueue,
    state: 'running'
  })

  while (!options.signal.aborted) {
    try {
      await options.runPass(options.signal)
      passes += 1
      consecutiveFailures = 0
    } catch {
      if (options.signal.aborted) break
      failures += 1
      consecutiveFailures = Math.min(1_000_000, consecutiveFailures + 1)
      emit({
        event: 'maintenance_loop_pass_failed',
        taskQueue: options.taskQueue,
        attempt: consecutiveFailures,
        failureCode: maintenanceLoopFailureCode
      })
    }

    if (options.signal.aborted) break
    await sleep(
      consecutiveFailures > 0 ? options.failureBackoffMs : options.intervalMs,
      options.signal
    )
  }

  emit({
    event: 'maintenance_loop_stopped',
    taskQueue: options.taskQueue,
    state: 'stopped',
    maintenancePasses: passes,
    maintenanceFailures: failures
  })
  return { passes, failures }
}

class MaintenancePassFailedError extends Error {
  constructor() {
    super('maintenance pass failed')
    this.name = 'MaintenancePassFailedError'
  }
}

function maintenanceCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm --filter @appsea/worker source:maintenance']
    }
  }
  return {
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'source:maintenance']
  }
}

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

/** Spawn one bounded pass and terminate it safely when the loop is stopping. */
export function runMaintenancePass(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  const command = maintenanceCommand()
  const child = spawn(command.command, command.args, {
    cwd: repositoryRoot(),
    env: process.env,
    shell: false,
    stdio: 'inherit'
  })

  return new Promise((resolve, reject) => {
    let forceKillTimer: NodeJS.Timeout | undefined
    const terminate = (): void => {
      if (child.exitCode !== null || child.killed) return
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 5_000)
      forceKillTimer.unref?.()
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', terminate)
      if (forceKillTimer) clearTimeout(forceKillTimer)
    }
    const finish = (error?: Error): void => {
      cleanup()
      if (signal.aborted) {
        resolve()
      } else if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    signal.addEventListener('abort', terminate, { once: true })
    child.once('error', () => finish(new MaintenancePassFailedError()))
    child.once('close', (code) => {
      if (code === 0 || signal.aborted) {
        finish()
      } else {
        finish(new MaintenancePassFailedError())
      }
    })
    if (signal.aborted) terminate()
  })
}

async function main(): Promise<void> {
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    const intervalSeconds = maintenanceLoopIntervalSecondsFromEnv()
    const failureBackoffSeconds = maintenanceLoopFailureBackoffSecondsFromEnv()
    await runMaintenanceLoop({
      taskQueue: maintenanceLoopTaskQueue,
      intervalMs: intervalSeconds * 1_000,
      failureBackoffMs: failureBackoffSeconds * 1_000,
      signal: controller.signal,
      runPass: runMaintenancePass
    })
  } catch {
    emitWorkerEvent({
      event: 'maintenance_loop_failed',
      taskQueue: maintenanceLoopTaskQueue,
      failureCode: maintenanceLoopConfigurationFailureCode
    })
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

const modulePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv.slice(1).some((argument) => {
  try {
    return path.resolve(argument) === modulePath
  } catch {
    return false
  }
})
if (invokedDirectly) {
  await main()
}
