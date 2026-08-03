export interface DurableWorkerShutdownLifecycle {
  /** Request shutdown once; repeated signals are intentionally idempotent. */
  request(): void
  /** Whether a shutdown request has already been accepted. */
  isRequested(): boolean
}

/**
 * Keep signal handling separate from Temporal and database construction so it
 * can be tested without opening connections. The callback owns the actual
 * worker shutdown and must remain bounded and side-effect safe.
 */
export function createDurableWorkerShutdownLifecycle(
  onRequest: () => void
): DurableWorkerShutdownLifecycle {
  let requested = false
  return {
    request: () => {
      if (requested) return
      requested = true
      onRequest()
    },
    isRequested: () => requested
  }
}
