'use client'

import type {
  WorkspacePlanReadModel,
  WorkspaceReportReadModel,
  WorkspaceRole
} from '@appsea/contracts'
import { useState } from 'react'

type ReportApprovalState = WorkspaceReportReadModel['approvalState']
type PlanApprovalState = WorkspacePlanReadModel['approvalState']
type PlanReadinessState = WorkspacePlanReadModel['readinessState']

export type ArtifactApprovalAction = 'reviewed' | 'approved' | 'withdrawn'

export type ArtifactApprovalActionDescriptor = {
  action: ArtifactApprovalAction
  label: string
  pendingLabel: string
  disabledReason?: string
}

type ReportApprovalInput = {
  kind: 'report'
  role: WorkspaceRole
  state: ReportApprovalState
}

type PlanApprovalInput = {
  kind: 'plan'
  role: WorkspaceRole
  state: PlanApprovalState
  readinessState: PlanReadinessState
}

export type ArtifactApprovalInput = ReportApprovalInput | PlanApprovalInput

/**
 * Keep the browser controls a projection of the server transition contract.
 * The API and database remain authoritative for role, readiness, and conflicts.
 */
export function artifactApprovalActions(
  input: ArtifactApprovalInput
): readonly ArtifactApprovalActionDescriptor[] {
  if (input.role === 'viewer' || input.state === 'withdrawn') return []

  const actions: ArtifactApprovalActionDescriptor[] = []
  if (
    (input.kind === 'report' && input.state === 'draft') ||
    (input.kind === 'plan' && input.state === 'unreviewed')
  ) {
    actions.push({
      action: 'reviewed',
      label: 'Mark reviewed',
      pendingLabel: 'Marking reviewed...'
    })
  }

  if (input.state === 'reviewed' && input.role === 'owner') {
    const planBlocked = input.kind === 'plan' && input.readinessState !== 'ready'
    actions.push({
      action: 'approved',
      label: input.kind === 'report' ? 'Approve report' : 'Approve plan',
      pendingLabel: input.kind === 'report' ? 'Approving report...' : 'Approving plan...',
      ...(planBlocked
        ? {
            disabledReason: 'The plan is not ready; complete the package before approval.'
          }
        : {})
    })
  }

  if (input.role === 'owner') {
    actions.push({
      action: 'withdrawn',
      label: input.kind === 'report' ? 'Withdraw report' : 'Withdraw plan',
      pendingLabel: input.kind === 'report' ? 'Withdrawing report...' : 'Withdrawing plan...'
    })
  }

  return actions
}

function approvalStateLabel(state: ReportApprovalState | PlanApprovalState): string {
  return state.replaceAll('_', ' ')
}

type ReportApprovalActionsProps = {
  workspaceId: string
  artifactId: string
  kind: 'report'
  role: WorkspaceRole
  initialState: ReportApprovalState
}

type PlanApprovalActionsProps = {
  workspaceId: string
  artifactId: string
  kind: 'plan'
  role: WorkspaceRole
  initialState: PlanApprovalState
  readinessState: PlanReadinessState
}

export type ArtifactApprovalActionsProps = ReportApprovalActionsProps | PlanApprovalActionsProps

export function ArtifactApprovalActions(props: ArtifactApprovalActionsProps) {
  const [approvalState, setApprovalState] = useState<ReportApprovalState | PlanApprovalState>(
    props.initialState
  )
  const [pending, setPending] = useState<ArtifactApprovalAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = artifactApprovalActions(
    props.kind === 'plan'
      ? {
          kind: 'plan',
          role: props.role,
          state: approvalState as PlanApprovalState,
          readinessState: props.readinessState
        }
      : {
          kind: 'report',
          role: props.role,
          state: approvalState as ReportApprovalState
        }
  )

  async function update(action: ArtifactApprovalAction): Promise<void> {
    setPending(action)
    setError(null)
    const resource = props.kind === 'report' ? 'reports' : 'plans'
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(props.workspaceId)}/${resource}/${encodeURIComponent(props.artifactId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action })
        }
      )
      const payload = (await response.json()) as {
        data?: { approvalState?: string }
        error?: string
      }
      const nextState = payload.data?.approvalState
      if (!response.ok || !nextState) {
        throw new Error(payload.error ?? `Unable to update ${props.kind} approval`)
      }
      setApprovalState(nextState as ReportApprovalState | PlanApprovalState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to update ${props.kind} approval`)
    } finally {
      setPending(null)
    }
  }

  const canReview = props.role === 'owner' || props.role === 'editor'
  const statusNote =
    props.kind === 'plan' && props.readinessState !== 'ready'
      ? 'The server will keep this plan unapprovable until its package is ready.'
      : props.kind === 'plan'
        ? 'Plan approval also respects the linked report approval gate when one is present.'
        : 'Approval is separate from evidence collection and source-policy activation.'

  return (
    <section className="artifact-approval-actions" aria-label={`${props.kind} approval`}>
      <div className="artifact-approval-heading">
        <div>
          <p className="label">Governance</p>
          <p className="artifact-approval-state">
            {props.kind === 'report' ? 'Report' : 'Plan'} approval:{' '}
            {approvalStateLabel(approvalState)}
          </p>
        </div>
        {!canReview ? <span className="muted-note">Viewer access is read-only.</span> : null}
      </div>
      <p className="muted-note">{statusNote}</p>
      {actions.length > 0 ? (
        <div className="review-actions">
          {actions.map((descriptor) => (
            <button
              className="quiet-button"
              type="button"
              key={descriptor.action}
              disabled={pending !== null || descriptor.disabledReason !== undefined}
              title={descriptor.disabledReason}
              onClick={() => update(descriptor.action)}
            >
              {pending === descriptor.action ? descriptor.pendingLabel : descriptor.label}
            </button>
          ))}
        </div>
      ) : canReview && approvalState === 'reviewed' ? (
        <p className="muted-note">An owner must approve this reviewed artifact.</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
