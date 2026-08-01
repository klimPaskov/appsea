export type HealthCheckState = 'ok' | 'failed'

export interface ReadinessCheck {
  name: string
  run: () => void | Promise<void>
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  checks: Record<string, HealthCheckState>
}

const defaultCheckTimeoutMs = 2_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health check timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Run dependency checks concurrently, with a fixed deadline and no error
 * details in the returned report. The names and states are safe for an
 * internal load-balancer probe while exception text and credentials stay in
 * server logs owned by the dependency boundary.
 */
export async function evaluateReadiness(
  checks: readonly ReadinessCheck[],
  timeoutMs = defaultCheckTimeoutMs
): Promise<ReadinessReport> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('Health check timeout must be between 100 and 30000 milliseconds')
  }

  const results = await Promise.all(
    checks.map(async (check): Promise<[string, HealthCheckState]> => {
      try {
        await withTimeout(
          Promise.resolve().then(() => check.run()),
          timeoutMs
        )
        return [check.name, 'ok']
      } catch {
        return [check.name, 'failed']
      }
    })
  )
  const states = Object.fromEntries(results)
  return {
    status: Object.values(states).every((state) => state === 'ok') ? 'ready' : 'not_ready',
    checks: states
  }
}

export const healthResponseHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
} as const

export function livenessPayload(observedAt = new Date().toISOString()): {
  service: 'appsea-web'
  status: 'ok'
  observedAt: string
} {
  return { service: 'appsea-web', status: 'ok', observedAt }
}
