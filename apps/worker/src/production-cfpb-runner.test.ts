import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  completed: undefined as unknown,
  lease: {
    decision: 'acquired' as 'acquired' | 'replayed',
    replayed: false,
    observedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: '2026-07-10T00:30:00.000Z'
  },
  acquireInput: undefined as unknown,
  connectorObservedAt: undefined as string | undefined,
  connectorRequest: undefined as unknown,
  persistInput: undefined as unknown,
  asserted: false,
  released: false
}))

vi.mock('@appsea/connectors', () => ({
  CfpbConnector: class {
    private readonly now: () => string

    constructor(options: { now: () => string }) {
      this.now = options.now
    }

    async collect(request: unknown) {
      state.connectorObservedAt = this.now()
      state.connectorRequest = request
      return {
        policy: {
          sourceId: 'cfpb-consumer-complaints',
          displayName: 'CFPB Consumer Complaint Database',
          sourceType: 'api',
          enabled: true,
          policyState: 'approved',
          permittedPurposes: ['opportunity-research'],
          commercialUse: 'allowed',
          accessMethod: 'official API',
          retentionDays: 30,
          deletionRequired: true,
          attributionRequired: true,
          displayMode: 'excerpt',
          coverageNotes: ['test'],
          reviewedAt: '2026-07-10T00:00:00.000Z',
          policyDocumentRef: 'https://example.com/policy'
        },
        complaints: [],
        deletions: [],
        warnings: []
      }
    }
  },
  SourceQuotaReservationReplayError: class extends Error {}
}))

vi.mock('@appsea/db', () => ({
  contentHash: () => 'a'.repeat(64),
  PostgresProductionCollectionRepository: class {
    async readCompletedIdentity() {
      return state.completed
    }

    async persist(input: unknown) {
      state.persistInput = input
      return {
        workspaceId: 'workspace:one',
        campaignId: 'campaign:one',
        runId: 'run:one',
        artifactId: 'production-collection:artifact',
        sourceId: 'cfpb-consumer-complaints',
        policyVersion: 'cfpb-v1',
        sourceItemCount: 0,
        evidenceCount: 0,
        complaintCount: 0,
        deletionCount: 0,
        coverageGaps: [],
        warnings: [],
        state: 'completed',
        completedAt: '2026-07-10T00:00:00.000Z',
        replayed: false
      }
    }
  },
  PostgresSourcePolicyRepository: class {
    async readCollectible() {
      return {
        policy: {
          sourceId: 'cfpb-consumer-complaints',
          displayName: 'CFPB Consumer Complaint Database',
          sourceType: 'api',
          enabled: true,
          policyState: 'approved',
          permittedPurposes: ['opportunity-research'],
          commercialUse: 'allowed',
          accessMethod: 'official API',
          retentionDays: 30,
          deletionRequired: true,
          attributionRequired: true,
          displayMode: 'excerpt',
          coverageNotes: ['test'],
          reviewedAt: '2026-07-10T00:00:00.000Z',
          policyDocumentRef: 'https://example.com/policy'
        },
        policyVersion: 'cfpb-v1',
        contentHash: 'b'.repeat(64)
      }
    }
  },
  PostgresSourceQuotaRepository: class {},
  PostgresSourceCollectionLeaseRepository: class {
    async acquire(input: unknown) {
      state.acquireInput = input
      return state.lease
    }

    async assertActive() {
      state.asserted = true
      return true
    }

    async release() {
      state.released = true
      return true
    }
  }
}))

import { runProductionCfpbCollection } from './production-cfpb-runner'

const request = {
  workspaceId: 'workspace:one',
  campaignId: 'campaign:one',
  runId: 'run:one',
  idempotencyKey: 'a'.repeat(64),
  sourceId: 'cfpb-consumer-complaints',
  policyVersion: 'cfpb-v1',
  query: 'card',
  limit: 1,
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt' as const,
  budget: {
    currency: 'USD' as const,
    maxSourceItems: 1,
    maxCostMicros: 0,
    maxActivityAttempts: 3
  },
  requestedAt: '2026-07-10T00:00:00.000Z'
}

describe('production CFPB runner lease lifecycle', () => {
  it('passes one observed timestamp through lease, connector, and persistence', async () => {
    state.lease = {
      decision: 'acquired',
      replayed: false,
      observedAt: '2026-07-10T00:00:00.000Z',
      expiresAt: '2026-07-10T00:30:00.000Z'
    }
    state.acquireInput = undefined
    state.connectorObservedAt = undefined
    state.persistInput = undefined
    state.asserted = false
    state.released = false

    await runProductionCfpbCollection({} as never, request, {
      observedAt: '2026-07-10T00:00:00.000Z'
    })

    expect(state.acquireInput).toMatchObject({
      workspaceId: request.workspaceId,
      sourceId: request.sourceId,
      policyVersion: request.policyVersion,
      observedAt: '2026-07-10T00:00:00.000Z'
    })
    expect(state.connectorObservedAt).toBe('2026-07-10T00:00:00.000Z')
    expect(state.persistInput).toMatchObject({ observedAt: '2026-07-10T00:00:00.000Z' })
    expect(state.asserted).toBe(true)
    expect(state.released).toBe(true)
  })

  it('uses the lease timestamp on replay instead of the new workflow hint', async () => {
    state.lease = {
      decision: 'replayed',
      replayed: true,
      observedAt: '2026-07-09T23:59:00.000Z',
      expiresAt: '2026-07-10T00:30:00.000Z'
    }
    state.connectorObservedAt = undefined
    state.persistInput = undefined
    state.asserted = false
    state.released = false

    await runProductionCfpbCollection({} as never, request, {
      observedAt: '2026-07-10T00:05:00.000Z'
    })

    expect(state.connectorObservedAt).toBe('2026-07-09T23:59:00.000Z')
    expect(state.persistInput).toMatchObject({ observedAt: '2026-07-09T23:59:00.000Z' })
  })
})
