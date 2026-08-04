import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/run/route'
import {
  ProductionWorkflowAdmissionConflictError,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError
} from '@appsea/db/production-workflow-admission'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readForUser: vi.fn(),
  admitForUser: vi.fn(),
  prepareProductionCollectionWorkflowStart: vi.fn(),
  startProductionCollectionWorkflow: vi.fn(),
  getTemporalWorkflowClient: vi.fn(),
  getDatabasePool: vi.fn(),
  readApprovedForUser: vi.fn(),
  createOrchestration: vi.fn()
}))

vi.mock('@appsea/db/research-campaign', () => ({
  PostgresResearchCampaignRepository: class {
    readForUser = mocks.readForUser
  },
  ResearchCampaignPermissionError: class extends Error {}
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

vi.mock('@appsea/db/research-campaign-orchestration', () => ({
  PostgresResearchCampaignOrchestrationRepository: class {
    createForUser = mocks.createOrchestration
  },
  ResearchCampaignOrchestrationConflictError: class extends Error {},
  ResearchCampaignOrchestrationPermissionError: class extends Error {},
  ResearchCampaignOrchestrationSourceError: class extends Error {},
  ResearchCampaignOrchestrationStateError: class extends Error {}
}))

vi.mock('@appsea/db/opportunity-seed-review', () => ({
  PostgresOpportunitySeedReviewRepository: class {
    readApprovedForUser = mocks.readApprovedForUser
  },
  OpportunitySeedReviewLineageError: class extends Error {
    constructor() {
      super('seed lineage')
      this.name = 'OpportunitySeedReviewLineageError'
    }
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
  canStartProductionWorkflow: () => true
}))

vi.mock('../server/database', () => ({ getDatabasePool: mocks.getDatabasePool }))
vi.mock('../server/temporal', () => ({
  getTemporalWorkflowClient: mocks.getTemporalWorkflowClient
}))

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

const now = '2026-08-02T00:00:00.000Z'
const campaign = {
  workspaceId: 'workspace:one',
  campaignId: 'campaign:billing',
  name: 'Billing workflow research',
  purpose: 'opportunity-research',
  state: 'draft',
  configuration: {
    schemaVersion: 'campaign-v1',
    goal: 'Find recurring billing workflow problems.',
    query: 'billing workflow',
    seeds: ['billing'],
    sourceIds: ['cfpb-consumer-complaints'],
    languages: ['en'],
    geographies: [],
    dateRange: { from: null, to: null },
    exclusions: [],
    maxEvidenceCount: 100,
    refreshPolicy: 'manual',
    sensitiveTopicPolicy: 'review',
    requestedDisplayMode: 'excerpt'
  },
  budget: {
    currency: 'USD',
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  synthetic: false,
  sources: [
    {
      sourceId: 'cfpb-consumer-complaints',
      displayName: 'CFPB Consumer Complaint Database',
      sourceType: 'api',
      lifecycleState: 'active',
      policyVersion: 'cfpb-v1',
      policyState: 'approved',
      permittedPurposes: ['opportunity-research'],
      displayMode: 'excerpt',
      enabled: true,
      synthetic: false,
      coverageNotes: [],
      reviewedAt: now,
      expiresAt: null
    }
  ],
  createdAt: now,
  updatedAt: now
}

function request(body: unknown): Request {
  return new Request(
    'https://appsea.example/api/workspaces/workspace:one/campaigns/campaign:billing/run',
    {
      method: 'POST',
      headers: { origin: 'https://appsea.example', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  )
}

const runInput = {
  runId: 'run:billing',
  idempotencyKey: 'campaign-run-idempotency-key',
  requestedAt: now
}

describe('campaign production run route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readForUser.mockReset()
    mocks.admitForUser.mockReset()
    mocks.prepareProductionCollectionWorkflowStart.mockReset()
    mocks.startProductionCollectionWorkflow.mockReset()
    mocks.getTemporalWorkflowClient.mockReset()
    mocks.getDatabasePool.mockReset()
    mocks.readApprovedForUser.mockReset()
    mocks.createOrchestration.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readForUser.mockResolvedValue(campaign)
    mocks.admitForUser.mockResolvedValue({
      decision: 'admitted',
      replayed: false,
      retryAfterSeconds: 0,
      reservationExpiresAt: '2026-08-02T00:05:00.000Z'
    })
    mocks.prepareProductionCollectionWorkflowStart.mockReturnValue({
      workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      input: { idempotencyDigest: 'a'.repeat(64), inputHash: 'b'.repeat(64) }
    })
    mocks.startProductionCollectionWorkflow.mockResolvedValue({
      workflowId: 'workflow:production:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
    mocks.getTemporalWorkflowClient.mockResolvedValue({})
    mocks.getDatabasePool.mockReturnValue({})
    mocks.readApprovedForUser.mockResolvedValue({ seedReviewId: 'seed-review:billing' })
    mocks.createOrchestration.mockResolvedValue({
      orchestrationId: 'run:billing:multi',
      state: 'queued',
      sourceCount: 2
    })
  })

  it('derives a bounded production request from the persisted campaign before admission', async () => {
    const response = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })

    expect(response.status).toBe(202)
    expect(mocks.admitForUser).toHaveBeenCalledWith({
      workspaceId: 'workspace:one',
      userId: 'user:one',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64)
    })
    expect(mocks.startProductionCollectionWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        campaignId: 'campaign:billing',
        sourceId: 'cfpb-consumer-complaints',
        policyVersion: 'cfpb-v1',
        limit: 10,
        requestedBy: { actorType: 'user', actorId: 'user:one' }
      })
    )
  })

  it('fails closed when source policy readiness is pending', async () => {
    mocks.readForUser.mockResolvedValue({
      ...campaign,
      sources: [{ ...campaign.sources[0], enabled: false, policyState: 'pending_review' }]
    })

    const response = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })

    expect(response.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })

  it('rejects a policy display-mode mismatch before admission', async () => {
    mocks.readForUser.mockResolvedValue({
      ...campaign,
      sources: [{ ...campaign.sources[0], displayMode: 'metadata-only' }]
    })

    const response = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })

    expect(response.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
  })

  it('fails closed for synthetic campaigns and purpose-incompatible policies', async () => {
    mocks.readForUser.mockResolvedValue({ ...campaign, synthetic: true })
    const synthetic = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(synthetic.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()

    mocks.readForUser.mockResolvedValue({
      ...campaign,
      sources: [{ ...campaign.sources[0], permittedPurposes: ['other-purpose'] }]
    })
    const incompatible = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(incompatible.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
  })

  it('queues a durable parent for a multi-source campaign instead of widening the child workflow', async () => {
    mocks.readForUser.mockResolvedValue({
      ...campaign,
      configuration: {
        ...campaign.configuration,
        sourceIds: ['cfpb-consumer-complaints', 'source:other']
      },
      sources: [campaign.sources[0], { ...campaign.sources[0], sourceId: 'source:other' }]
    })

    const response = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })

    expect(response.status).toBe(202)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
    expect(mocks.createOrchestration).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      'campaign:billing',
      runInput
    )
    await expect(response.json()).resolves.toMatchObject({
      data: { orchestrationId: 'run:billing:multi', sourceCount: 2 }
    })
  })

  it('keeps admission errors retryable and does not call Temporal', async () => {
    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowRateLimitError(42))
    const response = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()

    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowConcurrencyLimitError(60))
    const concurrent = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(concurrent.status).toBe(429)
    expect(concurrent.headers.get('retry-after')).toBe('60')

    mocks.admitForUser.mockRejectedValue(new ProductionWorkflowAdmissionConflictError())
    const conflict = await POST(request(runInput), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
    })
    expect(conflict.status).toBe(409)
  })

  it('requires an approved seed before automatic analysis handoff', async () => {
    mocks.readApprovedForUser.mockResolvedValue(null)
    const response = await POST(
      request({ ...runInput, analysisSeedReviewId: 'seed-review:billing' }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:billing' })
      }
    )
    expect(response.status).toBe(422)
    expect(mocks.admitForUser).not.toHaveBeenCalled()
    expect(mocks.startProductionCollectionWorkflow).not.toHaveBeenCalled()
  })
})
