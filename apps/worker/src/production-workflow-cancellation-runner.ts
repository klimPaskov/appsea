import type { MaintenanceSchedulerFence } from '@appsea/contracts'
import type { PostgresProductionCollectionWorkflowRepository } from '@appsea/db'

const maximumCancellationBatch = 100

export interface ProductionWorkflowCancellationInput {
  batchSize: number
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
}

export interface ProductionWorkflowCancellationDependencies {
  workflows: Pick<
    PostgresProductionCollectionWorkflowRepository,
    | 'listWorkspaceIdsForService'
    | 'listCancellationTargetsForService'
    | 'prepareCancellationForService'
  >
  /** Best-effort Temporal cancellation. The PostgreSQL intent remains pending on failure. */
  cancelWorkflow: (workflowId: string) => Promise<void>
}

export interface ProductionWorkflowCancellationResult {
  workspacesScanned: number
  targets: number
  attempted: number
  dispatched: number
  failed: number
}

/**
 * Retries one-source cancellation intents from the durable projection. The
 * runner never marks a workflow terminal: the workflow's non-cancellable
 * termination activity remains the source of truth for persistence races.
 */
export async function runProductionWorkflowCancellation(
  input: ProductionWorkflowCancellationInput,
  dependencies: ProductionWorkflowCancellationDependencies
): Promise<ProductionWorkflowCancellationResult> {
  if (
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 0 ||
    input.batchSize > maximumCancellationBatch
  ) {
    throw new Error(
      'Production workflow cancellation batch size must be an integer between 0 and 100'
    )
  }
  const assertLease = input.assertLease ?? (async () => undefined)
  const workspaceIds = [
    ...new Set(await dependencies.workflows.listWorkspaceIdsForService())
  ].sort()
  if (input.batchSize === 0) {
    return {
      workspacesScanned: workspaceIds.length,
      targets: 0,
      attempted: 0,
      dispatched: 0,
      failed: 0
    }
  }

  let targets = 0
  let attempted = 0
  let dispatched = 0
  let failed = 0
  for (const workspaceId of workspaceIds) {
    if (attempted >= input.batchSize || targets >= input.batchSize) break
    const workflowIds = await dependencies.workflows.listCancellationTargetsForService(
      workspaceId,
      Math.min(input.batchSize - attempted, input.batchSize - targets, maximumCancellationBatch)
    )
    targets += workflowIds.length
    for (const workflowId of workflowIds) {
      if (attempted >= input.batchSize) break
      await assertLease()
      const target = await dependencies.workflows.prepareCancellationForService(
        workspaceId,
        workflowId,
        input.fence
      )
      if (!target) continue
      attempted += 1
      await assertLease()
      try {
        await dependencies.cancelWorkflow(target.workflowId)
        dispatched += 1
      } catch {
        // Keep the intent durable. The next leased pass retries the provider
        // call without creating another workflow or mutating source state.
        failed += 1
      }
    }
  }
  return { workspacesScanned: workspaceIds.length, targets, attempted, dispatched, failed }
}
