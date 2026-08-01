import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/opportunities/[slug]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readPrivateOpportunityContext: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('../server/private-opportunity', () => ({
  readPrivateOpportunityContext: mocks.readPrivateOpportunityContext
}))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const detail = {
  opportunity: { slug: 'reviewed-opportunity', competitors: [], contraryEvidence: [] },
  competitiveResearch: {
    status: 'reviewed-seed-only',
    observedAt: null,
    sourceIds: [],
    evidenceIds: [],
    coverageGaps: ['No permitted competitor source evidence is attached.'],
    seedReview: {
      reviewId: 'seed-review:one',
      seedVersion: 'seed-v1',
      contentHash: 'a'.repeat(64),
      reviewedBy: 'user:owner',
      reviewedAt: '2026-08-01T00:00:00.000Z'
    },
    synthetic: false
  }
}

describe('private opportunity API route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.readPrivateOpportunityContext.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readPrivateOpportunityContext.mockResolvedValue({
      session,
      workspace: session.workspaces[0],
      detail
    })
  })

  it('requires authentication and workspace membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    const unauthenticated = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'reviewed-opportunity' })
    })
    expect(unauthenticated.status).toBe(401)

    mocks.readSession.mockResolvedValue({
      user: { userId: 'user:other' },
      workspaces: []
    })
    const forbidden = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'reviewed-opportunity' })
    })
    expect(forbidden.status).toBe(403)
    expect(mocks.readPrivateOpportunityContext).not.toHaveBeenCalled()
  })

  it('returns competitive research provenance through the private read model', async () => {
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'reviewed-opportunity' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: {
        competitiveResearch: {
          status: 'reviewed-seed-only',
          seedReview: { reviewId: 'seed-review:one' },
          coverageGaps: ['No permitted competitor source evidence is attached.']
        }
      }
    })
  })
})
