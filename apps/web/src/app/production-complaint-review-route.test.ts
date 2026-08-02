import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PATCH } from './api/workspaces/[workspaceId]/research/production/[runId]/complaints/[complaintId]/route'

const mocks = vi.hoisted(() => ({
  updateComplaintReview: vi.fn(),
  readSession: vi.fn(),
  sameOriginRequest: vi.fn(),
  errors: {
    ProductionComplaintReviewConflictError: class extends Error {},
    ProductionComplaintReviewNotFoundError: class extends Error {},
    ProductionComplaintReviewPermissionError: class extends Error {}
  }
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db/production-collection', () => ({
  PostgresProductionCollectionRepository: class {
    updateComplaintReview = mocks.updateComplaintReview
  },
  ...mocks.errors
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner', fixtureOnly: false }]
}

describe('production complaint review route', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.updateComplaintReview.mockReset()
  })

  it('requires authentication, same origin, and strict review input', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    const origin = await PATCH(new Request('https://appsea.example'), {
      params: Promise.resolve({
        workspaceId: 'workspace:one',
        runId: 'run:one',
        complaintId: 'complaint:one'
      })
    })
    expect(origin.status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    const unauthenticated = await PATCH(new Request('https://appsea.example'), {
      params: Promise.resolve({
        workspaceId: 'workspace:one',
        runId: 'run:one',
        complaintId: 'complaint:one'
      })
    })
    expect(unauthenticated.status).toBe(401)

    mocks.readSession.mockResolvedValue(session)
    const invalid = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirmed', extra: true }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.updateComplaintReview).not.toHaveBeenCalled()
  })

  it('updates confirmed/rejected state and maps private governance errors', async () => {
    mocks.updateComplaintReview.mockResolvedValue({
      complaintId: 'complaint:one',
      reviewState: 'confirmed'
    })
    const response = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirmed' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { complaintId: 'complaint:one', reviewState: 'confirmed' }
    })

    mocks.updateComplaintReview.mockRejectedValue(
      new mocks.errors.ProductionComplaintReviewConflictError()
    )
    const conflict = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirmed' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )
    expect(conflict.status).toBe(409)

    mocks.updateComplaintReview.mockRejectedValue(
      new mocks.errors.ProductionComplaintReviewPermissionError()
    )
    const forbidden = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'rejected' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )
    expect(forbidden.status).toBe(403)

    mocks.updateComplaintReview.mockRejectedValue(
      new mocks.errors.ProductionComplaintReviewNotFoundError()
    )
    const notFound = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'rejected' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )
    expect(notFound.status).toBe(404)
  })

  it('accepts derived-only corrections and returns invalidation counts', async () => {
    mocks.updateComplaintReview.mockResolvedValue({
      complaintId: 'complaint:one',
      reviewState: 'corrected',
      invalidatedAnalysisCount: 1,
      invalidatedOpportunityCount: 1
    })
    const response = await PATCH(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'corrected',
          correctionId: 'correction:analysis:one',
          analysisCorrection: { severity: 5 }
        }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          runId: 'run:one',
          complaintId: 'complaint:one'
        })
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        complaintId: 'complaint:one',
        reviewState: 'corrected',
        invalidatedAnalysisCount: 1,
        invalidatedOpportunityCount: 1
      }
    })
    expect(mocks.updateComplaintReview).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'run:one',
      'complaint:one',
      {
        action: 'corrected',
        correctionId: 'correction:analysis:one',
        analysisCorrection: { severity: 5 }
      }
    )
  })
})
