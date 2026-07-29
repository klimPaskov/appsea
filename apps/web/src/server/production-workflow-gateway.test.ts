import { describe, expect, it } from 'vitest'
import type { AuthSessionReadModel } from '@appsea/contracts'
import {
  canReadProductionWorkflow,
  canStartProductionWorkflow,
  parseProductionWorkflowStartRequest,
  productionWorkflowBelongsToWorkspace
} from './production-workflow-gateway'

const session: AuthSessionReadModel = {
  sessionId: 'session:production',
  user: {
    userId: 'user:production',
    email: 'user@example.com',
    displayName: 'Production user',
    createdAt: '2026-07-24T00:00:00.000Z'
  },
  workspaces: [
    {
      workspaceId: 'workspace:private',
      slug: 'private-workspace',
      displayName: 'Private workspace',
      visibility: 'private',
      fixtureOnly: false,
      role: 'editor'
    },
    {
      workspaceId: 'workspace:fixture',
      slug: 'fixture-workspace',
      displayName: 'Fixture workspace',
      visibility: 'private',
      fixtureOnly: true,
      role: 'owner'
    },
    {
      workspaceId: 'workspace:viewer',
      slug: 'viewer-workspace',
      displayName: 'Viewer workspace',
      visibility: 'private',
      fixtureOnly: false,
      role: 'viewer'
    },
    {
      workspaceId: 'workspace:public',
      slug: 'public-workspace',
      displayName: 'Public workspace',
      visibility: 'public',
      fixtureOnly: false,
      role: 'editor'
    }
  ],
  expiresAt: '2026-08-24T00:00:00.000Z'
}

const request = {
  workspaceId: 'workspace:private',
  campaignId: 'campaign:production',
  runId: 'run:production',
  idempotencyKey: 'production-workflow-idempotency',
  workflowVersion: 'production-collection-v1' as const,
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-v1',
  query: 'billing',
  limit: 10,
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt' as const,
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 10,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  requestedAt: '2026-07-24T00:00:00.000Z'
}

describe('production workflow web gateway helpers', () => {
  it('requires path and body workspace IDs to match', () => {
    expect(parseProductionWorkflowStartRequest('workspace:private', request)).toEqual(request)
    expect(parseProductionWorkflowStartRequest('workspace:viewer', request)).toBeNull()
  })

  it('allows production starts only for owner/editor non-fixture workspaces', () => {
    expect(canStartProductionWorkflow(session, 'workspace:private')).toBe(true)
    expect(canStartProductionWorkflow(session, 'workspace:fixture')).toBe(false)
    expect(canStartProductionWorkflow(session, 'workspace:viewer')).toBe(false)
    expect(canStartProductionWorkflow(session, 'workspace:public')).toBe(false)
    expect(canReadProductionWorkflow(session, 'workspace:viewer')).toBe(true)
    expect(canReadProductionWorkflow(session, 'workspace:missing')).toBe(false)
  })

  it('binds status reads to the workspace encoded in the workflow ID', () => {
    expect(
      productionWorkflowBelongsToWorkspace(
        'workflow:production:workspace:private:abcdef0123456789abcdef0123456789',
        'workspace:private'
      )
    ).toBe(true)
    expect(
      productionWorkflowBelongsToWorkspace(
        'workflow:production:workspace:other:abcdef',
        'workspace:private'
      )
    ).toBe(false)
    expect(
      productionWorkflowBelongsToWorkspace(
        'workflow:production:workspace:private:team:abcdef0123456789abcdef0123456789',
        'workspace:private'
      )
    ).toBe(false)
    expect(
      productionWorkflowBelongsToWorkspace(
        'workflow:production:workspace:private:team:abcdef0123456789abcdef0123456789',
        'workspace:private:team'
      )
    ).toBe(true)
  })
})
