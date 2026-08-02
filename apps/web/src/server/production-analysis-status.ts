import {
  appseaIdentifierSchema,
  productionAnalysisStatusReadModelSchema,
  productionAnalysisWorkflowStatusSchema,
  type ProductionAnalysisStatusReadModel,
  type ProductionAnalysisWorkflowStatus
} from '@appsea/contracts'
import { PostgresProductionAnalysisRepository } from '@appsea/db/production-analysis'
import { readProductionAnalysisWorkflowStatus } from '@appsea/workflows'
import { getDatabasePool } from './database'
import { getObjectStore } from './object-store'
import { productionAnalysisWorkflowBelongsToWorkspace } from './production-workflow-gateway'
import { getTemporalWorkflowClient } from './temporal'

export class ProductionAnalysisStatusUnavailableError extends Error {
  constructor() {
    super('Production analysis status is temporarily unavailable')
    this.name = 'ProductionAnalysisStatusUnavailableError'
  }
}

export class ProductionAnalysisStatusMismatchError extends Error {
  constructor() {
    super('Production analysis workflow does not match the requested analysis')
    this.name = 'ProductionAnalysisStatusMismatchError'
  }
}

function checkpointForTemporalStatus(
  status: ProductionAnalysisWorkflowStatus
): 'accepted' | 'persisting' | 'completed' | 'failed' | 'canceled' {
  if (status.state === 'queued') return 'accepted'
  if (status.state === 'completed') return 'completed'
  if (status.state === 'failed') return 'failed'
  if (status.state === 'canceled') return 'canceled'
  if (status.state === 'budget_rejected') return 'failed'
  return 'persisting'
}

export function mapProductionAnalysisWorkflowStatus(
  rawStatus: unknown,
  analysisRunId: string
): ProductionAnalysisStatusReadModel {
  const parsedAnalysisRunId = appseaIdentifierSchema.parse(analysisRunId)
  const status = productionAnalysisWorkflowStatusSchema.parse(rawStatus)
  const result = status.result
  if (result?.state === 'completed') {
    if (result.persistence.analysisRunId !== parsedAnalysisRunId) {
      throw new ProductionAnalysisStatusMismatchError()
    }
    return productionAnalysisStatusReadModelSchema.parse({
      analysisRunId: parsedAnalysisRunId,
      collectionRunId: result.persistence.collectionRunId,
      state: 'completed',
      checkpoint: 'completed',
      activityAttempts: status.activityAttempts,
      activityAttemptHistory: [],
      availabilityState: result.persistence.availabilityState,
      opportunityId: result.persistence.opportunityId,
      opportunitySlug: null,
      failureCode: null,
      failureSummary: null,
      requestedAt: null,
      startedAt: null,
      completedAt: result.persistence.completedAt
    })
  }

  const failure = result?.state === 'failed' ? result : null
  const state = status.state === 'budget_rejected' ? 'failed' : status.state
  return productionAnalysisStatusReadModelSchema.parse({
    analysisRunId: parsedAnalysisRunId,
    collectionRunId: null,
    state,
    checkpoint: checkpointForTemporalStatus(status),
    activityAttempts: status.activityAttempts,
    activityAttemptHistory: [],
    availabilityState: 'pending',
    opportunityId: null,
    opportunitySlug: null,
    failureCode: failure?.failureCode ?? null,
    failureSummary: failure?.failureSummary ?? null,
    requestedAt: null,
    startedAt: null,
    completedAt: null
  })
}

export async function readPrivateProductionAnalysisStatus(input: {
  userId: string
  workspaceId: string
  analysisRunId: string
  workflowId?: string | undefined
}): Promise<ProductionAnalysisStatusReadModel | undefined> {
  const parsedUserId = appseaIdentifierSchema.parse(input.userId)
  const parsedWorkspaceId = appseaIdentifierSchema.parse(input.workspaceId)
  const parsedAnalysisRunId = appseaIdentifierSchema.parse(input.analysisRunId)
  const repository = new PostgresProductionAnalysisRepository(getDatabasePool(), getObjectStore())
  let temporalFailed = false

  if (input.workflowId) {
    if (!productionAnalysisWorkflowBelongsToWorkspace(input.workflowId, parsedWorkspaceId)) {
      throw new ProductionAnalysisStatusMismatchError()
    }
    try {
      const temporalStatus = await readProductionAnalysisWorkflowStatus(
        await getTemporalWorkflowClient(),
        input.workflowId
      )
      const mapped = mapProductionAnalysisWorkflowStatus(temporalStatus, parsedAnalysisRunId)
      try {
        const stored = await repository.readStatusForUser(
          parsedUserId,
          parsedWorkspaceId,
          parsedAnalysisRunId
        )
        if (stored && stored.activityAttemptHistory.length > 0) {
          return { ...mapped, activityAttemptHistory: stored.activityAttemptHistory }
        }
      } catch {
        // Temporal remains the freshest safe projection when the database is unavailable.
      }
      return mapped
    } catch (error) {
      if (error instanceof ProductionAnalysisStatusMismatchError) throw error
      temporalFailed = true
    }
  }

  const storedStatus = await repository.readStatusForUser(
    parsedUserId,
    parsedWorkspaceId,
    parsedAnalysisRunId
  )
  if (storedStatus) return storedStatus
  if (temporalFailed) throw new ProductionAnalysisStatusUnavailableError()
  return undefined
}
