import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/research/production/route'
import {
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError
} from '@appsea/db/production-workflow-admission'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  admitForUser: vi.fn(),
  startProductionCollectionWorkflow: vi.fn(),
  prepareProductionCollectionWorkflowStart: vi.fn(),
  getTemporalWorkflowClient: vi.fn(),
  getDatabasePool: vi.fn(),
  readRecollectionTargetForUser: vi.fn()
}))

vi.mock('@appsea/db', () => ({
  PostgresProductionCollectionRepository: class {
    readRecollectionTargetForUser = mocks.readRecollectionTargetForUser
  }
}))

vi.mock('@appsea/db/production-workflow-admission', () => ({
  PostgresProductionWorkflowAdmissionRepository: class {
    admitForUser = mocks.admitForUser
  },
  ProductionWorkflowAdmissionConflictError: class extends Error {},
  ProductionWorkflowConcurrencyLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('concurrency')
      this.retryAfterSeconds = retryAfterSeconds
    }
  },
  ProductionWorkflowRateLimitError: class extends Error {
    retryAfterSeconds: number

    constructor(retryAfterSeconds: number) {
      super('rate')
      this.retryAfterSeconds = retryAfterSeconds
    }
  }
}))

vi.mock('@appsea/db/opportunity-seed-review', () => ({
  PostgresOpportunitySeedReviewRepository: class {
    readApprovedForUser = vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('@appsea/workflows', () => ({
  prepareProductionCollectionWorkflowStart: mocks.prepareProductionCollectionWorkflowStart,
  startProductionCollectionWorkflow: mocks.startProductionCollectionWorkflow
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: () => true,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/production-workflow-gateway', () => ({
  canStartProductionWorkflow: () => true,
  parseProductionWorkflowStartRequest: (_workspaceId: string, body: unknown) => body,
  productionWorkspaceFromSession: (session: { workspaces: unknown[] }, workspaceId: string) =>
    session.workspaces.find(
      (workspace) => (workspace as { workspaceId?: string }).workspaceId === workspaceId
    )
}))

vi.mock('../server/temporal', () => ({
  getTemporalWorkflowClient: mocks.getTemporalWorkflowClient
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
  workspaceId: 'workspace:one',
  campaignId: 'campaign:one',
  runId: 'run:one',
  idempotencyKey: 'production-workflow-idempotency',
  workflowVersion: 'production-collection-v1',
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-v1',
  query: 'billing',
  limit: 10,
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt',
  budget: {
    currency: 'USD',
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  requestedAt: '2026-08-01T00:00:00.000Z'
} as const

function request(body: unknown): Request {
  return new Request('https://appsea.example/api/workspaces/workspace:one/research/production', {
    method: 'POST',
    headers: { origin: 'https://appsea.example', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('production workflow start route admission boundary', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.admitForUser.mockReset()
    mocks.startProductionCollectionWorkflow.mockReset()
    mocks.prepareProductionCollectionWorkflowStart.mockReset()
    mocks.getTemporalWorkflowClient.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readRecollectionTargetForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.admitForUser.mockResolvedValue({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0,
      reservationExpiresAt: '2026-08-01T00:05:00.000Z'
    })
    mocks.prepareProductionCollectionWorkflowStart.mockReturnValue({
      workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      input: { idempotencyDigest: 'a'.repeat(64), inputHash: 'b'.repeat(64) }
    })
    mocks.getTemporalWorkflowClient.mockResolvedValue({})
    mocks.startProductionCollectionWorkflow.mockResolvedValue({
      workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
    mocks.getDatabasePool.mockReturnValue({})
    mocks.readRecollectionTargetForUser.mockResolvedValue({
      tombstoneId: 'tombstone:source:one',
      sourceId: 'cfpb-consumer-complaints',
      sourceRecordId: '123456',
      completedAt: '2026-08-01T00:00:00.000Z'
    })
  })

  it('admits a bounded start before calling Temporal', async () => {
    const response = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(202)
    expect(mocks.admitForUser).toHaveBeenCalledWith({
      workspaceId: 'workspace:one',
      userId: 'user:one',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64)
    })
    expect(mocks.startProductionCollectionWorkflow).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable rate-limit response without starting Temporal', async () => {
    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowRateLimitError(42))

    const response = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('returns a retryable concurrency response without starting Temporal', async () => {
    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowConcurrencyLimitError(60))

    const response = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('preserves idempotency conflicts as a client-visible 409', async () => {
    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowAdmissionConflictError())

    const response = await POST(request(payload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(409)
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('requires a completed matching tombstone before admitting re-collection', async () => {
    const recollectionPayload = {
      ...payload,
      limit: 1,
      recollectionTombstoneId: 'tombstone:source:one'
    }
    const response = await POST(request(recollectionPayload), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(202)
    expect(mocks.readRecollectionTargetForUser).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      'tombstone:source:one',
      'cfpb-consumer-complaints'
    )
    expect(mocks.startProductionCollectionWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recollectionTombstoneId: 'tombstone:source:one' })
    )
  })

  it('does not consume admission when a tombstone is unavailable', async () => {
    mocks.readRecollectionTargetForUser.mockResolvedValue(null)
    const response = await POST(
      request({ ...payload, limit: 1, recollectionTombstoneId: 'tombstone:missing' }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )

    expect(response.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('fails closed when tombstone verification is unavailable', async () => {
    mocks.readRecollectionTargetForUser.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(
      request({ ...payload, limit: 1, recollectionTombstoneId: 'tombstone:one' }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )

    expect(response.status).toBe(503)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })
})
