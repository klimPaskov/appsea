import type { WorkspacePlanVersionSummary } from '@appsea/contracts'

export function selectablePlanVersions(
  plans: readonly WorkspacePlanVersionSummary[]
): WorkspacePlanVersionSummary[] {
  return plans.filter((plan) => plan.approvalState !== 'withdrawn')
}

export function defaultPlanComparisonIds(
  plans: readonly WorkspacePlanVersionSummary[]
): { from: string; to: string } | null {
  const selectable = selectablePlanVersions(plans)
  const newest = selectable[0]
  const prior = selectable[1]
  if (!newest || !prior) return null
  return {
    from: prior.id,
    to: newest.id
  }
}
