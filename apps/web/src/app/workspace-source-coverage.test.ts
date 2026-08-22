import { describe, expect, it } from 'vitest'
import {
  sourceApprovalGap,
  sourceApprovalProgressLabel,
  sourceApprovalStatusLabel,
  sourcePermissionEvidenceLabel
} from './workspace/workspace-source-coverage'

const pendingSource = {
  synthetic: false,
  approval: {
    available: true,
    requiredReviewerRoles: ['legal', 'privacy', 'security'],
    approvedReviewerRoles: ['legal'],
    missingReviewerRoles: ['privacy', 'security'],
    permissionEvidenceRequired: true,
    permissionEvidencePresent: false,
    complete: false
  }
} as const

describe('private source coverage approval presentation', () => {
  it('keeps pending policy gaps explicit without revealing reviewer identities', () => {
    expect(sourceApprovalStatusLabel(pendingSource)).toBe('Pending review')
    expect(sourceApprovalProgressLabel(pendingSource)).toBe('1 of 3 roles')
    expect(sourcePermissionEvidenceLabel(pendingSource)).toBe('Missing')
    expect(sourceApprovalGap(pendingSource)).toBe(
      'Missing reviewer roles: privacy, security. Permission evidence is missing.'
    )
  })

  it('does not present fixture policy as external approval evidence', () => {
    const fixture = {
      synthetic: true,
      approval: {
        available: true,
        requiredReviewerRoles: [],
        approvedReviewerRoles: [],
        missingReviewerRoles: [],
        permissionEvidenceRequired: false,
        permissionEvidencePresent: true,
        complete: true
      }
    } as const
    expect(sourceApprovalStatusLabel(fixture)).toBe('Fixture policy')
    expect(sourceApprovalProgressLabel(fixture)).toBe('Not applicable')
    expect(sourcePermissionEvidenceLabel(fixture)).toBe('Not required')
    expect(sourceApprovalGap(fixture)).toBeNull()
  })
})
