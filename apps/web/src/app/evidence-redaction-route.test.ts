import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './api/workspaces/[workspaceId]/research/production/[runId]/complaints/[complaintId]/route'

const mocks = vi.hoisted(() => ({
  redact: vi.fn(),
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  hasRecentReauthentication: vi.fn(),
  hasRecentMfaReauthentication: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  sameOriginRequest: vi.fn(),
  errors: {
    EvidenceRedactionConflictError: class extends Error {},
    EvidenceRedactionNotFoundError: class extends Error {},
    EvidenceRedactionPermissionError: class extends Error {},
    WorkspaceAuthorizationError: class extends Error {}
  }
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => ({
    hasRecentReauthentication: mocks.hasRecentReauthentication,
    hasRecentMfaReauthentication: mocks.hasRecentMfaReauthentication
  }),
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  mfaReauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent MFA verification required' }, { status: 428 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  requireRecentMutationStepUp: async () => {
    const token = await mocks.readSessionToken()
    if (!token) return Response.json({ error: 'Authentication required' }, { status: 401 })
    if (!(await mocks.hasRecentReauthentication(token))) {
      return Response.json({ error: 'Recent reauthentication required' }, { status: 428 })
    }
    if (!(await mocks.hasRecentMfaReauthentication(token))) {
      return Response.json({ error: 'Recent MFA verification required' }, { status: 428 })
    }
    return null
  },
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json({ error: 'Recent reauthentication required' }, { status: 428 }),
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

vi.mock('@appsea/db', () => ({
  WorkspaceAuthorizationError: mocks.errors.WorkspaceAuthorizationError
}))

vi.mock('@appsea/db/evidence-redaction', () => ({
  PostgresEvidenceRedactionRepository: class {
    redact = mocks.redact
  },
  ...mocks.errors
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner', fixtureOnly: false }]
}

const path = {
  params: Promise.resolve({
    workspaceId: 'workspace:one',
    runId: 'run:one',
    complaintId: 'complaint:one'
  })
}

function request(body: unknown): Request {
  return new Request('https://appsea.example', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  })
}

describe('evidence redaction route', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.readSessionToken.mockResolvedValue('a'.repeat(48))
    mocks.hasRecentReauthentication.mockResolvedValue(true)
    mocks.hasRecentMfaReauthentication.mockReset()
    mocks.hasRecentMfaReauthentication.mockResolvedValue(true)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.redact.mockReset()
  })

  it('requires same-origin authentication, recent reauthentication, and strict input', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    await expect(POST(request({}), path)).resolves.toHaveProperty('status', 403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.readSession.mockResolvedValue(null)
    await expect(POST(request({}), path)).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue(session)
    mocks.hasRecentReauthentication.mockResolvedValue(false)
    await expect(
      POST(
        request({
          evidenceId: 'evidence:one',
          redactionId: 'redaction:one',
          fields: ['text'],
          reason: 'pii'
        }),
        path
      )
    ).resolves.toHaveProperty('status', 428)

    mocks.hasRecentReauthentication.mockResolvedValue(true)
    mocks.hasRecentMfaReauthentication.mockResolvedValue(false)
    await expect(
      POST(
        request({
          evidenceId: 'evidence:one',
          redactionId: 'redaction:one',
          fields: ['text'],
          reason: 'pii'
        }),
        path
      )
    ).resolves.toHaveProperty('status', 428)

    mocks.hasRecentMfaReauthentication.mockResolvedValue(true)
    const invalid = await POST(
      request({
        evidenceId: 'evidence:one',
        redactionId: 'redaction:one',
        fields: ['text', 'text'],
        reason: 'pii',
        extra: true
      }),
      path
    )
    expect(invalid.status).toBe(400)
    expect(mocks.redact).not.toHaveBeenCalled()
  })

  it('redacts evidence and maps private lifecycle errors', async () => {
    mocks.redact.mockResolvedValue({
      redactionId: 'redaction:one',
      evidenceId: 'evidence:one',
      fields: ['text'],
      reason: 'pii',
      redactedAt: '2026-08-02T10:00:00.000Z',
      replayed: false
    })
    const response = await POST(
      request({
        evidenceId: 'evidence:one',
        redactionId: 'redaction:one',
        fields: ['text'],
        reason: 'pii'
      }),
      path
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        redactionId: 'redaction:one',
        evidenceId: 'evidence:one',
        fields: ['text'],
        reason: 'pii',
        redactedAt: '2026-08-02T10:00:00.000Z',
        replayed: false
      }
    })
    expect(mocks.redact).toHaveBeenCalledWith(
      'user:owner',
      'workspace:one',
      'run:one',
      'complaint:one',
      'evidence:one',
      { redactionId: 'redaction:one', fields: ['text'], reason: 'pii' }
    )

    mocks.redact.mockRejectedValue(new mocks.errors.EvidenceRedactionPermissionError())
    await expect(
      POST(
        request({
          evidenceId: 'evidence:one',
          redactionId: 'redaction:two',
          fields: ['product'],
          reason: 'operator_correction'
        }),
        path
      )
    ).resolves.toHaveProperty('status', 403)

    mocks.redact.mockRejectedValue(new mocks.errors.EvidenceRedactionNotFoundError())
    await expect(
      POST(
        request({
          evidenceId: 'evidence:one',
          redactionId: 'redaction:three',
          fields: ['product'],
          reason: 'operator_correction'
        }),
        path
      )
    ).resolves.toHaveProperty('status', 404)

    mocks.redact.mockRejectedValue(new mocks.errors.EvidenceRedactionConflictError())
    await expect(
      POST(
        request({
          evidenceId: 'evidence:one',
          redactionId: 'redaction:four',
          fields: ['product'],
          reason: 'operator_correction'
        }),
        path
      )
    ).resolves.toHaveProperty('status', 409)
  })
})
