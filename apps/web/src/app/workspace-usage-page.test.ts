import { describe, expect, it, vi } from 'vitest'
import WorkspaceUsagePage from './workspace/[workspaceId]/usage/page'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  costReadForUser: vi.fn(),
  quotaReadForUser: vi.fn(),
  pool: {}
}))

vi.mock('../server/auth-session', () => ({ readSession: mocks.readSession }))
vi.mock('../server/database', () => ({ getDatabasePool: () => mocks.pool }))
vi.mock('@appsea/db', () => ({
  PostgresWorkspaceCostRepository: class {
    readForUser = mocks.costReadForUser
  },
  PostgresSourceQuotaRepository: class {
    listReconciliationCasesForUser = mocks.quotaReadForUser
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

const costSummary = {
  workspaceId: 'workspace:one',
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  asOf: '2026-08-01T00:00:00.000Z',
  entryCount: 2,
  currencies: [
    {
      currency: 'USD',
      entryCount: 2,
      totalCostMicros: '1250000',
      estimatedCostMicros: '1000000',
      actualCostMicros: '250000',
      byCostType: [
        {
          costType: 'source_request',
          entryCount: 2,
          totalCostMicros: '1250000',
          estimatedCostMicros: '1000000',
          actualCostMicros: '250000'
        }
      ]
    }
  ]
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

describe('workspace usage page', () => {
  it('requires a signed-in member of a private workspace', async () => {
    mocks.readSession.mockResolvedValueOnce(null)
    await expect(
      WorkspaceUsagePage({ params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).rejects.toThrow('REDIRECT:/login')

    mocks.readSession.mockResolvedValueOnce({
      ...ownerSession,
      workspaces: [{ ...ownerSession.workspaces[0], visibility: 'public' as const }]
    })
    await expect(
      WorkspaceUsagePage({ params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).rejects.toThrow('NOT_FOUND')
  })

  it('renders persisted cost and reconciliation read models without adding mutation controls', async () => {
    mocks.readSession.mockResolvedValue(ownerSession)
    mocks.costReadForUser.mockResolvedValue(costSummary)
    mocks.quotaReadForUser.mockResolvedValue([])

    const page = await WorkspaceUsagePage({
      params: Promise.resolve({ workspaceId: 'workspace%3Aone' })
    })
    expect(page).toMatchObject({ type: 'main', props: { className: 'workspace-page' } })
    const serialized = serializeTree(page)
    expect(serialized).toContain('Cost summary')
    expect(serialized).toContain('1250000')
    expect(serialized).toContain('Quota reconciliation')
    expect(serialized).not.toContain('Resolve')
    expect(mocks.costReadForUser).toHaveBeenCalledWith('user:owner', 'workspace:one', {})
    expect(mocks.quotaReadForUser).toHaveBeenCalledWith('user:owner', 'workspace:one', {
      limit: 50
    })
  })

  it('keeps dependency failures visible without exposing database errors', async () => {
    mocks.readSession.mockResolvedValue(ownerSession)
    mocks.costReadForUser.mockRejectedValue(new Error('database password leaked'))
    mocks.quotaReadForUser.mockRejectedValue(new Error('raw quota failure'))

    const page = await WorkspaceUsagePage({
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    const serialized = serializeTree(page)
    expect(serialized).toContain('temporarily unavailable')
    expect(serialized).not.toContain('database password leaked')
    expect(serialized).not.toContain('raw quota failure')
  })
})
