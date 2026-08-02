import { describe, expect, it, vi } from 'vitest'
import { prepareProductionCollectionWorkflowStart } from '@appsea/workflows'
import { ProductionWorkflowRateLimitError } from '@appsea/db'
import { runCampaignOrchestration } from './campaign-orchestration-runner'
import type { ResearchCampaignOrchestrationClaim } from '@appsea/db'

const now = '2026-08-02T12:00:00.000Z'

const configuration = {
  schemaVersion: 'campaign-v1' as const,
  goal: 'Find recurring customer problems across approved sources',
  query: 'billing',
  seeds: ['billing'],
  sourceIds: ['cfpb-consumer-complaints', 'stackexchange-stackoverflow'],
  languages: ['en'],
  geographies: ['US'],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 25,
  refreshPolicy: 'manual' as const,
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
  overrides: Partial<ResearchCampaignOrchestrationClaim> = {}
): ResearchCampaignOrchestrationClaim {
  return {
    workspaceId: 'workspace:one',
    orchestrationId: 'run:campaign:multi',
    campaignId: 'campaign:one',
    sourceId: configuration.sourceIds[0]!,
    childRunId: 'run:campaign-source:one',
    purpose: 'market-research',
    configuration,
    budget,
    analysisSeedReviewId: null,
    requestedAt: now,
    attemptCount: 1,
    policyVersion: null,
    workflowId: null,
    ...overrides
  }
}

function dependencies(claim: ResearchCampaignOrchestrationClaim) {
  return {
    orchestrations: {
      listWorkspaceIdsForService: vi.fn().mockResolvedValue([claim.workspaceId]),
      listActiveOrchestrationIdsForService: vi.fn().mockResolvedValue([]),
      claimNextSourceForService: vi.fn().mockResolvedValue(claim),
      markSourceDispatchedForService: vi.fn().mockResolvedValue(undefined),
      markSourceFailedForService: vi.fn().mockResolvedValue(undefined),
      reconcileForService: vi.fn().mockResolvedValue(undefined)
    },
    policies: {
      readCollectible: vi.fn().mockResolvedValue({
        policy: {
          sourceId: claim.sourceId,
          displayName: 'Approved complaints',
          sourceType: 'api',
          enabled: true,
          policyState: 'approved',
          permittedPurposes: ['market-research'],
          commercialUse: 'allowed',
          accessMethod: 'api',
          retentionDays: 30,
          deletionRequired: true,
          attributionRequired: false,
          displayMode: 'metadata-only',
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
        policyVersion: 'cfpb-v1',
        contentHash: 'a'.repeat(64)
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

describe('runCampaignOrchestration', () => {
  it('dispatches one durable child through policy, admission, and Temporal boundaries', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    const result = await runCampaignOrchestration(
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
      policyDenied: 0,
      reconciled: 1
    })
    expect(deps.admission.admitForService).toHaveBeenCalledTimes(1)
    expect(deps.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: claim.childRunId,
        sourceId: claim.sourceId,
        policyVersion: 'cfpb-v1'
      })
    )
    expect(deps.orchestrations.markSourceDispatchedForService).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: claim.sourceId, childRunId: claim.childRunId })
    )
    expect(deps.orchestrations.reconcileForService).toHaveBeenCalledTimes(1)
  })

  it('fails closed on a missing approved policy without opening admission or HTTP', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    deps.policies.readCollectible.mockResolvedValue(null)
    const result = await runCampaignOrchestration(
      {
        batchSize: 1,
        claimOwner: 'worker:host-1:123',
        claimLeaseSeconds: 60,
        retryAfterSeconds: 300,
        occurredAt: now
      },
      deps
    )

    expect(result).toMatchObject({ claims: 1, dispatched: 0, failed: 1, policyDenied: 1 })
    expect(deps.admission.admitForService).not.toHaveBeenCalled()
    expect(deps.startWorkflow).not.toHaveBeenCalled()
    expect(deps.orchestrations.markSourceFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'source_policy_denied', terminal: true })
    )
  })

  it('keeps a rate-limited child queued for bounded retry', async () => {
    const claim = claimFor()
    const deps = dependencies(claim)
    deps.admission.admitForService.mockRejectedValue(new ProductionWorkflowRateLimitError(120))
    const result = await runCampaignOrchestration(
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
    expect(deps.orchestrations.markSourceFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'admission_rate_limited',
        retryAfterSeconds: 120,
        terminal: false
      })
    )
    expect(deps.startWorkflow).not.toHaveBeenCalled()
  })

  it('does not dispatch an unregistered connector', async () => {
    const claim = claimFor({ sourceId: 'unregistered-source' })
    const deps = dependencies(claim)
    const result = await runCampaignOrchestration(
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
    expect(deps.orchestrations.markSourceFailedForService).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'source_unsupported', terminal: true })
    )
  })
})
