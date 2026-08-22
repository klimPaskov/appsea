import { describe, expect, it } from 'vitest'
import {
  analysisHandoffNeedsManualRetry,
  analysisHandoffStatusCopy
} from './workspace/workspace-analysis-handoff'

describe('private analysis handoff presentation', () => {
  it('only offers manual retry after a terminal handoff failure', () => {
    expect(analysisHandoffNeedsManualRetry(null)).toBe(false)
    expect(analysisHandoffNeedsManualRetry({ state: 'queued' } as never)).toBe(false)
    expect(analysisHandoffNeedsManualRetry({ state: 'failed' } as never)).toBe(true)
  })

  it('keeps each durable handoff state explicit', () => {
    expect(analysisHandoffStatusCopy('queued')).toContain('Queued')
    expect(analysisHandoffStatusCopy('dispatching')).toContain('starting')
    expect(analysisHandoffStatusCopy('started')).toContain('running')
    expect(analysisHandoffStatusCopy('failed')).toContain('retry explicitly')
  })
})
