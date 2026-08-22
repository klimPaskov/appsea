import type { WorkspaceSourceReadModel } from '@appsea/contracts'

type SourceApprovalView = {
  synthetic: boolean
  approval: {
    available: boolean
    requiredReviewerRoles: readonly WorkspaceSourceReadModel['approval']['requiredReviewerRoles'][number][]
    approvedReviewerRoles: readonly WorkspaceSourceReadModel['approval']['approvedReviewerRoles'][number][]
    missingReviewerRoles: readonly WorkspaceSourceReadModel['approval']['missingReviewerRoles'][number][]
    permissionEvidenceRequired: boolean
    permissionEvidencePresent: boolean
    complete: boolean
  }
}

export function sourceApprovalStatusLabel(source: SourceApprovalView): string {
  if (source.synthetic) return 'Fixture policy'
  if (!source.approval.available) return 'Unavailable'
  return source.approval.complete ? 'Complete' : 'Pending review'
}

export function sourceApprovalProgressLabel(source: SourceApprovalView): string {
  if (source.synthetic || !source.approval.available) return 'Not applicable'
  return `${source.approval.approvedReviewerRoles.length} of ${source.approval.requiredReviewerRoles.length} roles`
}

export function sourcePermissionEvidenceLabel(source: SourceApprovalView): string {
  if (
    source.synthetic ||
    !source.approval.available ||
    !source.approval.permissionEvidenceRequired
  ) {
    return 'Not required'
  }
  return source.approval.permissionEvidencePresent ? 'Recorded' : 'Missing'
}

export function sourceApprovalGap(source: SourceApprovalView): string | null {
  if (source.synthetic || !source.approval.available || source.approval.complete) return null

  const gaps: string[] = []
  if (source.approval.missingReviewerRoles.length > 0) {
    gaps.push(`Missing reviewer roles: ${source.approval.missingReviewerRoles.join(', ')}.`)
  }
  if (source.approval.permissionEvidenceRequired && !source.approval.permissionEvidencePresent) {
    gaps.push('Permission evidence is missing.')
  }
  return gaps.length > 0 ? gaps.join(' ') : 'The source policy review set is incomplete.'
}
