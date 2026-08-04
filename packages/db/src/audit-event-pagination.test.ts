import { describe, expect, it } from 'vitest'
import {
  decodeAuditEventHistoryCursor,
  encodeAuditEventHistoryCursor
} from './audit-event-pagination'

describe('audit event history cursors', () => {
  it('round trips the bounded cursor', () => {
    const encoded = encodeAuditEventHistoryCursor(
      'workspace:one',
      '2026-08-04T00:00:00.000Z',
      'audit:workspace-member-role'
    )
    expect(decodeAuditEventHistoryCursor(encoded, 'workspace:one')).toEqual({
      version: 1,
      occurredAt: '2026-08-04T00:00:00.000Z',
      itemId: 'audit:workspace-member-role'
    })
  })

  it('rejects tampered or malformed cursors', () => {
    expect(() => decodeAuditEventHistoryCursor('not-a-cursor', 'workspace:one')).toThrow(
      'Audit history cursor is invalid'
    )
    const encoded = encodeAuditEventHistoryCursor(
      'workspace:one',
      '2026-08-04T00:00:00.000Z',
      'audit:workspace-member-role'
    )
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith('a') ? 'b' : 'a'}`
    expect(() => decodeAuditEventHistoryCursor(tampered, 'workspace:one')).toThrow(
      'Audit history cursor is invalid'
    )
    expect(() => decodeAuditEventHistoryCursor(encoded, 'workspace:other')).toThrow(
      'Audit history cursor is invalid'
    )
  })
})
