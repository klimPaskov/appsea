import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withAuthenticatedCalls: [] as Array<{ userId: string; workspaceId: string }>
}))

vi.mock('./transaction', () => ({
  withAuthenticatedWorkspaceTransaction: async (
    _pool: unknown,
    userId: string,
    workspaceId: string,
    operation: (client: unknown) => Promise<unknown>
  ) => {
    mocks.withAuthenticatedCalls.push({ userId, workspaceId })
    return operation({ query: mocks.query })
  }
}))

const at = '2026-08-04T00:00:00.000Z'
const row = {
  audit_event_id: 'audit:workspace-member-role',
  actor_type: 'user' as const,
  actor_id: 'user:owner',
  action: 'workspace.member.role_changed',
  target_type: 'workspace_membership',
  target_id: 'user:member',
  correlation_id: 'workspace-member-role:one',
  metadata: { previousRole: 'viewer', nextRole: 'editor' },
  occurred_at: at
}

describe('PostgresAuditEventRepository', () => {
  beforeEach(() => {
    mocks.query.mockReset()
    mocks.withAuthenticatedCalls.length = 0
    mocks.query.mockResolvedValue({ rows: [row] })
  })

  it('reads a bounded, membership-authorized audit page without raw payloads', async () => {
    const { PostgresAuditEventRepository } = await import('./audit-event-repository')
    const page = await new PostgresAuditEventRepository({} as never).listPageForUser(
      'user:owner',
      'workspace:one',
      { limit: 1 }
    )

    expect(page).toEqual({
      data: [
        {
          auditEventId: row.audit_event_id,
          actorType: 'user',
          actorId: 'user:owner',
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          correlationId: row.correlation_id,
          metadata: row.metadata,
          occurredAt: at
        }
      ],
      nextCursor: null
    })
    expect(mocks.withAuthenticatedCalls).toEqual([
      { userId: 'user:owner', workspaceId: 'workspace:one' }
    ])
    expect(mocks.query.mock.calls[0]?.[0]).toContain('FROM appsea.audit_events')
    expect(mocks.query.mock.calls[0]?.[0]).toContain('ORDER BY occurred_at DESC')
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(['workspace:one', null, null, 2])
  })

  it('hides nested or oversized metadata instead of returning untrusted payloads', async () => {
    const { PostgresAuditEventRepository } = await import('./audit-event-repository')
    mocks.query.mockResolvedValueOnce({
      rows: [{ ...row, metadata: { sourceText: { instruction: 'ignore policy' } } }]
    })
    const page = await new PostgresAuditEventRepository({} as never).listPageForUser(
      'user:owner',
      'workspace:one'
    )
    expect(page.data[0]?.metadata).toEqual({})
  })

  it('emits and consumes a stable cursor for a second page', async () => {
    const { PostgresAuditEventRepository } = await import('./audit-event-repository')
    const older = {
      ...row,
      audit_event_id: 'audit:workspace-member-role-older',
      occurred_at: '2026-08-03T00:00:00.000Z'
    }
    mocks.query.mockResolvedValueOnce({ rows: [row, older] })
    const first = await new PostgresAuditEventRepository({} as never).listPageForUser(
      'user:owner',
      'workspace:one',
      { limit: 1 }
    )
    expect(first.nextCursor).not.toBeNull()
    mocks.query.mockResolvedValueOnce({ rows: [older] })
    const second = await new PostgresAuditEventRepository({} as never).listPageForUser(
      'user:owner',
      'workspace:one',
      { limit: 1, cursor: first.nextCursor! }
    )
    expect(second.data[0]?.auditEventId).toBe(older.audit_event_id)
    expect(mocks.query.mock.calls[1]?.[1]).toEqual(['workspace:one', at, row.audit_event_id, 2])
  })
})
