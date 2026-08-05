import { describe, expect, it } from 'vitest'
import { cfpbSourcePolicy } from '@appsea/connectors'
import { sourcePolicySchema, type SourceSnapshotReconciliationReadModel } from '@appsea/contracts'
import type { SourceSnapshotReconciliationClaim } from '@appsea/db'
import { contentHash } from '@appsea/db'
import type { SourceSnapshotReconciliationDependencies } from './production-cfpb-reconciliation'
import {
  runNextProductionCfpbSnapshotReconciliation,
  runProductionCfpbSnapshotReconciliation
} from './production-cfpb-reconciliation'

const input = {
  workspaceId: 'workspace:one',
  reconciliationId: 'reconciliation:source:0123456789abcdef0123456789abcdef',
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-policy-v1',
  idempotencyKey: 'a'.repeat(64),
  pageSize: 2,
  maxRecords: 4,
  requestedAt: '2026-07-24T00:00:00.000Z'
}

function readModel(
  overrides: Partial<SourceSnapshotReconciliationReadModel> = {}
): SourceSnapshotReconciliationReadModel {
  return {
    workspaceId: input.workspaceId,
    reconciliationId: input.reconciliationId,
    sourceId: input.sourceId,
    policyVersion: input.policyVersion,
    inputHash: contentHash(input),
    idempotencyKey: input.idempotencyKey,
    pageSize: input.pageSize,
    maxRecords: input.maxRecords,
    requestedAt: input.requestedAt,
    state: 'queued',
    attemptCount: 0,
    pagesScanned: 0,
    sourceRecordCount: 0,
    deletionCount: 0,
    coverageGaps: [],
    warnings: [],
    failureCode: null,
    failureSummary: null,
    observedAt: null,
    finishedAt: null,
    nextOffset: 0,
    nextAttemptAt: '2026-07-24T00:00:00.000Z',
    updatedAt: input.requestedAt,
    ...overrides
  }
}

function makeDependencies(
  pages: Array<{
    offset: number
    pageSize: number
    sourceRecordCount: number
    sourceRecordIds: string[]
    shortPage: boolean
    completeSnapshot: boolean
    warnings: string[]
  }>,
  options: { terminal?: SourceSnapshotReconciliationReadModel; policy?: boolean } = {}
): {
  dependencies: SourceSnapshotReconciliationDependencies
  calls: {
    connector: number
    preflight: number
    finish: unknown[]
    fail: unknown[]
    reschedule: unknown[]
    release: number
  }
} {
  const calls = {
    connector: 0,
    preflight: 0,
    finish: [] as unknown[],
    fail: [] as unknown[],
    reschedule: [] as unknown[],
    release: 0
  }
  let current = readModel({ observedAt: '2026-07-24T00:00:00.000Z' })
  const claim: SourceSnapshotReconciliationClaim = {
    ...current,
    state: 'running',
    attemptCount: 1,
    claimToken: 'c'.repeat(64)
  }
  const dependencies: SourceSnapshotReconciliationDependencies = {
    jobs: {
      async enqueue() {
        return options.terminal ?? current
      },
      async read() {
        return current
      },
      async claimById() {
        return options.terminal ? null : claim
      },
      async claimNext() {
        return options.terminal ? null : claim
      },
      async appendPage(_workspaceId, _reconciliationId, _claimToken, page) {
        current = readModel({
          ...current,
          state: 'running',
          attemptCount: 1,
          observedAt: claim.observedAt,
          warnings: [...new Set([...current.warnings, ...page.warnings])],
          nextOffset: current.nextOffset + page.sourceRecordCount,
          pagesScanned: current.pagesScanned + 1,
          sourceRecordCount: current.sourceRecordCount + page.sourceRecordCount
        })
        return current
      },
      async finish(finishInput) {
        calls.finish.push(finishInput)
        current = readModel({
          ...current,
          state: finishInput.fullSnapshot ? 'completed' : 'incomplete',
          deletionCount: finishInput.fullSnapshot ? 1 : 0,
          coverageGaps: [...finishInput.coverageGaps],
          warnings: [...finishInput.warnings],
          failureCode: finishInput.fullSnapshot ? null : 'snapshot_incomplete',
          failureSummary: finishInput.fullSnapshot
            ? null
            : 'The bounded source traversal did not prove a complete full snapshot.',
          finishedAt: '2026-07-24T00:01:00.000Z'
        })
        return current
      },
      async reschedule(...args) {
        calls.reschedule.push(args)
        return readModel({ ...current, state: 'queued', failureCode: args[3] })
      },
      async fail(...args) {
        calls.fail.push(args)
        return readModel({ ...current, state: 'failed', failureCode: args[3] })
      }
    },
    policies: {
      async readCollectible() {
        if (options.policy === false) return null
        return {
          policy: sourcePolicySchema.parse({
            ...cfpbSourcePolicy,
            enabled: true,
            policyState: 'approved',
            expiresAt: null
          }),
          reviewedPolicy: cfpbSourcePolicy,
          policyVersion: input.policyVersion,
          contentHash: 'd'.repeat(64)
        }
      }
    },
    leases: {
      async acquire() {
        return {
          decision: 'acquired' as const,
          replayed: false,
          observedAt: claim.observedAt!,
          expiresAt: '2026-07-24T00:30:00.000Z'
        }
      },
      async assertActive() {
        calls.preflight += 1
        return true
      },
      async release() {
        calls.release += 1
        return true
      }
    },
    quota: {
      async reserve() {
        return {
          reservationId: 'quota:test',
          status: 'reserved' as const,
          replayed: false,
          requestedRecords: 2,
          requestedCostMicros: 0
        }
      },
      async commit() {},
      async release() {}
    },
    connectorFactory: () => ({
      async collectSnapshotPage(request) {
        if (request.beforeRequest && !(await request.beforeRequest())) {
          throw new Error('snapshot lease preflight denied')
        }
        calls.connector += 1
        const page = pages.shift()
        if (!page) throw new Error('unexpected extra connector page')
        return page
      }
    })
  }
  return { dependencies, calls }
}

describe('production CFPB snapshot reconciliation runner', () => {
  it('reconciles a complete short-page snapshot and releases its lease after commit', async () => {
    const { dependencies, calls } = makeDependencies([
      {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 1,
        sourceRecordIds: ['123456'],
        shortPage: true,
        completeSnapshot: true,
        warnings: []
      }
    ])
    const result = await runProductionCfpbSnapshotReconciliation(input, dependencies)
    expect(result.state).toBe('completed')
    expect(calls.connector).toBe(1)
    expect(calls.preflight).toBe(1)
    expect(calls.finish[0]).toMatchObject({ fullSnapshot: true })
    expect(calls.release).toBe(1)
  })

  it('resumes the oldest durable job without requiring the original raw idempotency key', async () => {
    const { dependencies, calls } = makeDependencies([
      {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 0,
        sourceRecordIds: [],
        shortPage: true,
        completeSnapshot: true,
        warnings: []
      }
    ])
    const result = await runNextProductionCfpbSnapshotReconciliation(
      input.workspaceId,
      dependencies
    )
    expect(result?.state).toBe('completed')
    expect(calls.connector).toBe(1)
  })

  it('records a bounded or malformed traversal as incomplete without tombstones', async () => {
    const bounded = makeDependencies([
      {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 2,
        sourceRecordIds: ['1', '2'],
        shortPage: false,
        completeSnapshot: false,
        warnings: []
      },
      {
        offset: 2,
        pageSize: 2,
        sourceRecordCount: 2,
        sourceRecordIds: ['3', '4'],
        shortPage: false,
        completeSnapshot: false,
        warnings: []
      }
    ])
    const boundedResult = await runProductionCfpbSnapshotReconciliation(input, bounded.dependencies)
    expect(boundedResult.state).toBe('incomplete')
    expect(bounded.calls.finish[0]).toMatchObject({ fullSnapshot: false })
    expect(boundedResult.deletionCount).toBe(0)

    const malformed = makeDependencies([
      {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 1,
        sourceRecordIds: [],
        shortPage: true,
        completeSnapshot: false,
        warnings: ['invalid identifier']
      }
    ])
    const malformedResult = await runProductionCfpbSnapshotReconciliation(
      input,
      malformed.dependencies
    )
    expect(malformedResult.state).toBe('incomplete')
    expect(malformed.calls.finish[0]).toMatchObject({ fullSnapshot: false })
    expect(malformedResult.deletionCount).toBe(0)
  })

  it('does not call the connector for a replayed terminal job or a denied policy', async () => {
    const terminal = makeDependencies([], {
      terminal: readModel({ state: 'completed', finishedAt: input.requestedAt })
    })
    await expect(
      runProductionCfpbSnapshotReconciliation(input, terminal.dependencies)
    ).resolves.toMatchObject({
      state: 'completed'
    })
    expect(terminal.calls.connector).toBe(0)

    const denied = makeDependencies([], { policy: false })
    const deniedResult = await runProductionCfpbSnapshotReconciliation(input, denied.dependencies)
    expect(deniedResult).toMatchObject({ state: 'failed', failureCode: 'policy_denied' })
    expect(denied.calls.connector).toBe(0)
  })
})
