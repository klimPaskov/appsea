import { describe, expect, it } from 'vitest'
import { activateSkill, canActivateSkill, requiresPrivilegedReview } from './index'

const proposed = {
  id: 's1',
  name: 'source-refresh',
  version: '1.0.0',
  status: 'proposed' as const,
  requestedPermissions: ['activate-sources'],
  evaluationIds: [],
  approvedBy: null,
  activatedAt: null
}

describe('runtime skill governance', () => {
  it('blocks unapproved activation', () => {
    expect(canActivateSkill(proposed)).toBe(false)
    expect(() => activateSkill(proposed, '2026-07-10T00:00:00.000Z')).toThrow()
  })

  it('identifies privileged permissions', () => {
    expect(requiresPrivilegedReview(proposed)).toBe(true)
  })
})
