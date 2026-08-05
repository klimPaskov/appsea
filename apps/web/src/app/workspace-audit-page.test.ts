import { describe, expect, it, vi } from 'vitest'
import WorkspaceActivityPage, {
  formatAction,
  readAuditQuery
} from './workspace/[workspaceId]/activity/page'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  listPageForUser: vi.fn(),
  pool: {}
}))

vi.mock('../server/auth-session', () => ({ readSession: mocks.readSession }))
vi.mock('../server/database', () => ({ getDatabasePool: () => mocks.pool }))
vi.mock('@appsea/db', () => ({
  PostgresAuditEventRepository: class {
    listPageForUser = mocks.listPageForUser
  }
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }
}))

const ownerSession = {
  user: { userId: 'user:owner' },
  workspaces: [
    {
      workspaceId: 'workspace:one',
      slug: 'private-workspace',
      displayName: 'Private workspace',
      visibility: 'private' as const,
      fixtureOnly: false,
      role: 'owner' as const
    }
  ]
}

const page = {
  data: [
    {
      auditEventId: 'audit:report-approved',
      actorType: 'user' as const,
      actorId: 'user:owner',
      action: 'report.approved',
      targetType: 'report',
      targetId: 'report:one',
      correlationId: 'correlation:one',
      metadata: { approvalState: 'approved', stepUp: true },
      occurredAt: '2026-08-05T12:00:00.000Z'
    }
  ],
  nextCursor: 'cursor_next'
}

function serializeTree(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === 'function') return nested.name || 'function'
    if (nested && typeof nested === 'object') {
      if (seen.has(nested)) return '[Circular]'
      seen.add(nested)
    }
    return nested
  })
}

describe('workspace activity page', () => {
  it('normalizes audit actions and rejects unsupported or repeated query parameters', () => {
    expect(formatAction('report.plan-approved')).toBe('Report Plan Approved')
    expect(readAuditQuery({})).toEqual({ limit: 25 })
    expect(readAuditQuery({ limit: '50', cursor: 'cursor_next' })).toEqual({
      limit: 50,
      cursor: 'cursor_next'
    })
    expect(readAuditQuery({ from: 'now' })).toBeNull()
    expect(readAuditQuery({ limit: ['25', '50'] })).toBeNull()
  })

  it('renders a private, read-only audit page with cursor pagination', async () => {
    mocks.readSession.mockResolvedValue(ownerSession)
    mocks.listPageForUser.mockResolvedValue(page)

    const tree = await WorkspaceActivityPage({
      params: Promise.resolve({ workspaceId: 'workspace%3Aone' }),
      searchParams: Promise.resolve({ limit: '1' })
    })
    const serialized = serializeTree(tree)
    expect(serialized).toContain('Audit history')
    expect(serialized).toContain('report.approved')
    expect(serialized).toContain('Load older receipts')
    expect(serialized).toContain('read-only;')
    expect(mocks.listPageForUser).toHaveBeenCalledWith('user:owner', 'workspace:one', {
      limit: 1
    })
  })

  it('keeps dependency failures generic and rejects public workspaces', async () => {
    mocks.readSession.mockResolvedValue(ownerSession)
    mocks.listPageForUser.mockRejectedValue(new Error('database password leaked'))
    const failedTree = await WorkspaceActivityPage({
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    const serialized = serializeTree(failedTree)
    expect(serialized).toContain('temporarily unavailable')
    expect(serialized).not.toContain('database password leaked')

    await expect(
      WorkspaceActivityPage({
        params: Promise.resolve({ workspaceId: 'workspace:one' }),
        searchParams: Promise.resolve({ from: 'now' })
      })
    ).rejects.toThrow('NOT_FOUND')

    mocks.readSession.mockResolvedValue({
      ...ownerSession,
      workspaces: [{ ...ownerSession.workspaces[0], visibility: 'public' as const }]
    })
    await expect(
      WorkspaceActivityPage({ params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).rejects.toThrow('NOT_FOUND')
  })
})
