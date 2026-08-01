import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/research/source-reconciliation/route'
import {
  SourceSnapshotReconciliationConcurrencyLimitError,
  SourceSnapshotReconciliationConflictError,
  SourceSnapshotReconciliationPolicyDeniedError,
  SourceSnapshotReconciliationRateLimitError
} from '@appsea/db'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  enqueueForUser: vi.fn(),
  getDatabasePool: vi.fn()
}))

vi.mock('@appsea/db', () => ({
  contentHash: vi.fn(() => 'a'.repeat(64)),
  sha256: vi.fn(() => 'b'.repeat(64)),
  PostgresSourceSnapshotReconciliationRepository: class {
    enqueueForUser = mocks.enqueueForUser
  },
  SourceSnapshotReconciliationAdmissionDeniedError: class extends Error {},
  SourceSnapshotReconciliationConcurrencyLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('concurrency')
      this.retryAfterSeconds = retryAfterSeconds
    }
  },
  SourceSnapshotReconciliationConflictError: class extends Error {},
  SourceSnapshotReconciliationPolicyDeniedError: class extends Error {},
  SourceSnapshotReconciliationRateLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('rate')
      this.retryAfterSeconds = retryAfterSeconds
    }
  }
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: () => true,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [
    {
      workspaceId: 'workspace:one',
      role: 'editor',
      fixtureOnly: false,
      visibility: 'private'
    }
  ]
}

const payload = {
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-2026-07-v1',
  idempotencyKey: 'source-reconciliation-idempotency',
  pageSize: 100,
  maxRecords: 1_000,
  requestedAt: '2026-08-01T00:00:00.000Z'
} as const

function request(body: unknown): Request {
  return new Request(
    'https://appsea.example/api/workspaces/workspace:one/research/source-reconciliation',
    {
      method: 'POST',
      headers: { origin: 'https://appsea.example', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  )
}

describe('source reconciliation start route admission boundary', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.enqueueForUser.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.enqueueForUser.mockResolvedValue({
      state: 'queued',
      workspaceId: 'workspace:one',
      reconciliationId: 'reconciliation:source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-2026-07-v1',
      inputHash: 'c'.repeat(64),
      idempotencyKey: 'b'.repeat(64),
      pageSize: 100,
      maxRecords: 1_000,
      requestedAt: payload.requestedAt,
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
      nextAttemptAt: payload.requestedAt,
      updatedAt: payload.requestedAt
    })
    mocks.getDatabasePool.mockReturnValue({})
  })

  it('admits an authenticated editor request and returns the durable job', async () => {
    const response = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(202)
    expect(mocks.enqueueForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace:one',
        sourceId: 'cfpb-consumer-complaints',
        idempotencyKey: 'b'.repeat(64)
      }),
      'user:one'
    )
  })

  it('returns retryable rate and concurrency responses', async () => {
    mocks.enqueueForUser.mockRejectedValueOnce(new SourceSnapshotReconciliationRateLimitError(42))
    const rate = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(rate.status).toBe(429)
    expect(rate.headers.get('retry-after')).toBe('42')

    mocks.enqueueForUser.mockRejectedValueOnce(
      new SourceSnapshotReconciliationConcurrencyLimitError(60)
    )
    const concurrency = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(concurrency.status).toBe(429)
    expect(concurrency.headers.get('retry-after')).toBe('60')
  })

  it('keeps policy and idempotency failures client-visible without leaking details', async () => {
    mocks.enqueueForUser.mockRejectedValueOnce(new SourceSnapshotReconciliationPolicyDeniedError())
    const policy = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(policy.status).toBe(422)

    mocks.enqueueForUser.mockRejectedValueOnce(new SourceSnapshotReconciliationConflictError())
    const conflict = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(conflict.status).toBe(409)
  })
})
