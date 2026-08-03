import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workspacePurgeReadinessSchema } from '@appsea/contracts'
import {
  WorkspacePurgeRequestNotReadyError,
  WorkspacePurgeRequestPermissionError
} from '@appsea/db/auth'
import { DELETE, GET, POST } from './api/workspaces/[workspaceId]/purge-request/route'

const mocks = vi.hoisted(() => ({
  repository: {
    cancelWorkspacePurge: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    hasRecentMfaReauthentication: vi.fn(),
    readWorkspacePurgeRequest: vi.fn(),
    requestWorkspacePurge: vi.fn()
  },
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () =>
    Response.json(
      { error: 'Workspace access denied' },
      { status: 403, headers: { 'cache-control': 'private, no-store' } }
    ),
  invalidRequest: (message: string) =>
    Response.json(
      { error: message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } }
    ),
  mfaReauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent MFA verification required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent reauthentication required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () =>
    Response.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'cache-control': 'private, no-store' } }
    )
}))

const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const readiness = {
  workspaceId: 'workspace:one',
  state: 'database_ready' as const,
  archivedAt: '2026-08-02T20:00:00.000Z',
  activeWorkCount: 0,
  rawSourceObjectReferenceCount: 0,
  analysisObjectReferenceCount: 0,
  reportObjectReferenceCount: 0,
  planObjectReferenceCount: 0,
  blockers: [] as const,
  externalRequirements: [
    'cloud_object_store_purge',
    'export_retention_purge',
    'backup_deletion_verification'
  ] as const,
  checkedAt: '2026-08-02T20:01:00.000Z'
}

const requestModel = {
  workspaceId: 'workspace:one',
  requestId: `workspace-purge:${'a'.repeat(32)}`,
  state: 'awaiting_external_controls' as const,
  requestedAt: '2026-08-02T20:02:00.000Z',
  canceledAt: null,
  readiness
}

function request(method: string, body?: unknown): Request {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return new Request('https://appsea.example/api/workspaces/workspace:one/purge-request', init)
}

const context = { params: Promise.resolve({ workspaceId: 'workspace:one' }) }

describe('workspace purge request route', () => {
  beforeEach(() => {
    mocks.repository.cancelWorkspacePurge.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.repository.readWorkspacePurgeRequest.mockReset()
    mocks.repository.requestWorkspacePurge.mockReset()
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.readWorkspacePurgeRequest.mockResolvedValue(requestModel)
    mocks.repository.requestWorkspacePurge.mockResolvedValue(requestModel)
    mocks.repository.cancelWorkspacePurge.mockResolvedValue({
      ...requestModel,
      state: 'canceled',
      canceledAt: '2026-08-02T20:03:00.000Z'
    })
  })

  it('reads the latest owner-visible request with private cache headers', async () => {
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: requestModel })
    expect(mocks.repository.readWorkspacePurgeRequest).toHaveBeenCalledWith(
      'user:one',
      'workspace:one'
    )
  })

  it('requires same-origin, authentication, step-up, and exact request confirmation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(
      POST(request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }), context)
    ).resolves.toHaveProperty('status', 403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    await expect(
      POST(request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }), context)
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    await expect(
      POST(request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    await expect(
      POST(request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    await expect(
      POST(request('POST', { confirmation: 'request workspace purge' }), context)
    ).resolves.toHaveProperty('status', 400)
    expect(mocks.repository.requestWorkspacePurge).not.toHaveBeenCalled()
  })

  it('returns readiness blockers without creating a destructive request', async () => {
    const blocked = workspacePurgeReadinessSchema.parse({
      ...readiness,
      state: 'blocked',
      archivedAt: null,
      blockers: ['workspace_not_archived']
    })
    mocks.repository.requestWorkspacePurge.mockRejectedValue(
      new WorkspacePurgeRequestNotReadyError(blocked)
    )
    const response = await POST(
      request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }),
      context
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Finish the database readiness gates before requesting workspace purge',
      data: blocked
    })
  })

  it('records a request through the owner boundary and supports explicit cancellation', async () => {
    const response = await POST(
      request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }),
      context
    )
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ data: requestModel })
    expect(mocks.repository.requestWorkspacePurge).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      { confirmation: 'REQUEST WORKSPACE PURGE' }
    )

    const cancelResponse = await DELETE(
      request('DELETE', {
        requestId: requestModel.requestId,
        confirmation: 'CANCEL WORKSPACE PURGE'
      }),
      context
    )
    expect(cancelResponse.status).toBe(200)
    expect(mocks.repository.cancelWorkspacePurge).toHaveBeenCalledWith(
      'user:one',
      'workspace:one',
      { requestId: requestModel.requestId, confirmation: 'CANCEL WORKSPACE PURGE' }
    )

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    const mfaBlocked = await DELETE(
      request('DELETE', {
        requestId: requestModel.requestId,
        confirmation: 'CANCEL WORKSPACE PURGE'
      }),
      context
    )
    expect(mfaBlocked.status).toBe(428)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
  })

  it('maps owner authorization failures and never treats them as successful requests', async () => {
    mocks.repository.requestWorkspacePurge.mockRejectedValue(
      new WorkspacePurgeRequestPermissionError()
    )
    await expect(
      POST(request('POST', { confirmation: 'REQUEST WORKSPACE PURGE' }), context)
    ).resolves.toHaveProperty('status', 403)
  })
})
