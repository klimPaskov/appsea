import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET as listCampaigns,
  POST as createCampaign
} from './api/workspaces/[workspaceId]/campaigns/route'
import { GET as readCampaign } from './api/workspaces/[workspaceId]/campaigns/[campaignId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  sameOriginRequest: vi.fn(),
  listForUser: vi.fn(),
  createForUser: vi.fn(),
  readForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('@appsea/db/research-campaign', () => ({
  PostgresResearchCampaignRepository: class {
    listForUser = mocks.listForUser
    createForUser = mocks.createForUser
    readForUser = mocks.readForUser
  },
  ResearchCampaignConflictError: class extends Error {},
  ResearchCampaignPermissionError: class extends Error {},
  ResearchCampaignSourceError: class extends Error {}
}))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

const session = {
  user: { userId: 'user:editor' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'editor', fixtureOnly: false }]
}

const configuration = {
  schemaVersion: 'campaign-v1',
  goal: 'Find recurring workflow problems.',
  query: 'workflow problem',
  seeds: ['workflow problem'],
  sourceIds: ['source:cfpb'],
  languages: ['en'],
  geographies: [],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 100,
  refreshPolicy: 'manual',
  sensitiveTopicPolicy: 'review',
  requestedDisplayMode: 'excerpt'
}

const budget = {
  currency: 'USD',
  maxSourceItems: 100,
  maxCostMicros: 0,
  maxActivityAttempts: 3
}

const campaign = {
  workspaceId: 'workspace:one',
  campaignId: 'campaign:one',
  name: 'Workflow research',
  purpose: 'opportunity-research',
  state: 'draft',
  configuration,
  budget,
  synthetic: false,
  sources: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

function request(body: unknown, method = 'POST'): Request {
  const init: RequestInit = {
    method,
    headers: { origin: 'https://appsea.example', 'content-type': 'application/json' }
  }
  if (method !== 'GET') init.body = JSON.stringify(body)
  return new Request('https://appsea.example/api/workspaces/workspace:one/campaigns', init)
}

describe('research campaign routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.listForUser.mockReset()
    mocks.createForUser.mockReset()
    mocks.readForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.listForUser.mockResolvedValue([campaign])
    mocks.createForUser.mockResolvedValue(campaign)
    mocks.readForUser.mockResolvedValue(campaign)
  })

  it('keeps campaign listing and reads private', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      listCampaigns(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    const listed = await listCampaigns(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toEqual({ data: [campaign] })

    const read = await readCampaign(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', campaignId: 'campaign:one' })
    })
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual({ data: campaign })
  })

  it('requires same-origin editor input and preserves validated draft creation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const crossOrigin = await createCampaign(request({}), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(crossOrigin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    const invalid = await createCampaign(request({ ...campaign, unexpected: true }), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(invalid.status).toBe(400)
    expect(mocks.createForUser).not.toHaveBeenCalled()

    const created = await createCampaign(
      request({
        campaignId: 'campaign:one',
        name: 'Workflow research',
        purpose: 'opportunity-research',
        configuration,
        budget
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one' }) }
    )
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({ data: campaign })
    expect(mocks.createForUser).toHaveBeenCalledWith('user:editor', 'workspace:one', {
      campaignId: 'campaign:one',
      name: 'Workflow research',
      purpose: 'opportunity-research',
      configuration,
      budget
    })
  })
})
