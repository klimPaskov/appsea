import { describe, expect, it } from 'vitest'
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

  it('purges expired production workflow admissions with the retention budget', async () => {
    const calls: string[] = []
    const result = await runSourceMaintenance(
      {
        jobId: 'maintenance:source:admissions',
        occurredAt,
        quotaBatchSize: 1,
        deletionBatchSize: 1,
        retentionBatchSize: 2,
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

  it('rejects an unbounded workspace enumeration before doing maintenance work', async () => {
    await expect(
      runSourceMaintenance(
        {
          jobId: 'maintenance:source:workspaces',
          occurredAt,
          quotaBatchSize: 1,
          deletionBatchSize: 1,
          retentionBatchSize: 1,
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
    let received: { retentionDays: number; batchSize: number } | undefined
    const result = await runAuthRetention(
      { jobId: 'maintenance:auth:test', retentionDays: 14, batchSize: 20 },
      {
        auth: {
          async purgeExpiredSessions(retentionDays, batchSize) {
            received = { retentionDays: retentionDays ?? 0, batchSize: batchSize ?? 0 }
            return {
              sessionsDeleted: 3,
              rateLimitsDeleted: 4,
              passwordResetTokensDeleted: 5,
              workspaceInvitationsDeleted: 6
            }
          }
        }
      }
    )

    expect(received).toEqual({ retentionDays: 14, batchSize: 20 })
    expect(result).toEqual({
      jobId: 'maintenance:auth:test',
      sessionsDeleted: 3,
      rateLimitsDeleted: 4,
      passwordResetTokensDeleted: 5,
      workspaceInvitationsDeleted: 6
    })
  })
})
