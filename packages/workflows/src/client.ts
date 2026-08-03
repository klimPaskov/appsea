import { createHash } from 'node:crypto'
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowClient,
  type WorkflowHandle
} from '@temporalio/client'
import {
  fixtureResearchWorkflowHashMaterialSchema,
  fixtureResearchWorkflowInputSchema,
  fixtureResearchWorkflowStartRequestSchema,
  productionCollectionWorkflowHashMaterialSchema,
  productionCollectionWorkflowInputSchema,
  productionCollectionWorkflowStartRequestSchema,
  workflowIdSchema,
  productionAnalysisWorkflowHistoryMemoSchema,
  productionAnalysisWorkflowInputSchema,
  productionAnalysisWorkflowStartRequestSchema,
  type FixtureResearchWorkflowInput,
  type FixtureResearchWorkflowStartRequest,
  type ProductionCollectionWorkflowInput,
  type ProductionCollectionWorkflowStartRequest,
  type ProductionCollectionWorkflowStatus,
  type FixtureResearchWorkflowStatus,
  type ProductionAnalysisWorkflowInput,
  type ProductionAnalysisWorkflowStartRequest,
  type ProductionAnalysisWorkflowStatus
} from '@appsea/contracts'
import type {
  fixtureResearchWorkflow,
  productionAnalysisWorkflow,
  productionCollectionWorkflow
} from './workflows'
import {
  fixtureResearchStatusQueryName,
  fixtureResearchTaskQueue,
  productionAnalysisStatusQueryName,
  productionCollectionStatusQueryName
} from './constants'

const productionAnalysisWorkflowHistoryMemo = productionAnalysisWorkflowHistoryMemoSchema.parse({
  schemaVersion: 'appsea-temporal-history-memo-v1',
  workflowType: 'productionAnalysisWorkflow',
  workflowVersion: 'production-analysis-v2',
  historyClass: 'identifier-only'
})

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Derive the persistence idempotency identity without retaining the raw key. */
export function productionCollectionIdempotencyDigest(
  workspaceId: string,
  idempotencyKey: string,
  workflowVersion = 'production-collection-v1'
): string {
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    throw new Error('Production collection idempotency keys must be 16-200 characters')
  }
  return sha256(
    canonicalJson({
      endpoint: 'production-collection',
      workflowType: 'productionCollectionWorkflow',
      workflowVersion,
      workspaceId,
      idempotencyKey
    })
  )
}

export interface PreparedFixtureResearchWorkflowStart {
  workflowId: string
  input: FixtureResearchWorkflowInput
}

export function prepareFixtureResearchWorkflowStart(
  request: FixtureResearchWorkflowStartRequest
): PreparedFixtureResearchWorkflowStart {
  const parsed = fixtureResearchWorkflowStartRequestSchema.parse(request)
  const idempotencyDigest = sha256(
    canonicalJson({
      endpoint: 'fixture-research',
      workflowType: 'fixtureResearchWorkflow',
      workflowVersion: parsed.workflowVersion,
      workspaceId: parsed.workspaceId,
      idempotencyKey: parsed.idempotencyKey
    })
  )
  const hashMaterial = fixtureResearchWorkflowHashMaterialSchema.parse({
    workspaceId: parsed.workspaceId,
    campaignId: parsed.campaignId,
    runId: parsed.runId,
    idempotencyDigest,
    workflowVersion: parsed.workflowVersion,
    fixtureAt: parsed.fixtureAt,
    budget: parsed.budget,
    ...(parsed.requestedBy ? { requestedBy: parsed.requestedBy } : {})
  })
  const input = fixtureResearchWorkflowInputSchema.parse({
    ...hashMaterial,
    inputHash: sha256(canonicalJson(hashMaterial))
  })
  return {
    workflowId: `workflow:fixture:${parsed.workspaceId}:${idempotencyDigest.slice(0, 32)}`,
    input
  }
}

export async function startFixtureResearchWorkflow(
  client: WorkflowClient,
  request: FixtureResearchWorkflowStartRequest
): Promise<WorkflowHandle<typeof fixtureResearchWorkflow>> {
  const prepared = prepareFixtureResearchWorkflowStart(request)
  let handle: WorkflowHandle<typeof fixtureResearchWorkflow>
  try {
    handle = await client.start<typeof fixtureResearchWorkflow>('fixtureResearchWorkflow', {
      taskQueue: fixtureResearchTaskQueue,
      workflowId: prepared.workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowExecutionTimeout: '10 minutes',
      args: [prepared.input]
    })
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error
    handle = client.getHandle<typeof fixtureResearchWorkflow>(prepared.workflowId)
  }
  const status = await handle.query<FixtureResearchWorkflowStatus>(fixtureResearchStatusQueryName)
  if (status.inputHash !== prepared.input.inputHash) {
    throw new Error('Workflow idempotency key conflicts with different input')
  }
  return handle
}

export interface PreparedProductionCollectionWorkflowStart {
  workflowId: string
  input: ProductionCollectionWorkflowInput
}

export function prepareProductionCollectionWorkflowStart(
  request: ProductionCollectionWorkflowStartRequest
): PreparedProductionCollectionWorkflowStart {
  const parsed = productionCollectionWorkflowStartRequestSchema.parse(request)
  const idempotencyDigest = productionCollectionIdempotencyDigest(
    parsed.workspaceId,
    parsed.idempotencyKey,
    parsed.workflowVersion
  )
  const hashMaterial = productionCollectionWorkflowHashMaterialSchema.parse({
    workspaceId: parsed.workspaceId,
    campaignId: parsed.campaignId,
    runId: parsed.runId,
    idempotencyDigest,
    workflowVersion: parsed.workflowVersion,
    sourceId: parsed.sourceId,
    policyVersion: parsed.policyVersion,
    query: parsed.query,
    limit: parsed.limit,
    purpose: parsed.purpose,
    requestedDisplayMode: parsed.requestedDisplayMode,
    budget: parsed.budget,
    requestedAt: parsed.requestedAt,
    ...(parsed.recollectionTombstoneId
      ? { recollectionTombstoneId: parsed.recollectionTombstoneId }
      : {}),
    ...(parsed.analysisSeedReviewId ? { analysisSeedReviewId: parsed.analysisSeedReviewId } : {}),
    ...(parsed.requestedBy ? { requestedBy: parsed.requestedBy } : {})
  })
  const input = productionCollectionWorkflowInputSchema.parse({
    ...hashMaterial,
    inputHash: sha256(canonicalJson(hashMaterial))
  })
  return {
    workflowId: `workflow:production:${parsed.workspaceId}:${idempotencyDigest.slice(0, 32)}`,
    input
  }
}

export async function startProductionCollectionWorkflow(
  client: WorkflowClient,
  request: ProductionCollectionWorkflowStartRequest
): Promise<WorkflowHandle<typeof productionCollectionWorkflow>> {
  const prepared = prepareProductionCollectionWorkflowStart(request)
  let handle: WorkflowHandle<typeof productionCollectionWorkflow>
  try {
    handle = await client.start<typeof productionCollectionWorkflow>(
      'productionCollectionWorkflow',
      {
        taskQueue: fixtureResearchTaskQueue,
        workflowId: prepared.workflowId,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowExecutionTimeout: '30 minutes',
        args: [prepared.input]
      }
    )
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error
    handle = client.getHandle<typeof productionCollectionWorkflow>(prepared.workflowId)
  }
  const status = await handle.query<ProductionCollectionWorkflowStatus>(
    productionCollectionStatusQueryName
  )
  if (status.inputHash !== prepared.input.inputHash) {
    throw new Error('Workflow idempotency key conflicts with different input')
  }
  return handle
}

export async function readProductionCollectionWorkflowStatus(
  client: WorkflowClient,
  workflowId: string
): Promise<ProductionCollectionWorkflowStatus> {
  const handle = client.getHandle<typeof productionCollectionWorkflow>(workflowId)
  return handle.query<ProductionCollectionWorkflowStatus>(productionCollectionStatusQueryName)
}

/** Request cancellation through Temporal after durable cancellation intent is stored. */
export async function cancelProductionCollectionWorkflow(
  client: WorkflowClient,
  workflowId: string
): Promise<void> {
  const parsedWorkflowId = workflowIdSchema.parse(workflowId)
  await client.getHandle<typeof productionCollectionWorkflow>(parsedWorkflowId).cancel()
}

export interface PreparedProductionAnalysisWorkflowStart {
  workflowId: string
  input: ProductionAnalysisWorkflowInput
}

export function prepareProductionAnalysisWorkflowStart(
  request: ProductionAnalysisWorkflowStartRequest
): PreparedProductionAnalysisWorkflowStart {
  const parsed = productionAnalysisWorkflowStartRequestSchema.parse(request)
  const requestedBy = parsed.requestedBy ?? {
    actorType: 'service' as const,
    actorId: 'appsea-worker'
  }
  const idempotencyDigest = sha256(
    canonicalJson({
      endpoint: 'production-analysis',
      workflowType: 'productionAnalysisWorkflow',
      workflowVersion: parsed.workflowVersion,
      workspaceId: parsed.workspaceId,
      idempotencyKey: parsed.idempotencyKey
    })
  )
  const hashMaterial = {
    workspaceId: parsed.workspaceId,
    collectionRunId: parsed.collectionRunId,
    analysisRunId: parsed.analysisRunId,
    idempotencyDigest,
    workflowVersion: parsed.workflowVersion,
    requestedAt: parsed.requestedAt,
    seedReviewId: parsed.seedReviewId,
    requestedBy
  }
  const input = productionAnalysisWorkflowInputSchema.parse({
    ...hashMaterial,
    inputHash: sha256(canonicalJson(hashMaterial))
  })
  return {
    workflowId: `workflow:analysis:${parsed.workspaceId}:${idempotencyDigest.slice(0, 32)}`,
    input
  }
}

export async function startProductionAnalysisWorkflow(
  client: WorkflowClient,
  request: ProductionAnalysisWorkflowStartRequest
): Promise<WorkflowHandle<typeof productionAnalysisWorkflow>> {
  const prepared = prepareProductionAnalysisWorkflowStart(request)
  let handle: WorkflowHandle<typeof productionAnalysisWorkflow>
  try {
    handle = await client.start<typeof productionAnalysisWorkflow>('productionAnalysisWorkflow', {
      taskQueue: fixtureResearchTaskQueue,
      workflowId: prepared.workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowExecutionTimeout: '30 minutes',
      memo: productionAnalysisWorkflowHistoryMemo,
      args: [prepared.input]
    })
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error
    handle = client.getHandle<typeof productionAnalysisWorkflow>(prepared.workflowId)
  }
  const status = await handle.query<ProductionAnalysisWorkflowStatus>(
    productionAnalysisStatusQueryName
  )
  if (status.inputHash !== prepared.input.inputHash) {
    throw new Error('Workflow idempotency key conflicts with different input')
  }
  return handle
}

export async function readProductionAnalysisWorkflowStatus(
  client: WorkflowClient,
  workflowId: string
): Promise<ProductionAnalysisWorkflowStatus> {
  const handle = client.getHandle<typeof productionAnalysisWorkflow>(workflowId)
  return handle.query<ProductionAnalysisWorkflowStatus>(productionAnalysisStatusQueryName)
}
