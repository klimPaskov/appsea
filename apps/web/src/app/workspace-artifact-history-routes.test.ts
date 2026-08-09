import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as readHistory } from './api/workspaces/[workspaceId]/opportunities/[slug]/history/route'
import { GET as comparePlans } from './api/workspaces/[workspaceId]/opportunities/[slug]/plans/compare/route'

const mocks = vi.hoisted(() => ({
  repository: {
    listWorkspaceOpportunities: vi.fn(),
    listWorkspaceArtifactHistoryForUser: vi.fn(),
    readWorkspacePlanVersionForUser: vi.fn()
  },
  readSession: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/object-store', () => ({
  getObjectStore: () => ({})
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const opportunity = {
  id: 'opportunity:one',
  slug: 'private-opportunity',
  name: 'Private opportunity',
  oneLine: 'A private opportunity',
  complaintCount: 2,
  synthetic: false,
  score: 40,
  scoreVersion: 'score-v1',
  scoreCalculatedAt: '2026-07-24T00:00:00.000Z',
  state: 'researched' as const,
  currentReportId: 'report:two',
  currentPlanPackageId: 'plan:two'
}

const reports = [
  {
    id: 'report:two',
    version: 'production-report-v2',
    generatedAt: '2026-07-25T00:00:00.000Z',
    manifestHash: 'b'.repeat(64),
    approvalState: 'approved' as const,
    synthetic: false
  }
]

const plans = [
  {
    id: 'plan:two',
    version: 'production-plan-v2',
    generatedAt: '2026-07-25T00:00:00.000Z',
    manifestHash: 'b'.repeat(64),
    readinessState: 'ready' as const,
    approvalState: 'approved' as const,
    synthetic: false
  },
  {
    id: 'plan:one',
    version: 'production-plan-v1',
    generatedAt: '2026-07-24T00:00:00.000Z',
    manifestHash: 'a'.repeat(64),
    readinessState: 'ready' as const,
    approvalState: 'reviewed' as const,
    synthetic: false
  }
]

const planBodies = {
  'plan:one': {
    id: 'plan:one',
    version: 'production-plan-v1',
    files: [
      { path: 'README.md', content: 'before' },
      { path: '01-product-brief.md', content: 'same' }
    ],
    generatedAt: '2026-07-24T00:00:00.000Z',
    readinessState: 'ready' as const,
    approvalState: 'reviewed' as const,
    synthetic: false
  },
  'plan:two': {
    id: 'plan:two',
    version: 'production-plan-v2',
    files: [
      { path: 'README.md', content: 'after' },
      { path: '01-product-brief.md', content: 'same' }
    ],
    generatedAt: '2026-07-25T00:00:00.000Z',
    readinessState: 'ready' as const,
    approvalState: 'approved' as const,
    synthetic: false
  }
}

describe('private artifact history routes', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.repository.listWorkspaceOpportunities.mockReset()
    mocks.repository.listWorkspaceArtifactHistoryForUser.mockReset()
    mocks.repository.readWorkspacePlanVersionForUser.mockReset()
    mocks.repository.listWorkspaceOpportunities.mockResolvedValue([opportunity])
    mocks.repository.listWorkspaceArtifactHistoryForUser.mockResolvedValue({
      reports,
      plans,
      truncated: false
    })
    mocks.repository.readWorkspacePlanVersionForUser.mockImplementation(
      async (_user: string, _workspace: string, id: keyof typeof planBodies) => planBodies[id]
    )
  })

  it('returns bounded report/plan history for the authenticated opportunity', async () => {
    const response = await readHistory(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' })
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { reports, plans, truncated: false }
    })
    expect(mocks.repository.listWorkspaceArtifactHistoryForUser).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'opportunity:one'
    )
  })

  it('compares two versions only after resolving them under the same opportunity', async () => {
    const response = await comparePlans(
      new Request('https://appsea.example?from=plan:one&to=plan:two'),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' }) }
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      data: { files: Array<{ path: string; status: string }> }
    }
    expect(payload.data.files).toEqual([
      expect.objectContaining({ path: '01-product-brief.md', status: 'unchanged' }),
      expect.objectContaining({ path: 'README.md', status: 'changed' })
    ])
  })

  it('rejects missing or duplicate comparison parameters', async () => {
    const missing = await comparePlans(new Request('https://appsea.example?from=plan:one'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' })
    })
    expect(missing.status).toBe(400)
    const duplicate = await comparePlans(
      new Request('https://appsea.example?from=plan:one&from=plan:two&to=plan:two'),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' }) }
    )
    expect(duplicate.status).toBe(400)

    const unknown = await comparePlans(
      new Request('https://appsea.example?from=plan:one&to=plan:two&cursor=next'),
      { params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' }) }
    )
    expect(unknown.status).toBe(400)
  })

  it('rejects history query parameters instead of silently changing the contract', async () => {
    const response = await readHistory(new Request('https://appsea.example?cursor=next'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', slug: 'private-opportunity' })
    })
    expect(response.status).toBe(400)
  })
})
