export type SkillStatus = 'proposed' | 'evaluated' | 'approved' | 'active' | 'retired'

export interface RuntimeSkillRecord {
  id: string
  name: string
  version: string
  status: SkillStatus
  requestedPermissions: string[]
  evaluationIds: string[]
  approvedBy: string | null
  activatedAt: string | null
}

const privilegedPermissions = new Set([
  'deploy-production',
  'manage-credentials',
  'change-retention',
  'run-migrations',
  'grant-permissions',
  'activate-sources'
])

export function requiresPrivilegedReview(record: RuntimeSkillRecord): boolean {
  return record.requestedPermissions.some((permission) => privilegedPermissions.has(permission))
}

export function canActivateSkill(record: RuntimeSkillRecord): boolean {
  if (record.status !== 'approved') return false
  if (!record.approvedBy) return false
  if (record.evaluationIds.length === 0) return false
  return true
}

export function activateSkill(record: RuntimeSkillRecord, activatedAt: string): RuntimeSkillRecord {
  if (!canActivateSkill(record)) {
    throw new Error('Skill is not approved and evaluated')
  }
  return { ...record, status: 'active', activatedAt }
}
