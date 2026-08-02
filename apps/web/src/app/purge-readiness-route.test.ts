import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceAuthorizationError } from '@appsea/db/auth'
import { GET } from './api/workspaces/[workspaceId]/purge-readiness/route'

const mocks = vi.hoisted(() => ({
  repository: { readWorkspacePurgeReadiness: vi.fn() },
  readSession: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () =>
    Response.json(
      { error: 'Workspace access denied' },
      { status: 403, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () =>
    Response.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'cache-control': 'private, no-store' } }
    )
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const readiness = {
  workspaceId: 'workspace:one',
  state: 'blocked' as const,
  archivedAt: null,
  activeWorkCount: 1,
  rawSourceObjectReferenceCount: 0,
  analysisObjectReferenceCount: 0,
  reportObjectReferenceCount: 0,
  planObjectReferenceCount: 0,
  blockers: ['workspace_not_archived', 'active_work'] as const,
  externalRequirements: [
    'cloud_object_store_purge',
    'export_retention_purge',
    'backup_deletion_verification'
  ] as const,
  checkedAt: '2026-08-02T20:00:00.000Z'
}

const context = { params: Promise.resolve({ workspaceId: 'workspace:one' }) }

describe('workspace purge readiness route', () => {
  beforeEach(() => {
    mocks.repository.readWorkspacePurgeReadiness.mockReset()
    mocks.readSession.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.repository.readWorkspacePurgeReadiness.mockResolvedValue(readiness)
  })

  it('requires authentication and validates the workspace path', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(GET(new Request('https://appsea.example'), context)).resolves.toHaveProperty(
      'status',
      401
    )

    mocks.readSession.mockResolvedValue(session)
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'not valid' })
      })
    ).resolves.toHaveProperty('status', 400)
    expect(mocks.repository.readWorkspacePurgeReadiness).not.toHaveBeenCalled()
  })

  it('returns an owner-authorized, read-only readiness inventory', async () => {
    const response = await GET(new Request('https://appsea.example'), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: readiness })
    expect(mocks.repository.readWorkspacePurgeReadiness).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one'
    )
  })

  it('does not turn authorization failures into readiness data', async () => {
    mocks.repository.readWorkspacePurgeReadiness.mockRejectedValue(
      new WorkspaceAuthorizationError()
    )
    await expect(GET(new Request('https://appsea.example'), context)).resolves.toHaveProperty(
      'status',
      403
    )
  })
})
