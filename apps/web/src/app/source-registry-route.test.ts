import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './api/workspaces/[workspaceId]/sources/route'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listForUser: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))
vi.mock('@appsea/db/source-policy', () => ({
  PostgresSourcePolicyRepository: class {
    listForUser = mocks.listForUser
  }
}))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))

const session = {
  user: { userId: 'user:editor' },
  workspaces: [
    {
      workspaceId: 'workspace:one',
      slug: 'private-workspace',
      displayName: 'Private workspace',
      visibility: 'private' as const,
      fixtureOnly: false,
      role: 'viewer' as const
    }
  ]
}

const source = {
  sourceId: 'cfpb-consumer-complaints',
  displayName: 'CFPB Consumer Complaint Database',
  sourceType: 'api' as const,
  lifecycleState: 'disabled_pending_review' as const,
  currentPolicyVersion: 'cfpb-policy-v1',
  policyVersion: 'cfpb-policy-v1',
  policyState: 'pending_review' as const,
  permittedPurposes: ['opportunity-research'],
  commercialUse: 'allowed' as const,
  accessMethod: 'Official API',
  retentionDays: 30,
  deletionRequired: true,
  attributionRequired: true,
  displayMode: 'excerpt' as const,
  coverageNotes: ['Historical export is not covered.'],
  policyDocumentRef: 'https://example.com/policy',
  reviewedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-10-25T00:00:00.000Z',
  freshness: {
    mode: 'scheduled' as const,
    expectedIntervalHours: 24,
    allowedDelayHours: 24
  },
  quota: {
    requestsPerMinute: 6,
    maxRecordsPerRequest: 1000,
    maxRecordsPerRun: 1000,
    costPerRequestMicros: 0
  },
  deletion: {
    sourceRecordIdField: 'complaint_id',
    supportsTombstones: false,
    deletionPollIntervalHours: 24,
    retentionAction: 'redact' as const
  },
  enabled: false,
  synthetic: false,
  collectible: false,
  health: {
    state: 'blocked' as const,
    lastAttemptAt: null,
    lastSuccessfulCollectionAt: null,
    lastFailureCode: null,
    lastRecordCount: 0,
    activeRecordCount: 0,
    lastCostMicros: 0,
    openDeletionCount: 0,
    note: 'Collection is blocked until the current source policy is active and approved.',
    quota: {
      state: 'blocked' as const,
      windowStartedAt: null,
      windowEndsAt: null,
      requestsPerMinute: 6,
      requestsUsed: null,
      requestsRemaining: null,
      note: 'Quota headroom is unavailable until the current source policy is active and approved.'
    },
    freshness: {
      state: 'blocked' as const,
      lastObservedAt: null,
      ageHours: null,
      expectedIntervalHours: 24,
      allowedDelayHours: 24,
      note: 'Freshness is blocked while the current source policy gate is not collectible.'
    }
  }
}

describe('source registry route', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
    mocks.listForUser.mockReset()
    mocks.readSession.mockResolvedValue(session)
    mocks.listForUser.mockResolvedValue([source])
  })

  it('returns private, no-store source coverage metadata for a workspace member', async () => {
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: [source] })
    expect(mocks.listForUser).toHaveBeenCalledWith('user:editor', 'workspace:one')
  })

  it('does not disclose registry data without authentication or private membership', async () => {
    mocks.readSession.mockResolvedValue(null)
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 401)

    mocks.readSession.mockResolvedValue({
      ...session,
      workspaces: [{ ...session.workspaces[0], visibility: 'public' as const }]
    })
    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:one' })
      })
    ).resolves.toHaveProperty('status', 403)

    await expect(
      GET(new Request('https://appsea.example'), {
        params: Promise.resolve({ workspaceId: 'workspace:other' })
      })
    ).resolves.toHaveProperty('status', 403)
    expect(mocks.listForUser).toHaveBeenCalledTimes(0)
  })

  it('returns a generic private failure when the registry projection is unavailable', async () => {
    mocks.listForUser.mockRejectedValue(new Error('database details must stay private'))
    const response = await GET(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ error: 'Unable to read source coverage' })
  })
})
