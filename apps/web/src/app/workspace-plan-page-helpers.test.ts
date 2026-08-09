import { describe, expect, it } from 'vitest'
import type { WorkspacePlanVersionSummary } from '@appsea/contracts'
import { defaultPlanComparisonIds, selectablePlanVersions } from './workspace-plan-page-helpers'

const plan = (id: string, approvalState: WorkspacePlanVersionSummary['approvalState']) => ({
  id,
  version: id,
  generatedAt: '2026-07-24T00:00:00.000Z',
  manifestHash: 'a'.repeat(64),
  readinessState: 'ready' as const,
  approvalState,
  synthetic: false
})

describe('private plan page comparison selectors', () => {
  it('keeps withdrawn history metadata out of selectable comparison versions', () => {
    const plans = [plan('plan:withdrawn', 'withdrawn'), plan('plan:new', 'approved')]

    expect(selectablePlanVersions(plans).map((item) => item.id)).toEqual(['plan:new'])
    expect(defaultPlanComparisonIds(plans)).toBeNull()
  })

  it('defaults to the two newest selectable versions', () => {
    const plans = [
      plan('plan:withdrawn', 'withdrawn'),
      plan('plan:new', 'approved'),
      plan('plan:prior', 'reviewed')
    ]

    expect(defaultPlanComparisonIds(plans)).toEqual({ from: 'plan:prior', to: 'plan:new' })
  })
})
