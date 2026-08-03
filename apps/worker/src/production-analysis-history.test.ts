import { describe, expect, it, vi } from 'vitest'
import type { RawWorkflowExecutionInfo } from '@temporalio/client'
import {
  classifyProductionAnalysisHistory,
  createProductionAnalysisHistoryVisibilityClient,
  inspectProductionAnalysisHistory,
  type ProductionAnalysisHistoryExecution,
  readProductionAnalysisHistoryManifest
} from './production-analysis-history'

function info(
  overrides: Partial<ProductionAnalysisHistoryExecution> = {}
): ProductionAnalysisHistoryExecution {
  return {
    workflowId: 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    runId: '11111111-1111-4111-8111-111111111111',
    status: { name: 'COMPLETED' },
    startTime: new Date('2026-08-03T00:00:00.000Z'),
    closeTime: new Date('2026-08-03T00:01:00.000Z'),
    historyLength: 3,
    historySize: 100,
    memo: {
      schemaVersion: 'appsea-temporal-history-memo-v1',
      workflowType: 'productionAnalysisWorkflow',
      workflowVersion: 'production-analysis-v2',
      historyClass: 'identifier-only'
    },
    ...overrides
  }
}

function payload(value: unknown): { metadata: { encoding: Uint8Array }; data: Uint8Array } {
  return {
    metadata: { encoding: new TextEncoder().encode('json/plain') },
    data: new TextEncoder().encode(JSON.stringify(value))
  }
}

describe('production analysis history checker', () => {
  it('classifies only the reviewed memo as safe v2', () => {
    expect(classifyProductionAnalysisHistory(info())).toBe('identifier_only_v2')
    expect(
      classifyProductionAnalysisHistory(
        info({ memo: { workflowVersion: 'production-analysis-v1', complaint: 'do not log' } })
      )
    ).toBe('legacy_v1')
    expect(classifyProductionAnalysisHistory(info({ memo: { complaint: 'do not log' } }))).toBe(
      'unclassified'
    )
  })

  it('blocks unclassified and legacy executions without a reviewed disposition', async () => {
    const list = vi.fn(async function* () {
      yield info({ memo: { complaint: 'secret raw content' } })
    })
    const result = await inspectProductionAnalysisHistory({ list } as never, {
      now: new Date('2026-08-03T00:00:00.000Z')
    })
    expect(result.status).toBe('blocked')
    expect(result.unclassifiedExecutions).toBe(1)
    expect(result.unresolved[0]).toMatchObject({ reason: 'missing_disposition' })
    expect(JSON.stringify(result)).not.toContain('secret raw content')
    expect(list).toHaveBeenCalledWith({
      query: 'WorkflowType = "productionAnalysisWorkflow"',
      pageSize: 100
    })
  })

  it('reports reviewed retention separately from a clear v2-only drain', async () => {
    const legacy = info({
      memo: { workflowVersion: 'production-analysis-v1' },
      status: { name: 'RUNNING' }
    })
    const list = vi.fn(async function* () {
      yield legacy
    })
    const result = await inspectProductionAnalysisHistory({ list } as never, {
      now: new Date('2026-08-03T00:00:00.000Z'),
      manifest: {
        schemaVersion: 'appsea-temporal-legacy-history-v1',
        reviewedAt: '2026-08-03T00:00:00.000Z',
        approvalReference: 'ticket:history:1',
        entries: [
          {
            workflowId: legacy.workflowId,
            runId: legacy.runId,
            disposition: 'retained',
            reviewedAt: '2026-08-03T00:00:00.000Z',
            approvalReference: 'ticket:history:1',
            retentionUntil: '2026-09-03T00:00:00.000Z'
          }
        ]
      }
    })
    expect(result.status).toBe('legacy_retention')
    expect(result.retainedLegacyExecutions).toBe(1)
    expect(result.unresolvedExecutions).toBe(0)
  })

  it('fails closed when the manifest cannot be parsed', async () => {
    await expect(
      readProductionAnalysisHistoryManifest('missing-history-manifest.json')
    ).rejects.toThrow('manifest is invalid or unavailable')
  })

  it('lists raw visibility metadata without decoding arbitrary memos', async () => {
    const requests: unknown[] = []
    const raw: RawWorkflowExecutionInfo = {
      execution: {
        workflowId: 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        runId: '11111111-1111-4111-8111-111111111111'
      },
      status: 2,
      startTime: { seconds: 1_754_179_200 as never, nanos: 0 },
      closeTime: { seconds: 1_754_179_260 as never, nanos: 0 },
      historyLength: { toNumber: () => 3 } as never,
      historySizeBytes: { toNumber: () => 100 } as never,
      memo: {
        fields: {
          schemaVersion: payload('appsea-temporal-history-memo-v1'),
          workflowType: payload('productionAnalysisWorkflow'),
          workflowVersion: payload('production-analysis-v2'),
          historyClass: payload('identifier-only'),
          complaint: payload('secret raw content')
        }
      }
    }
    const safeRaw: RawWorkflowExecutionInfo = {
      ...raw,
      execution: {
        workflowId: 'workflow:analysis:workspace:one:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        runId: '22222222-2222-4222-8222-222222222222'
      },
      memo: {
        fields: {
          schemaVersion: payload('appsea-temporal-history-memo-v1'),
          workflowType: payload('productionAnalysisWorkflow'),
          workflowVersion: payload('production-analysis-v2'),
          historyClass: payload('identifier-only')
        }
      }
    }
    const service = {
      listWorkflowExecutions: vi.fn(async (request: unknown) => {
        requests.push(request)
        return { executions: [safeRaw, raw], nextPageToken: new Uint8Array() }
      })
    }
    const visibility = createProductionAnalysisHistoryVisibilityClient(
      service as never,
      'appsea-dev'
    )
    const result = await inspectProductionAnalysisHistory(visibility)
    expect(result.status).toBe('blocked')
    expect(result.safeV2Executions).toBe(1)
    expect(result.unclassifiedExecutions).toBe(1)
    expect(JSON.stringify(result)).not.toContain('secret raw content')
    expect(requests).toEqual([
      {
        namespace: 'appsea-dev',
        query: 'WorkflowType = "productionAnalysisWorkflow"',
        pageSize: 100,
        nextPageToken: new Uint8Array()
      }
    ])
  })
})
