import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspacePlanApprovalConflictError,
  WorkspacePlanNotApprovedError,
  WorkspacePlanPermissionError
} from '@appsea/db/auth'
import { PATCH as updatePlan } from './api/workspaces/[workspaceId]/plans/[planPackageId]/route'
import { GET as exportPlan } from './api/workspaces/[workspaceId]/plans/[planPackageId]/export/route'

const mocks = vi.hoisted(() => ({
  repository: {
    updateWorkspacePlanApproval: vi.fn(),
    exportWorkspacePlan: vi.fn()
  },
  readSession: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/object-store', () => ({
  getObjectStore: () => ({})
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const plan = {
  id: 'plan:one',
  version: 'production-plan-v1',
  files: [{ path: 'README.md', content: 'Reviewed plan' }],
  generatedAt: '2026-07-24T00:00:00.000Z',
  readinessState: 'ready',
  approvalState: 'approved',
  synthetic: false
}

describe('workspace plan routes', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.updateWorkspacePlanApproval.mockReset()
    mocks.repository.exportWorkspacePlan.mockReset()
  })

  it('validates same-origin approval actions and maps governance conflicts', async () => {
    const invalid = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved', extra: true }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          planPackageId: 'plan:one'
        })
      }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.repository.updateWorkspacePlanApproval).not.toHaveBeenCalled()

    mocks.repository.updateWorkspacePlanApproval.mockResolvedValue(plan)
    const updated = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          planPackageId: 'plan:one'
        })
      }
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ data: { approvalState: 'approved' } })

    mocks.repository.updateWorkspacePlanApproval.mockRejectedValue(
      new WorkspacePlanApprovalConflictError()
    )
    const conflict = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          planPackageId: 'plan:one'
        })
      }
    )
    expect(conflict.status).toBe(409)

    mocks.repository.updateWorkspacePlanApproval.mockRejectedValue(
      new WorkspacePlanPermissionError()
    )
    const forbidden = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reviewed' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({
          workspaceId: 'workspace:one',
          planPackageId: 'plan:one'
        })
      }
    )
    expect(forbidden.status).toBe(403)
  })

  it('exports approved plans and blocks unapproved exports', async () => {
    mocks.repository.exportWorkspacePlan.mockResolvedValue({
      plan,
      manifestHash: 'a'.repeat(64)
    })
    const response = await exportPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('appsea-plan-package.json')
    await expect(response.json()).resolves.toMatchObject({
      data: { manifestHash: 'a'.repeat(64), plan: { approvalState: 'approved' } }
    })

    mocks.repository.exportWorkspacePlan.mockRejectedValue(new WorkspacePlanNotApprovedError())
    const blocked = await exportPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(blocked.status).toBe(409)
  })
})
