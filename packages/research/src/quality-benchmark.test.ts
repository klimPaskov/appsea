import { describe, expect, it } from 'vitest'
import {
  RESEARCH_QUALITY_BENCHMARK,
  buildResearchQualitySnapshot,
  evaluateResearchQuality
} from './quality-benchmark'

describe('research quality benchmark', () => {
  it('evaluates the checked-in synthetic corpus deterministically', () => {
    const first = evaluateResearchQuality(RESEARCH_QUALITY_BENCHMARK)
    const second = evaluateResearchQuality(RESEARCH_QUALITY_BENCHMARK)
    expect(first).toEqual(second)
    expect(first.classifier.accuracy.sampleSize).toBe(RESEARCH_QUALITY_BENCHMARK.cases.length)
    expect(first.deduplication.pairRecall.value).toBeGreaterThan(0)
    expect(first.ranking.topKPrecision.value).toBeGreaterThan(0)
  })

  it('builds a hashed, explicitly synthetic snapshot', () => {
    const snapshot = buildResearchQualitySnapshot(
      RESEARCH_QUALITY_BENCHMARK,
      '2026-08-04T00:00:00.000Z'
    )
    expect(snapshot.schemaVersion).toBe('research-quality-v1.0.0')
    expect(snapshot.synthetic).toBe(true)
    expect(snapshot.reviewedInputOnly).toBe(true)
    expect(snapshot.factorProvenance).toBe('reviewed-input-only')
    expect(snapshot.provenance.sourceCoverage).toBe('not-derived')
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(buildResearchQualitySnapshot(RESEARCH_QUALITY_BENCHMARK, snapshot.generatedAt)).toEqual(
      snapshot
    )
  })

  it('rejects an imported or non-fixture benchmark case', () => {
    const invalid = {
      ...RESEARCH_QUALITY_BENCHMARK,
      cases: RESEARCH_QUALITY_BENCHMARK.cases.map((entry, index) =>
        index === 0 ? { ...entry, complaint: { ...entry.complaint, synthetic: false } } : entry
      )
    }
    expect(() => evaluateResearchQuality(invalid)).toThrow(/synthetic/)
  })
})
