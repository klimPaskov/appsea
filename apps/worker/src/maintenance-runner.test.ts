import { describe, expect, it } from 'vitest'
import type {
  MaintenanceSchedulerFence,
  SourceSnapshotReconciliationReadModel
} from '@appsea/contracts'
import type { DeletionPropagationResult } from '@appsea/db'
import { runAuthRetention, runSourceMaintenance } from './maintenance-runner'

const occurredAt = '2026-07-10T00:00:00.000Z'

function deletionResult(affectedObjectCount: number): DeletionPropagationResult {
  return {
    tombstone: {
      workspaceId: 'workspace:test',
      tombstoneId: 'tombstone:test',
      sourceId: 'source:test',
      sourceRecordId: 'record:test',
      reason: 'retention',
      state: 'completed',
      receivedAt: occurredAt,
      processingStartedAt: occurredAt,
      completedAt: occurredAt,
      affectedObjectCount,
      attemptCount: 1,
      nextAttemptAt: null,
      failureCode: null,
      failureSummary: null
    },
    sourceItemCount: 0,
    evidenceCount: 0,
    analysisCount: 0,
    opportunityCount: 0,
    recomputationJobsQueued: 0,
    reportCount: 0,
    planCount: 0,
    affectedObjectCount
  }
}

function snapshotResult(
  workspaceId: string,
  state: SourceSnapshotReconciliationReadModel['state'],
  coverageGaps: readonly string[] = []
): SourceSnapshotReconciliationReadModel {
  return {
    workspaceId,
    reconciliationId: 'reconciliation:source:0123456789abcdef0123456789abcdef',
    sourceId: 'cfpb-consumer-complaints',
    policyVersion: 'cfpb-2026-07-v1',
    state,
    attemptCount: 1,
    pagesScanned: 1,
    sourceRecordCount: 1,
    deletionCount: 0,
    coverageGaps: [...coverageGaps],
    warnings: [],
    failureCode: state === 'failed' ? 'reconciliation_failed' : null,
    failureSummary: state === 'failed' ? 'retryable fixture failure' : null,
    observedAt: occurredAt,
    requestedAt: occurredAt,
    finishedAt: state === 'queued' || state === 'running' ? null : occurredAt,
    inputHash: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    pageSize: 1,
    maxRecords: 1,
    nextOffset: 1,
    nextAttemptAt: occurredAt,
    updatedAt: occurredAt
  }
}

describe('maintenance runners', () => {
  it('sorts workspaces and keeps quota expiry and purge budgets independent', async () => {
    const quotaCalls: string[] = []
    const deletionCalls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:test',
        occurredAt,
        quotaBatchSize: 2,
        deletionBatchSize: 2,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return ['workspace:z', 'workspace:a', 'workspace:a']
          },
          async expireStale(workspaceId, before, batchSize) {
            const boundedBatchSize = batchSize ?? 0
            quotaCalls.push(`expire:${workspaceId}:${before}:${boundedBatchSize}`)
            return boundedBatchSize
          },
          async purgeSettled(workspaceId, before, batchSize) {
            const boundedBatchSize = batchSize ?? 0
            quotaCalls.push(`purge:${workspaceId}:${before}:${boundedBatchSize}`)
            return boundedBatchSize
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:z', 'workspace:a', 'workspace:a']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext(workspaceId) {
            deletionCalls.push(workspaceId)
            if (deletionCalls.filter((value) => value === workspaceId).length === 1) {
              return deletionResult(workspaceId === 'workspace:a' ? 3 : 5)
            }
            return null
          }
        }
      }
    )

    expect(result).toEqual({
      jobId: 'maintenance:source:test',
      quotaWorkspacesScanned: 2,
      deletionWorkspacesScanned: 2,
      quotaReservationsExpired: 2,
      quotaReservationsPurged: 2,
      productionWorkflowAdmissionsPurged: 0,
      productionAnalysisAdmissionsPurged: 0,
      sourceCollectionLeasesPurged: 0,
      productionAnalysisObjectsPurged: 0,
      sourceSnapshotReconciliationsProcessed: 0,
      sourceSnapshotReconciliationsCompleted: 0,
      sourceSnapshotReconciliationsIncomplete: 0,
      sourceSnapshotReconciliationsFailed: 0,
      sourceSnapshotReconciliationsRetried: 0,
      sourceSnapshotCoverageGaps: 0,
      campaignRefreshClaims: 0,
      campaignRefreshDispatched: 0,
      campaignRefreshFailed: 0,
      campaignRefreshPolicyDenied: 0,
      campaignOrchestrationClaims: 0,
      campaignOrchestrationDispatched: 0,
      campaignOrchestrationFailed: 0,
      campaignOrchestrationPolicyDenied: 0,
      campaignOrchestrationReconciled: 0,
      productionWorkflowCancellationTargets: 0,
      productionWorkflowCancellationAttempted: 0,
      productionWorkflowCancellationDispatched: 0,
      productionWorkflowCancellationFailed: 0,
      retentionTombstonesQueued: 0,
      deletionTombstonesProcessed: 2,
      deletionObjectsAffected: 8,
      deletionOpportunitiesInvalidated: 0,
      recomputationJobsQueued: 0
    })
    expect(quotaCalls).toEqual([
      'expire:workspace:a:2026-07-10T00:00:00.000Z:2',
      'purge:workspace:a:2026-07-03T00:00:00.000Z:2'
    ])
    expect(deletionCalls).toEqual(['workspace:a', 'workspace:a', 'workspace:z'])
  })

  it('honors a specific deletion workspace without listing all workspaces', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:specific',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 1,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 30,
        workspaceId: 'workspace:target'
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            throw new Error('must not list when a workspace is selected')
          },
          async enqueueExpired() {
            return 0
          },
          async processNext(workspaceId) {
            calls.push(workspaceId)
            return null
          }
        }
      }
    )

    expect(result.deletionWorkspacesScanned).toBe(1)
    expect(calls).toEqual(['workspace:target'])
  })

  it('runs the bounded multi-source orchestration callback and records its counters', async () => {
    let calls = 0
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:orchestration',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 1,
        snapshotReconciliationBatchSize: 0,
        campaignOrchestrationBatchSize: 1,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return []
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        campaignOrchestration: async () => {
          calls += 1
          return {
            workspacesScanned: 2,
            claims: 1,
            dispatched: 1,
            failed: 0,
            policyDenied: 0,
            reconciled: 1
          }
        }
      }
    )

    expect(calls).toBe(1)
    expect(result.campaignOrchestrationClaims).toBe(1)
    expect(result.campaignOrchestrationDispatched).toBe(1)
    expect(result.campaignOrchestrationReconciled).toBe(1)
  })

  it('resumes one due snapshot per sorted workspace within its independent budget', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:snapshots',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 1,
        snapshotReconciliationBatchSize: 2,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:z', 'workspace:a', 'workspace:b']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        snapshotReconciliation: async (workspaceId) => {
          calls.push(workspaceId)
          return workspaceId === 'workspace:a'
            ? snapshotResult(workspaceId, 'completed')
            : snapshotResult(workspaceId, 'queued', ['bounded snapshot retry'])
        }
      }
    )

    expect(calls).toEqual(['workspace:a', 'workspace:b'])
    expect(result.sourceSnapshotReconciliationsProcessed).toBe(2)
    expect(result.sourceSnapshotReconciliationsCompleted).toBe(1)
    expect(result.sourceSnapshotReconciliationsIncomplete).toBe(0)
    expect(result.sourceSnapshotReconciliationsFailed).toBe(0)
    expect(result.sourceSnapshotReconciliationsRetried).toBe(1)
    expect(result.sourceSnapshotCoverageGaps).toBe(1)
  })

  it('purges expired production workflow admissions with the retention budget', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:admissions',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:b', 'workspace:a']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        admission: {
          async purge(workspaceId, before, batchSize) {
            calls.push(`${workspaceId}:${before}:${batchSize}`)
            return batchSize ?? 0
          }
        }
      }
    )

    expect(result.productionWorkflowAdmissionsPurged).toBe(2)
    expect(calls).toEqual(['workspace:a:2026-07-03T00:00:00.000Z:2'])
  })

  it('purges terminal source collection leases with the retention budget', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:leases',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:b', 'workspace:a']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        leases: {
          async purge(workspaceId, before, batchSize) {
            calls.push(`${workspaceId}:${before}:${batchSize}`)
            return batchSize ?? 0
          }
        }
      }
    )

    expect(result.sourceCollectionLeasesPurged).toBe(2)
    expect(calls).toEqual(['workspace:a:2026-07-03T00:00:00.000Z:2'])
  })

  it('purges terminal manual-analysis admissions with the same bounded retention budget', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:analysis-admissions',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:b', 'workspace:a']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        analysisAdmission: {
          async purge(workspaceId, before, batchSize) {
            calls.push(`${workspaceId}:${before}:${batchSize}`)
            return batchSize ?? 0
          }
        }
      }
    )

    expect(result.productionAnalysisAdmissionsPurged).toBe(2)
    expect(calls).toEqual(['workspace:a:2026-07-03T00:00:00.000Z:2'])
  })

  it('queues policy retention tombstones with an independent bounded budget', async () => {
    const retentionCalls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:retention',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:b', 'workspace:a']
          },
          async enqueueExpired(workspaceId, _occurredAt, batchSize) {
            retentionCalls.push(`${workspaceId}:${batchSize}`)
            return batchSize
          },
          async processNext() {
            return null
          }
        }
      }
    )

    expect(result.retentionTombstonesQueued).toBe(2)
    expect(retentionCalls).toEqual(['workspace:a:2'])
  })

  it('processes due object purges with the retention budget after deletion propagation', async () => {
    const purgeCalls: string[] = []
    let processed = 0
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:objects',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
        snapshotReconciliationBatchSize: 0,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return ['workspace:b', 'workspace:a']
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        objectPurge: {
          async processNext(workspaceId) {
            purgeCalls.push(workspaceId)
            processed += 1
            return {
              purged: processed !== 2,
              record: {} as never
            }
          }
        }
      }
    )

    expect(result.productionAnalysisObjectsPurged).toBe(2)
    expect(purgeCalls).toEqual(['workspace:a', 'workspace:a', 'workspace:a'])
  })

  it('rejects repository counters that exceed the requested maintenance budget', async () => {
    await expect(
      runSourceMaintenance(
        {
          jobId: 'maintenance:source:bounded',
          occurredAt,
          quotaBatchSize: 2,
          deletionBatchSize: 1,
          retentionBatchSize: 1,
          snapshotReconciliationBatchSize: 0,
          quotaRetentionDays: 7,
          workspaceId: null
        },
        {
          quota: {
            async listActiveWorkspaceIds() {
              return ['workspace:a']
            },
            async expireStale() {
              return 3
            },
            async purgeSettled() {
              return 0
            }
          },
          deletion: {
            async listActiveWorkspaceIds() {
              return []
            },
            async enqueueExpired() {
              return 0
            },
            async processNext() {
              return null
            }
          }
        }
      )
    ).rejects.toThrow('quotaReservationsExpired')
  })

  it('runs the bounded campaign refresh callback only when configured', async () => {
    let calls = 0
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:campaign-refresh',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 1,
        snapshotReconciliationBatchSize: 0,
        campaignRefreshBatchSize: 1,
        quotaRetentionDays: 7,
        workspaceId: null
      },
      {
        quota: {
          async listActiveWorkspaceIds() {
            return []
          },
          async expireStale() {
            return 0
          },
          async purgeSettled() {
            return 0
          }
        },
        deletion: {
          async listActiveWorkspaceIds() {
            return []
          },
          async enqueueExpired() {
            return 0
          },
          async processNext() {
            return null
          }
        },
        campaignRefresh: async () => {
          calls += 1
          return { workspacesScanned: 2, claims: 1, dispatched: 1, failed: 0, policyDenied: 0 }
        }
      }
    )

    expect(calls).toBe(1)
    expect(result).toMatchObject({ campaignRefreshClaims: 1, campaignRefreshDispatched: 1 })
  })

  it('rejects an unbounded workspace enumeration before doing maintenance work', async () => {
    await expect(
      runSourceMaintenance(
        {
          jobId: 'maintenance:source:workspaces',
          occurredAt,
          quotaBatchSize: 1,
          deletionBatchSize: 1,
          retentionBatchSize: 1,
          snapshotReconciliationBatchSize: 0,
          quotaRetentionDays: 7,
          workspaceId: null
        },
        {
          quota: {
            async listActiveWorkspaceIds() {
              return Array.from({ length: 10_001 }, (_, index) => `workspace:${index}`)
            },
            async expireStale() {
              throw new Error('must not process an unbounded list')
            },
            async purgeSettled() {
              throw new Error('must not process an unbounded list')
            }
          },
          deletion: {
            async listActiveWorkspaceIds() {
              return []
            },
            async enqueueExpired() {
              return 0
            },
            async processNext() {
              return null
            }
          }
        }
      )
    ).rejects.toThrow('workspace count')
  })

  it('passes bounded authentication retention settings through to the repository', async () => {
    const fence = {
      schedulerName: 'appsea-auth-maintenance-v1',
      ownerId: 'worker:host:1',
      leaseToken: 'token:worker:host:123'
    } as const
    let received:
      | { retentionDays: number; batchSize: number; fence: MaintenanceSchedulerFence | undefined }
      | undefined
    const result = await runAuthRetention(
      { jobId: 'maintenance:auth:test', retentionDays: 14, batchSize: 20 },
      {
        auth: {
          async purgeExpiredSessions(retentionDays, batchSize, receivedFence) {
            received = {
              retentionDays: retentionDays ?? 0,
              batchSize: batchSize ?? 0,
              fence: receivedFence
            }
            return {
              sessionsDeleted: 3,
              rateLimitsDeleted: 4,
              passwordResetTokensDeleted: 5,
              workspaceInvitationsDeleted: 6,
              mfaChallengesDeleted: 7,
              mfaEventsDeleted: 8,
              mfaPendingEnrollmentsDeleted: 9
            }
          }
        },
        fence
      }
    )

    expect(received).toEqual({ retentionDays: 14, batchSize: 20, fence })
    expect(result).toEqual({
      jobId: 'maintenance:auth:test',
      sessionsDeleted: 3,
      rateLimitsDeleted: 4,
      passwordResetTokensDeleted: 5,
      workspaceInvitationsDeleted: 6,
      mfaChallengesDeleted: 7,
      mfaEventsDeleted: 8,
      mfaPendingEnrollmentsDeleted: 9
    })
  })
})
