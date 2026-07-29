import { describe, expect, it } from 'vitest'
import { generateOpportunityReport, generateProductionPlanPackage } from '@appsea/reports'
import { buildOfflineCfpbAnalysisSample } from './analysis-sample'

describe('offline production-shaped analysis sample', () => {
  it('is explicitly test-only and produces a complete report/package shape', () => {
    const artifact = buildOfflineCfpbAnalysisSample()
    const report = generateOpportunityReport(artifact, artifact.createdAt)
    const plan = generateProductionPlanPackage(artifact, artifact.createdAt)

    expect(artifact.testOnly).toBe(true)
    expect(artifact.transport).toBe('offline-sample')
    expect(artifact.opportunity.synthetic).toBe(false)
    expect(report.testOnly).toBe(true)
    expect(report.transport).toBe('offline-sample')
    expect(report.coverage.gaps).toContain(
      'This analysis was composed from a test-only offline transport and cannot support market conclusions.'
    )
    expect(plan.files).toHaveLength(6)
    expect(plan.files.find((file) => file.path === 'README.md')?.content).toContain('test-only')
  })

  it('replays to the same artifact and package content', () => {
    const first = buildOfflineCfpbAnalysisSample()
    const replay = buildOfflineCfpbAnalysisSample()
    expect(replay).toEqual(first)
    expect(generateProductionPlanPackage(replay, replay.createdAt)).toEqual(
      generateProductionPlanPackage(first, first.createdAt)
    )
  })
})
