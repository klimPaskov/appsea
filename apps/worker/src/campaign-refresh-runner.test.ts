import { describe, expect, it, vi } from 'vitest'
import {
  prepareProductionCollectionWorkflowStart,
  type PreparedProductionCollectionWorkflowStart
} from '@appsea/workflows'
import { ProductionWorkflowRateLimitError } from '@appsea/db'
import { runCampaignRefresh } from './campaign-refresh-runner'
import type { ResearchCampaignRefreshClaim } from '@appsea/db'

const now = '2026-08-02T12:00:00.000Z'

const configuration = {
  schemaVersion: 'campaign-v1' as const,
  goal: 'Find permitted recurring customer problems',
  query: 'billing',
  seeds: ['billing'],
  sourceIds: ['cfpb-consumer-complaints'],
  languages: ['en'],
  geographies: ['US'],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 25,
  refreshPolicy: 'daily' as const,
  sensitiveTopicPolicy: 'review' as const,
  requestedDisplayMode: 'metadata-only' as const
}

const budget = {
  currency: 'USD' as const,
  maxSourceItems: 25,
  maxCostMicros: 1_000_000,
  maxActivityAttempts: 3
}

function claimFor(
  overrides: Partial<ResearchCampaignRefreshClaim> = {}
): ResearchCampaignRefreshClaim {
  const effectiveConfiguration = overrides.configuration ?? configuration
  const sourceId = effectiveConfiguration.sourceIds[0] ?? 'cfpb-consumer-complaints'
  const purpose = overrides.purpose ?? 'market-research'
  const request = {
    workspaceId: 'workspace:one',
    campaignId: 'campaign:one',
    runId: 'run:campaign-refresh:one',
    idempotencyKey: `campaign-refresh:${'a'.repeat(64)}`,
    workflowVersion: 'production-collection-v1' as const,
    sourceId,
    policyVersion: 'cfpb-v1',
    query: effectiveConfiguration.query,
    limit: 25,
    purpose,
    requestedDisplayMode: effectiveConfiguration.requestedDisplayMode,
    budget,
    requestedAt: now,
    requestedBy: { actorType: 'service' as const, actorId: 'appsea-worker' as const }
  }
  const prepared: PreparedProductionCollectionWorkflowStart =
    prepareProductionCollectionWorkflowStart(request)
  return {
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    purpose: request.purpose,
    configuration: effectiveConfiguration,
    budget,
    dueAt: now,
    runId: request.runId,
    idempotencyKey: request.idempotencyKey,
    workflowId: prepared.workflowId,
    attemptCount: 1,
    pendingRequest: null,
    pendingIdempotencyDigest: null,
    pendingInputHash: null,
    ...overrides
  }
}

function dependencies(claim: ResearchCampaignRefreshClaim) {
  return {
    campaigns: {
      listRefreshWorkspaceIds: vi.fn().mockResolvedValue([claim.workspaceId]),
      claimNextRefreshForService: vi.fn().mockResolvedValue(claim),
      bindRefreshRequestForService: vi.fn().mockResolvedValue(undefined),
      markRefreshDispatchedForService: vi.fn().mockResolvedValue(undefined),
      markRefreshFailedForService: vi.fn().mockResolvedValue(undefined)
    },
    policies: {
      readCollectible: vi.fn().mockResolvedValue({
        policy: {
          sourceId: claim.configuration.sourceIds[0] ?? 'cfpb-consumer-complaints',
          displayName: 'CFPB complaints',
          sourceType: 'api',
          enabled: true,
          policyState: 'approved',
          permittedPurposes: ['market-research', 'competitor-research'],
          commercialUse: 'allowed',
          accessMethod: 'api',
          retentionDays: 30,
          deletionRequired: true,
          attributionRequired: false,
          displayMode:
            claim.configuration.sourceIds[0] === 'stackexchange-stackoverflow'
              ? 'excerpt'
              : 'metadata-only',
          coverageNotes: [],
          reviewedAt: now,
          quota: {
            requestsPerMinute: 60,
            maxRecordsPerRequest: 5_000,
            maxRecordsPerRun: 50_000,
            costPerRequestMicros: 0
          },
          deletion: {
            sourceRecordIdField: 'complaint_id',
            supportsTombstones: true,
            deletionPollIntervalHours: 24,
            retentionAction: 'tombstone'
          }
        },
        policyVersion:
          claim.configuration.sourceIds[0] === 'stackexchange-stackoverflow'
            ? 'stack-v1'
            : 'cfpb-v1',
        contentHash: 'b'.repeat(64)
      })
    },
    admission: {
      admitForService: vi.fn().mockResolvedValue({
        decision: 'admitted',
        replayed: false,
        retryAfterSeconds: 0,
        reservationExpiresAt: now
      })
    },
    startWorkflow: vi.fn().mockImplementation(async (request) => ({
      workflowId: prepareProductionCollectionWorkflowStart(request).workflowId
    }))
  }
}

describe('runCampaignRefresh', () => {
  it('binds, admits, starts, and completes one policy-approved refresh', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    const result = await runCampaignRefresh(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result).toEqual({
      workspacesScanned: 1,
      claims: 1,
      dispatched: 1,
      failed: 0,
      policyDenied: 0
    })
    expect(deps.campaigns.bindRefreshRequestForService).toHaveBeenCalledTimes(1)
    expect(deps.admission.admitForService).toHaveBeenCalledTimes(1)
    expect(deps.campaigns.markRefreshDispatchedForService).toHaveBeenCalledTimes(1)
    expect(deps.campaigns.markRefreshFailedForService).not.toHaveBeenCalled()
  })

  it('dispatches a Stack Exchange refresh only when its approved policy snapshot matches', async () => {
    const claim = claimFor({
      purpose: 'competitor-research',
      configuration: {
        ...configuration,
        sourceIds: ['stackexchange-stackoverflow'],
        requestedDisplayMode: 'excerpt'
      }
    })
    const deps = dependencies(claim)
    const result = await runCampaignRefresh(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result).toEqual({
      workspacesScanned: 1,
      claims: 1,
      dispatched: 1,
      failed: 0,
      policyDenied: 0
    })
    expect(deps.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'stackexchange-stackoverflow',
        purpose: 'competitor-research',
        requestedDisplayMode: 'excerpt',
        policyVersion: 'stack-v1'
      })
    )
  })

  it('records a policy denial without starting a workflow', async () => {
    const claim = claimFor({
      configuration: { ...configuration, sourceIds: ['unreviewed-source'] }
    })
    const deps = dependencies(claim)
    const result = await runCampaignRefresh(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result.failed).toBe(1)
    expect(result.policyDenied).toBe(0)
    expect(deps.campaigns.markRefreshFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'APPSEA_REFRESH_SOURCE_UNSUPPORTED',
        clearPending: true
      })
    )
    expect(deps.startWorkflow).not.toHaveBeenCalled()
  })

  it('keeps the durable request pending when admission is rate limited', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    deps.admission.admitForService.mockRejectedValue(new ProductionWorkflowRateLimitError(120))
    const result = await runCampaignRefresh(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result).toMatchObject({ claims: 1, dispatched: 0, failed: 1 })
    expect(deps.campaigns.markRefreshFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'APPSEA_REFRESH_ADMISSION_RATE_LIMITED',
        retryAfterSeconds: 120,
        clearPending: false
      })
    )
  })

  it('surfaces an unapproved source policy as a visible policy denial', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    deps.policies.readCollectible.mockResolvedValue(null)
    const result = await runCampaignRefresh(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result).toMatchObject({ claims: 1, failed: 1, policyDenied: 1 })
    expect(deps.campaigns.markRefreshFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'APPSEA_REFRESH_POLICY_DENIED',
        clearPending: true
      })
    )
  })
})
