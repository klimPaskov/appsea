import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspacePurgeManifestNotReadyError,
  WorkspacePurgeManifestPermissionError
} from '@appsea/db/auth'
import { GET, POST } from './api/workspaces/[workspaceId]/purge-manifest/route'

const mocks = vi.hoisted(() => ({
  repository: {
    hasRecentMfaReauthentication: vi.fn(),
    hasRecentReauthentication: vi.fn(),
    prepareWorkspacePurgeManifest: vi.fn(),
    readWorkspacePurgeManifest: vi.fn()
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

const manifest = {
  workspaceId: 'workspace:one',
  manifestId: `workspace-purge-manifest:${'a'.repeat(32)}`,
  generatedAt: '2026-08-02T20:01:00.000Z',
  expiresAt: '2026-08-03T20:01:00.000Z',
  manifestHash: 'b'.repeat(64),
  objectCount: 0,
  objects: [],
  externalRequirements: [
    'cloud_object_store_purge',
    'export_retention_purge',
    'backup_deletion_verification'
  ] as const
}

function request(method: string, body?: unknown): Request {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return new Request('https://appsea.example/api/workspaces/workspace:one/purge-manifest', init)
}

const context = { params: Promise.resolve({ workspaceId: 'workspace:one' }) }

describe('workspace purge manifest route', () => {
  beforeEach(() => {
    mocks.repository.hasRecentMfaReauthentication.mockReset()
    mocks.repository.hasRecentReauthentication.mockReset()
    mocks.repository.prepareWorkspacePurgeManifest.mockReset()
    mocks.repository.readWorkspacePurgeManifest.mockReset()
    mocks.readSession.mockReset()
    mocks.readSessionToken.mockReset()
    mocks.sameOriginRequest.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.repository.readWorkspacePurgeManifest.mockResolvedValue(manifest)
    mocks.repository.prepareWorkspacePurgeManifest.mockResolvedValue(manifest)
  })

  it('reads a private owner-visible manifest', async () => {
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: manifest })
    expect(mocks.repository.readWorkspacePurgeManifest).toHaveBeenCalledWith(
      'user:one',
      'workspace:one'
    )
  })

  it('requires same-origin, authentication, step-up, MFA, and exact confirmation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(
      POST(request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }), context)
    ).resolves.toHaveProperty('status', 403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    await expect(
      POST(request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }), context)
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    await expect(
      POST(request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(false)
    await expect(
      POST(request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }), context)
    ).resolves.toHaveProperty('status', 428)

    mocks.repository.hasRecentMfaReauthentication.mockResolvedValue(true)
    await expect(
      POST(request('POST', { confirmation: 'prepare workspace purge manifest' }), context)
    ).resolves.toHaveProperty('status', 400)
    expect(mocks.repository.prepareWorkspacePurgeManifest).not.toHaveBeenCalled()
  })

  it('returns an archive gate and owner authorization failures', async () => {
    mocks.repository.prepareWorkspacePurgeManifest.mockRejectedValue(
      new WorkspacePurgeManifestNotReadyError()
    )
    const notReady = await POST(
      request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }),
      context
    )
    expect(notReady.status).toBe(409)

    mocks.repository.prepareWorkspacePurgeManifest.mockRejectedValue(
      new WorkspacePurgeManifestPermissionError()
    )
    const forbidden = await POST(
      request('POST', { confirmation: 'PREPARE WORKSPACE PURGE MANIFEST' }),
      context
    )
    expect(forbidden.status).toBe(403)
  })
})
