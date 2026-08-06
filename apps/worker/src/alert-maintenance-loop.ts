import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { emitWorkerEvent, type WorkerEvent } from './observability'

/**
 * This process is only a supervisor. Each child command owns its own
 * PostgreSQL maintenance lease, bounded scan, outbox transition, and durable
 * metrics record. Keeping those boundaries in the existing commands prevents
 * the supervisor from becoming a second scheduler implementation.
 */
export const alertMaintenanceLoopTaskQueue = 'appsea-operational-alert-maintenance-v1'
export const alertMaintenanceLoopFailureCode = 'APPSEA_ALERTS_LOOP_PASS_FAILED'
export const alertMaintenanceLoopConfigurationFailureCode =
  'APPSEA_ALERTS_LOOP_CONFIGURATION_INVALID'

const defaultIntervalSeconds = 60
const defaultFailureBackoffSeconds = 30
const minIntervalSeconds = 10
const maxIntervalSeconds = 86_400
const minFailureBackoffSeconds = 10
const maxFailureBackoffSeconds = 3_600

export interface AlertMaintenanceCommand {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
}

/** The fixed, bounded pass order keeps alert coverage deterministic. */
export const alertMaintenanceCommands: readonly AlertMaintenanceCommand[] = [
  {
    name: 'source:quota:alert',
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'source:quota:alert']
  },
  {
    name: 'source:health:alert',
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'source:health:alert']
  },
  {
    name: 'production:analysis:recompute:alert',
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'production:analysis:recompute:alert']
  },
  {
    name: 'workspace:cost:alert',
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'workspace:cost:alert']
  },
  {
    name: 'alerts:deliver',
    command: 'pnpm',
    args: ['--filter', '@appsea/worker', 'alerts:deliver']
  }
] as const

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

export function alertMaintenanceLoopIntervalSecondsFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedSeconds(
    environment.APPSEA_ALERTS_INTERVAL_SECONDS,
    defaultIntervalSeconds,
    minIntervalSeconds,
    maxIntervalSeconds,
    'APPSEA_ALERTS_INTERVAL_SECONDS'
  )
}

export function alertMaintenanceLoopFailureBackoffSecondsFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedSeconds(
    environment.APPSEA_ALERTS_FAILURE_BACKOFF_SECONDS,
    defaultFailureBackoffSeconds,
    minFailureBackoffSeconds,
    maxFailureBackoffSeconds,
    'APPSEA_ALERTS_FAILURE_BACKOFF_SECONDS'
  )
}

export interface AlertMaintenanceLoopOptions {
  taskQueue: string
  intervalMs: number
  failureBackoffMs: number
  signal: AbortSignal
  runPass: (signal: AbortSignal) => Promise<void>
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  emit?: (event: WorkerEvent) => void
}

export interface AlertMaintenanceLoopResult {
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

/** Run the alert supervisors until a shutdown signal is received. */
export async function runAlertMaintenanceLoop(
  options: AlertMaintenanceLoopOptions
): Promise<AlertMaintenanceLoopResult> {
  validateMilliseconds(options.intervalMs, 'intervalMs')
  validateMilliseconds(options.failureBackoffMs, 'failureBackoffMs')
  const emit = options.emit ?? emitWorkerEvent
  const sleep = options.sleep ?? waitForSignal
  let passes = 0
  let failures = 0
  let consecutiveFailures = 0

  emit({
    event: 'alerts_loop_started',
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
        event: 'alerts_loop_pass_failed',
        taskQueue: options.taskQueue,
        attempt: consecutiveFailures,
        failureCode: alertMaintenanceLoopFailureCode
      })
    }

    if (options.signal.aborted) break
    await sleep(
      consecutiveFailures > 0 ? options.failureBackoffMs : options.intervalMs,
      options.signal
    )
  }

  emit({
    event: 'alerts_loop_stopped',
    taskQueue: options.taskQueue,
    state: 'stopped',
    maintenancePasses: passes,
    maintenanceFailures: failures
  })
  return { passes, failures }
}

class AlertMaintenancePassFailedError extends Error {
  constructor(commandName: string) {
    super(`alert maintenance command failed: ${commandName}`)
    this.name = 'AlertMaintenancePassFailedError'
  }
}

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

function platformCommand(command: AlertMaintenanceCommand): {
  command: string
  args: string[]
} {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `${command.command} ${command.args.join(' ')}`]
    }
  }
  return { command: command.command, args: [...command.args] }
}

/** Spawn one bounded child and terminate it safely when the loop stops. */
export function runAlertMaintenanceCommand(
  command: AlertMaintenanceCommand,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  const childCommand = platformCommand(command)
  const child = spawn(childCommand.command, childCommand.args, {
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
    child.once('error', () => finish(new AlertMaintenancePassFailedError(command.name)))
    child.once('close', (code) => {
      if (code === 0 || signal.aborted) {
        finish()
      } else {
        finish(new AlertMaintenancePassFailedError(command.name))
      }
    })
    if (signal.aborted) terminate()
  })
}

/**
 * Run every bounded inspector in a fixed order. A failed inspector does not
 * starve the other scans or the delivery drain; the pass still fails so the
 * outer loop uses its bounded backoff and emits a failure event.
 */
export async function runAlertMaintenancePass(
  signal: AbortSignal,
  runCommand: (
    command: AlertMaintenanceCommand,
    signal: AbortSignal
  ) => Promise<void> = runAlertMaintenanceCommand
): Promise<void> {
  let firstFailure: Error | undefined
  for (const command of alertMaintenanceCommands) {
    if (signal.aborted) return
    try {
      await runCommand(command, signal)
    } catch {
      if (signal.aborted) return
      firstFailure ??= new AlertMaintenancePassFailedError(command.name)
    }
  }
  if (firstFailure) throw firstFailure
}

async function main(): Promise<void> {
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    const intervalSeconds = alertMaintenanceLoopIntervalSecondsFromEnv()
    const failureBackoffSeconds = alertMaintenanceLoopFailureBackoffSecondsFromEnv()
    await runAlertMaintenanceLoop({
      taskQueue: alertMaintenanceLoopTaskQueue,
      intervalMs: intervalSeconds * 1_000,
      failureBackoffMs: failureBackoffSeconds * 1_000,
      signal: controller.signal,
      runPass: runAlertMaintenancePass
    })
  } catch {
    emitWorkerEvent({
      event: 'alerts_loop_failed',
      taskQueue: alertMaintenanceLoopTaskQueue,
      failureCode: alertMaintenanceLoopConfigurationFailureCode
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
