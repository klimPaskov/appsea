import { describe, expect, it } from 'vitest'
import type { AuthSessionReadModel, WorkflowJobReadModel } from '@appsea/contracts'
import {
  canReadFixtureWorkflow,
  canStartFixtureWorkflow,
  parseFixtureWorkflowStartRequest,
  publicWorkflowStatus
} from './fixture-workflow-gateway'

const session: AuthSessionReadModel = {
  sessionId: 'session:one',
  user: {
    userId: 'user:one',
    email: 'user@example.com',
    displayName: 'User',
    createdAt: '2026-07-24T00:00:00.000Z'
  },
  workspaces: [
    {
      workspaceId: 'workspace:fixture',
      slug: 'fixture-workspace',
      displayName: 'Fixture workspace',
      visibility: 'private',
      fixtureOnly: true,
      role: 'owner'
    },
    {
      workspaceId: 'workspace:private',
      slug: 'private-workspace',
      displayName: 'Private workspace',
      visibility: 'private',
      fixtureOnly: false,
      role: 'editor'
    },
    {
      workspaceId: 'workspace:viewer',
      slug: 'viewer-workspace',
      displayName: 'Viewer workspace',
      visibility: 'private',
      fixtureOnly: true,
      role: 'viewer'
    }
  ],
  expiresAt: '2026-08-24T00:00:00.000Z'
}

const request = {
  workspaceId: 'workspace:fixture',
  campaignId: 'campaign:one',
  runId: 'run:one',
  idempotencyKey: 'fixture-workflow-idempotency',
  workflowVersion: 'fixture-research-v1' as const,
  fixtureAt: '2026-07-24T00:00:00.000Z',
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  }
}

describe('fixture workflow web gateway helpers', () => {
  it('requires path and body workspace IDs to match exactly', () => {
    expect(parseFixtureWorkflowStartRequest('workspace:fixture', request)).toEqual(request)
    expect(parseFixtureWorkflowStartRequest('workspace:private', { ...request })).toBeNull()
    expect(
      parseFixtureWorkflowStartRequest('workspace:fixture', {
        ...request,
        unexpected: true
      })
    ).toBeNull()
  })

  it('allows fixture starts only for owner/editor fixture workspaces', () => {
    expect(canStartFixtureWorkflow(session, 'workspace:fixture')).toBe(true)
    expect(canStartFixtureWorkflow(session, 'workspace:private')).toBe(false)
    expect(canStartFixtureWorkflow(session, 'workspace:viewer')).toBe(false)
    expect(canReadFixtureWorkflow(session, 'workspace:viewer')).toBe(true)
    expect(canReadFixtureWorkflow(session, 'workspace:missing')).toBe(false)
  })

  it('removes workflow input hashes from browser status responses', () => {
    const status: WorkflowJobReadModel = {
      workspaceId: 'workspace:fixture',
      workflowId: 'workflow:fixture:one',
      temporalFirstExecutionRunId: '00000000-0000-0000-0000-000000000001',
      workflowType: 'fixtureResearchWorkflow',
      workflowVersion: 'fixture-research-v1',
      taskQueue: 'appsea-research-v1',
      campaignId: 'campaign:one',
      requestedResearchRunId: 'run:one',
      requestedBy: { actorType: 'service', actorId: 'appsea-worker' },
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
      state: 'running',
      checkpoint: 'initialized',
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      activityAttempts: 1,
      persistedRunId: null,
      opportunityId: null,
      scoreSnapshotId: null,
      planPackageId: null,
      failureCode: null,
      failureSummary: null,
      requestedAt: '2026-07-24T00:00:00.000Z',
      startedAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
      finishedAt: null
    }
    const publicStatus = publicWorkflowStatus(status)
    expect(publicStatus).not.toHaveProperty('inputHash')
    expect(publicStatus).not.toHaveProperty('idempotencyDigest')
    expect(publicStatus.workflowId).toBe(status.workflowId)
  })
})
