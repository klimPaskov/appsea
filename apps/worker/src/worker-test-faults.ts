/**
 * Development-only fault injection used by the process replacement drill.
 *
 * The worker must fail closed in production when this setting is present. The
 * value is deliberately bounded so a malformed CI/developer environment does
 * not create an unbounded activity pause.
 */
export const workerPersistPauseEnvironmentKey = 'APPSEA_TEST_WORKER_PERSIST_PAUSE_MS'

export function workerPersistPauseMs(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment[workerPersistPauseEnvironmentKey]?.trim()
  if (!raw) return 0
  if (environment.NODE_ENV === 'production') {
    throw new Error('Worker fault injection is not permitted in production')
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error('Worker persist pause must be an integer number of milliseconds')
  }
  const milliseconds = Number(raw)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 120_000) {
    throw new Error('Worker persist pause must be between 100 and 120000 milliseconds')
  }
  return milliseconds
}

export async function pauseForWorkerRecoveryDrill(
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const milliseconds = workerPersistPauseMs(environment)
  if (milliseconds === 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
