import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceReportApprovalConflictError,
  WorkspaceReportNotApprovedError,
  WorkspaceReportPermissionError
} from '@appsea/db/auth'
import { PATCH as updateReport } from './api/workspaces/[workspaceId]/reports/[reportId]/route'
import { GET as exportReport } from './api/workspaces/[workspaceId]/reports/[reportId]/export/route'

const mocks = vi.hoisted(() => ({
  repository: {
    updateWorkspaceReportApproval: vi.fn(),
    exportWorkspaceReport: vi.fn()
  },
  readSession: vi.fn(),
  requireRecentMutationStepUp: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  authRepository: () => mocks.repository,
  forbiddenResponse: () => Response.json({ error: 'Workspace access denied' }, { status: 403 }),
  invalidRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  requireRecentMutationStepUp: mocks.requireRecentMutationStepUp,
  sameOriginRequest: mocks.sameOriginRequest,
  unauthorizedResponse: () => Response.json({ error: 'Authentication required' }, { status: 401 })
}))

const session = {
  user: { userId: 'user:owner', email: 'owner@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}

const report = {
  id: 'report:one',
  version: 'fixture-report-v1',
  structuredReport: {
    schemaVersion: '1.0.0',
    reportType: 'opportunity',
    synthetic: true,
    artifactId: 'research:one',
    generatedAt: '2026-07-24T00:00:00.000Z',
    opportunity: {
      id: 'opportunity:one',
      slug: 'private-opportunity',
      name: 'Private opportunity',
      thesis: 'A thesis',
      audience: 'Users',
      firstWedge: 'A wedge'
    },
    evidence: { complaintCount: 0, clusterCount: 0, observations: [], clusters: [] },
    inference: {
      scoreSnapshot: {
        score: 0,
        version: 'fixture-score-v1',
        calculatedAt: '2026-07-24T00:00:00.000Z',
        factors: {
          complaintVolume: 0,
          painSeverity: 0,
          recurrence: 0,
          willingnessToPay: 0,
          competitiveGap: 0,
          buildFeasibility: 0,
          evidenceQuality: 0,
          contraryEvidencePenalty: 0
        },
        weights: {
          complaintVolume: 0,
          painSeverity: 0,
          recurrence: 0,
          willingnessToPay: 0,
          competitiveGap: 0,
          buildFeasibility: 0,
          evidenceQuality: 0,
          contraryEvidencePenalty: 0
        }
      },
      confidence: 'low',
      rationale: [],
      contraryEvidence: []
    },
    recommendation: {
      decision: 'defer',
      firstWedge: 'A wedge',
      nextSteps: ['Validate the strongest uncertainty']
    },
    coverage: { gaps: ['No live source'], sources: [] },
    warnings: ['Synthetic fixture only']
  },
  generatedAt: '2026-07-24T00:00:00.000Z',
  approvalState: 'approved'
}

describe('workspace report routes', () => {
  beforeEach(() => {
    mocks.readSession.mockResolvedValue(session)
    mocks.requireRecentMutationStepUp.mockResolvedValue(null)
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.updateWorkspaceReportApproval.mockReset()
    mocks.repository.exportWorkspaceReport.mockReset()
  })

  it('blocks approval until the session has recent password and MFA proof', async () => {
    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent reauthentication required' }, { status: 428 })
    )
    const stalePassword = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(stalePassword.status).toBe(428)
    expect(mocks.repository.updateWorkspaceReportApproval).not.toHaveBeenCalled()

    mocks.requireRecentMutationStepUp.mockResolvedValue(
      Response.json({ error: 'Recent MFA verification required' }, { status: 428 })
    )
    const staleMfa = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(staleMfa.status).toBe(428)
    expect(mocks.repository.updateWorkspaceReportApproval).not.toHaveBeenCalled()
  })

  it('validates same-origin approval actions and maps governance conflicts', async () => {
    const invalid = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved', extra: true }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(invalid.status).toBe(400)
    expect(mocks.repository.updateWorkspaceReportApproval).not.toHaveBeenCalled()

    mocks.repository.updateWorkspaceReportApproval.mockResolvedValue(report)
    const updated = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ data: { approvalState: 'approved' } })

    mocks.repository.updateWorkspaceReportApproval.mockRejectedValue(
      new WorkspaceReportApprovalConflictError()
    )
    const conflict = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approved' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(conflict.status).toBe(409)

    mocks.repository.updateWorkspaceReportApproval.mockRejectedValue(
      new WorkspaceReportPermissionError()
    )
    const forbidden = await updateReport(
      new Request('https://appsea.example', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reviewed' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' }) }
    )
    expect(forbidden.status).toBe(403)
  })

  it('exports approved reports and blocks unapproved exports', async () => {
    mocks.repository.exportWorkspaceReport.mockResolvedValue({
      report,
      manifestHash: 'a'.repeat(64)
    })
    const response = await exportReport(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('appsea-report.json')
    await expect(response.json()).resolves.toMatchObject({
      data: { manifestHash: 'a'.repeat(64), report: { approvalState: 'approved' } }
    })

    mocks.repository.exportWorkspaceReport.mockRejectedValue(new WorkspaceReportNotApprovedError())
    const blocked = await exportReport(new Request('https://appsea.example'), {
      params: Promise.resolve({ workspaceId: 'workspace:one', reportId: 'report:one' })
    })
    expect(blocked.status).toBe(409)
  })
})
