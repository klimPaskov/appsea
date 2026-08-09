import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceAuthorizationError,
  WorkspacePlanApprovalConflictError,
  WorkspacePlanNotApprovedError,
  WorkspacePlanPermissionError
} from '@appsea/db/auth'
import {
  GET as readPlan,
  PATCH as updatePlan
} from './api/workspaces/[workspaceId]/plans/[planPackageId]/route'
import { GET as exportPlan } from './api/workspaces/[workspaceId]/plans/[planPackageId]/export/route'

const mocks = vi.hoisted(() => ({
  repository: {
    updateWorkspacePlanApproval: vi.fn(),
    exportWorkspacePlan: vi.fn(),
    exportWorkspacePlanMarkdown: vi.fn(),
    readWorkspacePlanVersionForUser: vi.fn()
  },
  readSession: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
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
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.updateWorkspacePlanApproval.mockReset()
    mocks.repository.exportWorkspacePlan.mockReset()
    mocks.repository.exportWorkspacePlanMarkdown.mockReset()
    mocks.repository.readWorkspacePlanVersionForUser.mockReset()
  })

  it('blocks approval until the session has recent password and MFA proof', async () => {
    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent reauthentication required' }, { status: 428 })
    )
    const stalePassword = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
      }
    )
    expect(stalePassword.status).toBe(428)
    expect(mocks.repository.updateWorkspacePlanApproval).not.toHaveBeenCalled()

    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent MFA verification required' }, { status: 428 })
    )
    const staleMfa = await updatePlan(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      {
        params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
      }
    )
    expect(staleMfa.status).toBe(428)
    expect(mocks.repository.updateWorkspacePlanApproval).not.toHaveBeenCalled()
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
    expect(response.headers.get('x-appsea-manifest-hash')).toBe('a'.repeat(64))
    await expect(response.json()).resolves.toMatchObject({
      data: { manifestHash: 'a'.repeat(64), plan: { approvalState: 'approved' } }
    })

    mocks.repository.exportWorkspacePlan.mockRejectedValue(new WorkspacePlanNotApprovedError())
    const blocked = await exportPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(blocked.status).toBe(409)
  })

  it('supports approved Markdown export and rejects unknown or duplicate formats', async () => {
    mocks.repository.exportWorkspacePlanMarkdown.mockResolvedValue({
      plan,
      manifestHash: 'b'.repeat(64),
      markdown: '# Coding-agent plan package\n'
    })
    const markdown = await exportPlan(new Request('https://appsea.example?format=markdown'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(markdown.status).toBe(200)
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(markdown.headers.get('content-disposition')).toContain('appsea-plan-package.md')
    expect(markdown.headers.get('x-appsea-manifest-hash')).toBe('b'.repeat(64))
    await expect(markdown.text()).resolves.toContain('# Coding-agent plan package')

    const invalid = await exportPlan(new Request('https://appsea.example?format=xml'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(invalid.status).toBe(400)
    const duplicate = await exportPlan(
      new Request('https://appsea.example?format=json&format=markdown'),
      { params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' }) }
    )
    expect(duplicate.status).toBe(400)
  })

  it('reads a selected non-withdrawn plan version through the private route', async () => {
    mocks.repository.readWorkspacePlanVersionForUser.mockResolvedValue(plan)
    const response = await readPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'plan:one' } })
    expect(mocks.repository.readWorkspacePlanVersionForUser).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'plan:one'
    )
  })

  it('fails closed for unauthenticated, missing, and forbidden plan reads', async () => {
    mocks.readSession.mockResolvedValueOnce(null)
    const unauthenticated = await readPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(unauthenticated.status).toBe(401)

    mocks.repository.readWorkspacePlanVersionForUser.mockResolvedValueOnce(null)
    const missing = await readPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(missing.status).toBe(404)

    mocks.repository.readWorkspacePlanVersionForUser.mockRejectedValueOnce(
      new WorkspaceAuthorizationError()
    )
    const forbidden = await readPlan(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', planPackageId: 'plan:one' })
    })
    expect(forbidden.status).toBe(403)
  })
})
