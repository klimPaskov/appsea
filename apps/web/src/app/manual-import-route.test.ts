import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/imports/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readCampaign: vi.fn(),
  readCollectible: vi.fn(),
  createBatch: vi.fn(),
  admit: vi.fn(),
  release: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  getTemporalWorkflowClient: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: () => true,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('../server/temporal', () => ({
  getTemporalWorkflowClient: mocks.getTemporalWorkflowClient
}))

vi.mock('@appsea/connectors', () => ({
  manualOwnerImportPolicyVersion: 'manual-owner-import-v2',
  parseManualImportContent: () => ({
    format: 'json',
    records: [
      {
        sourceRecordId: 'ticket-1',
        canonicalLocator: null,
        capturedAt: '2026-08-03T00:00:00.000Z',
        publishedAt: null,
        query: 'workflow problem',
        product: 'Inbox Relay',
        company: 'Example Systems',
        feature: 'routing',
        category: 'missing_alert',
        text: 'The routing workflow loses the alert.',
        language: 'en'
      }
    ],
    warnings: ['Owner-authorized tenant-private import.'],
    rejectedCount: 0
  })
}))

vi.mock('@appsea/db', () => {
  class ManualImportPermissionError extends Error {}
  class ManualImportConflictError extends Error {}
  class ProductionWorkflowRateLimitError extends Error {
    retryAfterSeconds = 1
  }
  class ProductionWorkflowConcurrencyLimitError extends Error {
    retryAfterSeconds = 1
  }
  class ProductionWorkflowAdmissionConflictError extends Error {}
  return {
    ManualImportPermissionError,
    ManualImportConflictError,
    ProductionWorkflowRateLimitError,
    ProductionWorkflowConcurrencyLimitError,
    ProductionWorkflowAdmissionConflictError,
    contentHash: () => 'd'.repeat(64),
    PostgresResearchCampaignRepository: class {
      readForUser = mocks.readCampaign
    },
    PostgresSourcePolicyRepository: class {
      readCollectible = mocks.readCollectible
    },
    PostgresManualImportRepository: class {
      createForUser = mocks.createBatch
    },
    PostgresProductionWorkflowAdmissionRepository: class {
      admitForUser = mocks.admit
      releaseForUser = mocks.release
    }
  }
})

vi.mock('@appsea/workflows', () => ({
  prepareProductionCollectionWorkflowStart: mocks.prepare,
  startProductionCollectionWorkflow: mocks.start
}))

const configuration = {
  schemaVersion: 'campaign-v1' as const,
  goal: 'Review owner-authorized workflow evidence.',
  query: 'workflow problem',
  seeds: ['workflow problem'],
  sourceIds: ['manual-owner-import'],
  languages: ['en'],
  geographies: [],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 10,
  refreshPolicy: 'manual' as const,
  sensitiveTopicPolicy: 'review' as const,
  requestedDisplayMode: 'excerpt' as const
}

const campaign = {
  campaignId: 'campaign:manual-import',
  name: 'Manual import campaign',
  purpose: 'opportunity-research',
  state: 'draft' as const,
  configuration,
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  synthetic: false,
  sources: [],
  refreshSchedule: null
}

const session = {
  user: { userId: 'user:owner', email: 'owner@example.test' },
  workspaces: [
    {
      workspaceId: 'workspace:private',
      role: 'owner' as const,
      fixtureOnly: false,
      visibility: 'private' as const
    }
  ]
}

function request(body: Record<string, unknown>): Request {
  return new Request('https://appsea.example/api/workspaces/workspace:private/imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function validBody(): Record<string, unknown> {
  return {
    campaignId: 'campaign:manual-import',
    filename: 'authorized-export.json',
    format: 'json',
    content: '[{"text":"The routing workflow loses the alert."}]',
    idempotencyKey: 'manual-import-idempotency-key',
    authorizationAttested: true
  }
}

describe('manual import route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readSession.mockResolvedValue(session)
    mocks.readCampaign.mockResolvedValue(campaign)
    mocks.readCollectible.mockResolvedValue({
      policy: { sourceId: 'manual-owner-import', policyVersion: 'manual-owner-import-v2' }
    })
    mocks.createBatch.mockResolvedValue({
      batchId: 'batch:manual:one',
      campaignId: campaign.campaignId,
      sourceId: 'manual-owner-import',
      policyVersion: 'manual-owner-import-v2',
      format: 'json',
      filename: 'authorized-export.json',
      recordCount: 1,
      warningCount: 1,
      state: 'staged',
      contentHash: 'c'.repeat(64),
      runId: null,
      createdAt: '2026-08-03T00:00:00.000Z',
      consumedAt: null,
      deletedAt: null
    })
    mocks.prepare.mockReturnValue({
      input: { idempotencyDigest: 'a'.repeat(64), inputHash: 'b'.repeat(64) }
    })
    mocks.admit.mockResolvedValue({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0,
      reservationExpiresAt: '2026-08-03T00:05:00.000Z'
    })
    mocks.release.mockResolvedValue(true)
    mocks.start.mockResolvedValue({ workflowId: 'workflow:production:manual-import' })
    mocks.getTemporalWorkflowClient.mockResolvedValue({})
  })

  it('requires an authenticated owner of a private non-fixture workspace', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      POST(request(validBody()), { params: Promise.resolve({ workspaceId: 'workspace:private' }) })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], role: 'viewer' }]
    })
    await expect(
      POST(request(validBody()), { params: Promise.resolve({ workspaceId: 'workspace:private' }) })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.createBatch).not.toHaveBeenCalled()
  })

  it('stages only policy-bound normalized records and starts an admitted workflow', async () => {
    const response = await POST(request(validBody()), {
      params: Promise.resolve({ workspaceId: 'workspace:private' })
    })
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const payload = await response.json()
    expect(payload.data).toMatchObject({
      batch: { batchId: 'batch:manual:one', state: 'staged' },
      workflowId: 'workflow:production:manual-import',
      runId: expect.stringMatching(/^run:manual:/),
      inputHash: 'b'.repeat(64)
    })
    expect(mocks.createBatch).toHaveBeenCalledWith(
      'user:owner',
      expect.objectContaining({
        sourceId: 'manual-owner-import',
        policyVersion: 'manual-owner-import-v2',
        authorizationAttested: true,
        records: expect.arrayContaining([expect.objectContaining({ sourceRecordId: 'ticket-1' })])
      })
    )
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ manualImportBatchId: expect.stringMatching(/^batch:manual:/) })
    )
    expect(mocks.admit).toHaveBeenCalledWith({
      workspaceId: 'workspace:private',
      userId: 'user:owner',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64)
    })
    expect(mocks.start).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ manualImportBatchId: expect.stringMatching(/^batch:manual:/) })
    )
  })

  it('fails closed when the campaign does not allow the manual source', async () => {
    mocks.readCampaign.mockResolvedValue({
      ...campaign,
      configuration: { ...configuration, sourceIds: ['disabled-source'] }
    })
    const response = await POST(request(validBody()), {
      params: Promise.resolve({ workspaceId: 'workspace:private' })
    })
    expect(response.status).toBe(422)
    expect(mocks.createBatch).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not persist a staged payload when workflow admission fails', async () => {
    mocks.admit.mockRejectedValueOnce(
      new (class extends Error {
        override name = 'ProductionWorkflowRateLimitError'
      })('admission unavailable')
    )

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ workspaceId: 'workspace:private' })
    })

    expect(response.status).toBe(503)
    expect(mocks.admit).toHaveBeenCalled()
    expect(mocks.createBatch).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('releases a fresh admission when staging fails before workflow start', async () => {
    mocks.createBatch.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ workspaceId: 'workspace:private' })
    })

    expect(response.status).toBe(503)
    expect(mocks.release).toHaveBeenCalledWith(
      'user:owner',
      'workspace:private',
      'a'.repeat(64),
      'b'.repeat(64)
    )
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not release an idempotent replay when its staged payload is unavailable', async () => {
    mocks.admit.mockResolvedValueOnce({
      decision: 'replayed',
      replayed: true,
      retryAfterSeconds: 0,
      reservationExpiresAt: '2026-08-03T00:05:00.000Z'
    })
    mocks.createBatch.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ workspaceId: 'workspace:private' })
    })

    expect(response.status).toBe(503)
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
