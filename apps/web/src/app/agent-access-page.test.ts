import { describe, expect, it, vi } from 'vitest'
import AgentAccessPage from './workspace/[workspaceId]/agent-access/page'

const mocks = vi.hoisted(() => ({
  readSession: vi.fn()
}))

vi.mock('../server/auth-session', () => ({ readSession: mocks.readSession }))
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

describe('agent access page', () => {
  it('requires a signed-in owner of a private workspace', async () => {
    mocks.readSession.mockResolvedValueOnce(null)
    await expect(
      AgentAccessPage({ params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).rejects.toThrow('REDIRECT:/login')

    mocks.readSession.mockResolvedValueOnce({
      ...ownerSession,
      workspaces: [{ ...ownerSession.workspaces[0], role: 'viewer' as const }]
    })
    await expect(
      AgentAccessPage({ params: Promise.resolve({ workspaceId: 'workspace:one' }) })
    ).rejects.toThrow('NOT_FOUND')
  })

  it('renders the owner-scoped agent access surface without changing the public leaderboard', async () => {
    mocks.readSession.mockResolvedValue(ownerSession)
    const page = await AgentAccessPage({
      params: Promise.resolve({ workspaceId: 'workspace:one' })
    })
    expect(page).toMatchObject({ type: 'main', props: { className: 'workspace-page' } })
    const children = page.props.children as unknown[]
    const actions = children.find(
      (child) =>
        child &&
        typeof child === 'object' &&
        'type' in child &&
        typeof (child as { type?: unknown }).type === 'function'
    ) as { props?: { workspaceId?: string } } | undefined
    expect(actions?.props?.workspaceId).toBe('workspace:one')
  })
})
