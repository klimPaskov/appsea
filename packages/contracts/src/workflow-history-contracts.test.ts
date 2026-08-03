import { describe, expect, it } from 'vitest'
import {
  productionAnalysisHistoryManifestSchema,
  productionAnalysisWorkflowHistoryMemoSchema
} from './index'

const baseEntry = {
  workflowId: 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  runId: '11111111-1111-4111-8111-111111111111',
  disposition: 'retained' as const,
  reviewedAt: '2026-08-03T00:00:00.000Z',
  approvalReference: 'ticket:temporal-history:1',
  retentionUntil: '2026-09-03T00:00:00.000Z'
}

describe('production workflow history contracts', () => {
  it('accepts the non-sensitive v2 memo', () => {
    expect(
      productionAnalysisWorkflowHistoryMemoSchema.parse({
        schemaVersion: 'appsea-temporal-history-memo-v1',
        workflowType: 'productionAnalysisWorkflow',
        workflowVersion: 'production-analysis-v2',
        historyClass: 'identifier-only'
      })
    ).toEqual({
      schemaVersion: 'appsea-temporal-history-memo-v1',
      workflowType: 'productionAnalysisWorkflow',
      workflowVersion: 'production-analysis-v2',
      historyClass: 'identifier-only'
    })
  })

  it('requires a deadline for retained histories and forbids it for drained ones', () => {
    expect(() =>
      productionAnalysisHistoryManifestSchema.parse({
        schemaVersion: 'appsea-temporal-legacy-history-v1',
        reviewedAt: baseEntry.reviewedAt,
        approvalReference: baseEntry.approvalReference,
        entries: [{ ...baseEntry, retentionUntil: null }]
      })
    ).toThrow()

    expect(() =>
      productionAnalysisHistoryManifestSchema.parse({
        schemaVersion: 'appsea-temporal-legacy-history-v1',
        reviewedAt: baseEntry.reviewedAt,
        approvalReference: baseEntry.approvalReference,
        entries: [
          { ...baseEntry, disposition: 'drained', retentionUntil: baseEntry.retentionUntil }
        ]
      })
    ).toThrow()
  })

  it('rejects duplicate workflow/run entries', () => {
    expect(() =>
      productionAnalysisHistoryManifestSchema.parse({
        schemaVersion: 'appsea-temporal-legacy-history-v1',
        reviewedAt: baseEntry.reviewedAt,
        approvalReference: baseEntry.approvalReference,
        entries: [baseEntry, baseEntry]
      })
    ).toThrow()
  })
})
