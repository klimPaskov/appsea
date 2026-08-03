import { describe, expect, it, vi } from 'vitest'
import { createDurableWorkerShutdownLifecycle } from './durable-worker-lifecycle'

describe('durable worker shutdown lifecycle', () => {
  it('runs the shutdown callback once for repeated termination signals', () => {
    const onRequest = vi.fn()
    const lifecycle = createDurableWorkerShutdownLifecycle(onRequest)

    expect(lifecycle.isRequested()).toBe(false)
    lifecycle.request()
    lifecycle.request()

    expect(lifecycle.isRequested()).toBe(true)
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it('marks shutdown before invoking the callback', () => {
    let requestedDuringCallback = false
    const lifecycle = createDurableWorkerShutdownLifecycle(() => {
      requestedDuringCallback = lifecycle.isRequested()
    })

    lifecycle.request()

    expect(requestedDuringCallback).toBe(true)
  })
})
