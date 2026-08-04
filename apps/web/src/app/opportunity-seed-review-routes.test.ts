import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET as listSeeds,
  POST as createSeed
} from './api/workspaces/[workspaceId]/seed-reviews/route'
import {
  GET as readSeed,
  PATCH as updateSeed
} from './api/workspaces/[workspaceId]/seed-reviews/[seedReviewId]/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  sameOriginRequest: vi.fn(),
  canReadProductionWorkflow: vi.fn(),
  canStartProductionWorkflow: vi.fn(),
  create: vi.fn(),
  listForUser: vi.fn(),
  readForUser: vi.fn(),
  updateApproval: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('../server/production-workflow-gateway', () => ({
  canReadProductionWorkflow: mocks.canReadProductionWorkflow,
  canStartProductionWorkflow: mocks.canStartProductionWorkflow
}))
vi.mock('@appsea/db/opportunity-seed-review', () => ({
  OpportunitySeedReviewConflictError: class extends Error {},
  OpportunitySeedReviewNotFoundError: class extends Error {},
  OpportunitySeedReviewPermissionError: class extends Error {},
  PostgresOpportunitySeedReviewRepository: class {
    create = mocks.create
    listForUser = mocks.listForUser
    readForUser = mocks.readForUser
    updateApproval = mocks.updateApproval
  }
}))

const session = {
  user: { userId: 'user:owner' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner', fixtureOnly: false }]
}

const seed = {
  id: 'opportunity:one',
  slug: 'reviewed-opportunity',
  name: 'Reviewed Opportunity',
  oneLine: 'A reviewed opportunity seed.',
  thesis: 'A reviewed thesis.',
  audience: 'A reviewed audience.',
  firstWedge: 'A reviewed first wedge.',
  tags: ['reviewed'],
  competitors: [],
  contraryEvidence: ['Needs pricing validation.'],
  scoreFactors: {
    complaintVolume: 10,
    painSeverity: 20,
    recurrence: 30,
    willingnessToPay: 0,
    competitiveGap: 10,
    buildFeasibility: 30,
    evidenceQuality: 20,
    contraryEvidencePenalty: 10
  },
  planFiles: [
    'README.md',
    '01-product-brief.md',
    '02-mvp-scope.md',
    '03-architecture.md',
    '04-task-graph.json',
    '05-validation.md'
  ]
}

const review = {
  seedReviewId: 'seed-review:one',
  seedVersion: 'seed-v1',
  seed,
  contentHash: 'a'.repeat(64),
  reviewState: 'unreviewed',
  createdBy: 'user:owner',
  reviewedBy: null,
  reviewedAt: null,
  approvedBy: null,
  approvedAt: null,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z'
}

function request(body: unknown, method = 'POST'): Request {
  return new Request('https://appsea.example', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'https://appsea.example' }
  })
}

describe('opportunity seed review routes', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.requireRecentMutationStepUp.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.canReadProductionWorkflow.mockReset()
    mocks.canStartProductionWorkflow.mockReset()
    mocks.create.mockReset()
    mocks.listForUser.mockReset()
    mocks.readForUser.mockReset()
    mocks.updateApproval.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.canReadProductionWorkflow.mockReturnValue(true)
    mocks.canStartProductionWorkflow.mockReturnValue(true)
    mocks.create.mockResolvedValue(review)
    mocks.listForUser.mockResolvedValue([review])
    mocks.readForUser.mockResolvedValue(review)
    mocks.updateApproval.mockResolvedValue({ ...review, reviewState: 'reviewed' })
  })

  it('keeps creation private, strict, and editor/owner-only', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      createSeed(request({}), { params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.canStartProductionWorkflow.mockReturnValue(false)
    await expect(
      createSeed(request({}), { params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).resolves.toHaveProperty('status', 403)

    mocks.canStartProductionWorkflow.mockReturnValue(true)
    const oversized = await createSeed(request({ padding: 'x'.repeat(512 * 1024) }), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(oversized.status).toBe(413)
    const invalid = await createSeed(request({ ...review, unexpected: true }), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(invalid.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('lists and reads seeds only through authenticated workspace routes', async () => {
    const listed = await listSeeds(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toEqual({ data: [review] })

    const read = await readSeed(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', seedReviewId: 'seed-review:one' })
    })
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual({ data: review })
  })

  it('updates review state through the same-origin approval boundary', async () => {
    const response = await updateSeed(request({ action: 'reviewed' }, 'PATCH'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', seedReviewId: 'seed-review:one' })
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { ...review, reviewState: 'reviewed' }
    })
    expect(mocks.updateApproval).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'seed-review:one',
      { action: 'reviewed' }
    )
  })

  it('blocks review transitions until recent password and MFA proof are present', async () => {
    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent reauthentication required' }, { status: 428 })
    )
    const stalePassword = await updateSeed(request({ action: 'reviewed' }, 'PATCH'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', seedReviewId: 'seed-review:one' })
    })
    expect(stalePassword.status).toBe(428)
    expect(mocks.updateApproval).not.toHaveBeenCalled()

    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent MFA verification required' }, { status: 428 })
    )
    const staleMfa = await updateSeed(request({ action: 'approved' }, 'PATCH'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', seedReviewId: 'seed-review:one' })
    })
    expect(staleMfa.status).toBe(428)
    expect(mocks.updateApproval).not.toHaveBeenCalled()
  })
})
