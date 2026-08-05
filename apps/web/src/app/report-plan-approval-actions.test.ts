import { describe, expect, it } from 'vitest'
import { artifactApprovalActions } from './workspace/report-plan-approval-actions'

describe('artifact approval actions', () => {
  it('lets editors mark draft reports reviewed but never approve them', () => {
    expect(artifactApprovalActions({ kind: 'report', role: 'editor', state: 'draft' })).toEqual([
      {
        action: 'reviewed',
        label: 'Mark reviewed',
        pendingLabel: 'Marking reviewed...'
      }
    ])

    expect(artifactApprovalActions({ kind: 'report', role: 'editor', state: 'reviewed' })).toEqual(
      []
    )
  })

  it('gives owners approval and withdrawal controls for reviewed reports', () => {
    expect(artifactApprovalActions({ kind: 'report', role: 'owner', state: 'reviewed' })).toEqual([
      {
        action: 'approved',
        label: 'Approve report',
        pendingLabel: 'Approving report...'
      },
      {
        action: 'withdrawn',
        label: 'Withdraw report',
        pendingLabel: 'Withdrawing report...'
      }
    ])
  })

  it('keeps a not-ready plan visibly blocked while retaining server-owned withdrawal', () => {
    expect(
      artifactApprovalActions({
        kind: 'plan',
        role: 'owner',
        state: 'reviewed',
        readinessState: 'draft'
      })
    ).toEqual([
      {
        action: 'approved',
        label: 'Approve plan',
        pendingLabel: 'Approving plan...',
        disabledReason: 'The plan is not ready; complete the package before approval.'
      },
      {
        action: 'withdrawn',
        label: 'Withdraw plan',
        pendingLabel: 'Withdrawing plan...'
      }
    ])
  })

  it('does not expose mutation controls to viewers or withdrawn artifacts', () => {
    expect(
      artifactApprovalActions({
        kind: 'plan',
        role: 'viewer',
        state: 'unreviewed',
        readinessState: 'ready'
      })
    ).toEqual([])
    expect(artifactApprovalActions({ kind: 'report', role: 'owner', state: 'withdrawn' })).toEqual(
      []
    )
  })
})
