import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db'
import {
  productionCollectionRequestSchema,
  type ProductionCollectionRequest
} from '@appsea/contracts'
import {
  prepareProductionCollectionWorkflowStart,
  productionCollectionIdempotencyDigest
} from '@appsea/workflows'
import { runProductionCfpbCollection } from './production-cfpb-runner'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requestFromEnv(
  policyVersion: string,
  rawIdempotencyKey: string
): ProductionCollectionRequest {
  const workspaceId = requiredEnv('APPSEA_PRODUCTION_WORKSPACE_ID')
  const limit = Number(process.env.APPSEA_PRODUCTION_CFPB_LIMIT ?? '100')
  const maxSourceItems = Number(
    process.env.APPSEA_PRODUCTION_CFPB_MAX_SOURCE_ITEMS ?? String(limit)
  )
  const maxCostMicros = Number(process.env.APPSEA_PRODUCTION_CFPB_MAX_COST_MICROS ?? '0')
  const maxActivityAttempts = Number(
    process.env.APPSEA_PRODUCTION_CFPB_MAX_ACTIVITY_ATTEMPTS ?? '3'
  )
  const dateFrom = process.env.APPSEA_PRODUCTION_CFPB_DATE_FROM?.trim() || null
  const dateTo = process.env.APPSEA_PRODUCTION_CFPB_DATE_TO?.trim() || null
  return productionCollectionRequestSchema.parse({
    workspaceId,
    campaignId: requiredEnv('APPSEA_PRODUCTION_CAMPAIGN_ID'),
    runId: requiredEnv('APPSEA_PRODUCTION_RUN_ID'),
    idempotencyKey: productionCollectionIdempotencyDigest(workspaceId, rawIdempotencyKey),
    sourceId: 'cfpb-consumer-complaints',
    policyVersion,
    query: process.env.APPSEA_PRODUCTION_CFPB_QUERY ?? '',
    ...(dateFrom || dateTo ? { dateRange: { from: dateFrom, to: dateTo } } : {}),
    limit,
    purpose: process.env.APPSEA_PRODUCTION_CFPB_PURPOSE ?? 'opportunity-research',
    requestedDisplayMode: 'excerpt',
    ...(process.env.APPSEA_PRODUCTION_RECOLLECTION_TOMBSTONE_ID?.trim()
      ? { recollectionTombstoneId: process.env.APPSEA_PRODUCTION_RECOLLECTION_TOMBSTONE_ID.trim() }
      : {}),
    budget: {
      currency: 'USD',
      maxSourceItems,
      maxCostMicros,
      maxActivityAttempts
    },
    // Keep the timestamp caller-owned so a retry with the same idempotency key
    // has identical persistence input instead of silently becoming a new run.
    requestedAt: requiredEnv('APPSEA_PRODUCTION_REQUESTED_AT')
  })
}

const pool = createDatabasePool(databaseConfigFromEnv())
try {
  const policyVersion = process.env.APPSEA_PRODUCTION_CFPB_POLICY_VERSION?.trim()
  const rawIdempotencyKey = requiredEnv('APPSEA_PRODUCTION_IDEMPOTENCY_KEY')
  const request = requestFromEnv(
    policyVersion || requiredEnv('APPSEA_PRODUCTION_CFPB_POLICY_VERSION'),
    rawIdempotencyKey
  )
  if (request.limit > request.budget.maxSourceItems) {
    throw new Error('Requested CFPB limit exceeds the configured source-item budget')
  }
  const preparedAdmission = prepareProductionCollectionWorkflowStart({
    ...request,
    idempotencyKey: rawIdempotencyKey,
    workflowVersion: 'production-collection-v1',
    requestedBy: { actorType: 'service', actorId: 'appsea-worker' }
  })
  const result = await runProductionCfpbCollection(pool, request, {
    serviceAdmission: {
      idempotencyDigest: preparedAdmission.input.idempotencyDigest,
      inputHash: preparedAdmission.input.inputHash
    }
  })
  console.log(
    JSON.stringify({
      state: result.state,
      runId: result.runId,
      sourceId: result.sourceId,
      policyVersion: result.policyVersion,
      sourceItemCount: result.sourceItemCount,
      complaintCount: result.complaintCount,
      deletionCount: result.deletionCount,
      costMicros: result.costMicros,
      replayed: result.replayed
    })
  )
} finally {
  await pool.end()
}
