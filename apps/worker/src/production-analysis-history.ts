import { readFile } from 'node:fs/promises'
import type { RawWorkflowExecutionInfo } from '@temporalio/client'
import {
  productionAnalysisHistoryManifestSchema,
  productionAnalysisWorkflowHistoryMemoSchema,
  appseaIdentifierSchema,
  type ProductionAnalysisHistoryManifest
} from '@appsea/contracts'
import { productionAnalysisWorkflowVersion } from '@appsea/workflows'

const productionAnalysisHistoryQuery = 'WorkflowType = "productionAnalysisWorkflow"'
const defaultPageSize = 100
const defaultMaxExecutions = 1_000
const maxPageSize = 100
const maxExecutions = 10_000
const maxReportEntries = 100

export type ProductionAnalysisHistoryClassification =
  'identifier_only_v2' | 'legacy_v1' | 'unclassified'

export type ProductionAnalysisHistoryStatus =
  'clear' | 'legacy_retention' | 'blocked' | 'incomplete'

export interface ProductionAnalysisHistoryObservation {
  workflowId: string
  runId: string
  classification: ProductionAnalysisHistoryClassification
  status: string
  startedAt: string | null
  closedAt: string | null
  historyLength: number
  historySizeBytes: number | null
}

export interface ProductionAnalysisHistoryExecution {
  workflowId: string
  runId: string
  status: { name: string }
  startTime: Date | undefined
  closeTime?: Date
  historyLength: number
  historySize?: number
  memo?: Record<string, unknown>
}

export interface ProductionAnalysisHistoryVisibilityClient {
  list(options: {
    query: string
    pageSize: number
  }): AsyncIterable<ProductionAnalysisHistoryExecution>
}

interface ProductionAnalysisHistoryVisibilityService {
  listWorkflowExecutions(request: {
    namespace: string
    query: string
    pageSize: number
    nextPageToken: Uint8Array
  }): Promise<{
    executions?: RawWorkflowExecutionInfo[] | null
    nextPageToken?: Uint8Array | null
  }>
}

export interface ProductionAnalysisHistoryUnresolved extends ProductionAnalysisHistoryObservation {
  reason: 'missing_disposition' | 'retention_expired' | 'history_still_visible_after_drain'
}

export interface ProductionAnalysisHistoryCheckResult {
  status: ProductionAnalysisHistoryStatus
  query: string
  visibleExecutions: number
  safeV2Executions: number
  legacyV1Executions: number
  unclassifiedExecutions: number
  manifestCoveredExecutions: number
  retainedLegacyExecutions: number
  unresolvedExecutions: number
  unresolved: readonly ProductionAnalysisHistoryUnresolved[]
  truncated: boolean
  maxExecutions: number
}

export class ProductionAnalysisHistoryManifestError extends Error {
  constructor() {
    super('Production analysis history manifest is invalid or unavailable')
    this.name = 'ProductionAnalysisHistoryManifestError'
  }
}

const safeMemoKeys = ['historyClass', 'schemaVersion', 'workflowType', 'workflowVersion']
const temporalStatusNames = [
  'UNSPECIFIED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
  'PAUSED'
] as const

function key(workflowId: string, runId: string): string {
  return `${workflowId}\u0000${runId}`
}

function isoOrNull(value: Date | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

function safeWorkflowId(value: string): string {
  return appseaIdentifierSchema.safeParse(value).success ? value : '<invalid-workflow-id>'
}

function safeRunId(value: string): string {
  return /^[0-9a-f-]{36}$/i.test(value) ? value : '<invalid-run-id>'
}

function boundedCount(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) return 0
  return Math.min(value, Number.MAX_SAFE_INTEGER)
}

/**
 * Classify by the small, reviewed memo only. Unknown memos are deliberately
 * not returned or decoded because legacy v1 arguments may contain complaints.
 */
export function classifyProductionAnalysisHistory(
  info: Pick<ProductionAnalysisHistoryExecution, 'memo'>
): ProductionAnalysisHistoryClassification {
  const memo = info.memo
  if (productionAnalysisWorkflowHistoryMemoSchema.safeParse(memo).success) {
    return 'identifier_only_v2'
  }
  if (
    typeof memo === 'object' &&
    memo !== null &&
    'workflowVersion' in memo &&
    memo.workflowVersion === 'production-analysis-v1'
  ) {
    return 'legacy_v1'
  }
  return 'unclassified'
}

function observe(info: ProductionAnalysisHistoryExecution): ProductionAnalysisHistoryObservation {
  return {
    workflowId: safeWorkflowId(info.workflowId),
    runId: safeRunId(info.runId),
    classification: classifyProductionAnalysisHistory(info),
    status: info.status.name,
    startedAt: isoOrNull(info.startTime),
    closedAt: isoOrNull(info.closeTime),
    historyLength: boundedCount(info.historyLength),
    historySizeBytes: info.historySize === undefined ? null : boundedCount(info.historySize)
  }
}

function manifestMap(
  manifest: ProductionAnalysisHistoryManifest | undefined
): Map<string, ProductionAnalysisHistoryManifest['entries'][number]> {
  return new Map(
    (manifest?.entries ?? []).map((entry) => [key(entry.workflowId, entry.runId), entry])
  )
}

function validateBounds(pageSize: number, maximum: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new Error(`pageSize must be an integer between 1 and ${maxPageSize}`)
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maxExecutions) {
    throw new Error(`maxExecutions must be an integer between 1 and ${maxExecutions}`)
  }
}

function unresolvedFor(
  observation: ProductionAnalysisHistoryObservation,
  entry: ProductionAnalysisHistoryManifest['entries'][number] | undefined,
  now: Date
): ProductionAnalysisHistoryUnresolved | null {
  if (!entry) return { ...observation, reason: 'missing_disposition' }
  if (entry.disposition === 'drained') {
    return { ...observation, reason: 'history_still_visible_after_drain' }
  }
  if (!entry.retentionUntil || Date.parse(entry.retentionUntil) <= now.getTime()) {
    return { ...observation, reason: 'retention_expired' }
  }
  return null
}

/**
 * Inspect only Temporal visibility metadata. This never fetches workflow
 * history and never performs cancellation, termination, or deletion.
 */
export async function inspectProductionAnalysisHistory(
  client: ProductionAnalysisHistoryVisibilityClient,
  options: {
    manifest?: ProductionAnalysisHistoryManifest
    now?: Date
    pageSize?: number
    maxExecutions?: number
  } = {}
): Promise<ProductionAnalysisHistoryCheckResult> {
  const pageSize = options.pageSize ?? defaultPageSize
  const maximum = options.maxExecutions ?? defaultMaxExecutions
  validateBounds(pageSize, maximum)
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid date')
  const entries = manifestMap(options.manifest)
  const unresolved: ProductionAnalysisHistoryUnresolved[] = []
  let visibleExecutions = 0
  let safeV2Executions = 0
  let legacyV1Executions = 0
  let unclassifiedExecutions = 0
  let manifestCoveredExecutions = 0
  let retainedLegacyExecutions = 0
  let unresolvedExecutions = 0
  let truncated = false

  for await (const info of client.list({ query: productionAnalysisHistoryQuery, pageSize })) {
    if (visibleExecutions >= maximum) {
      truncated = true
      break
    }
    visibleExecutions += 1
    const observation = observe(info)
    if (observation.classification === 'identifier_only_v2') {
      safeV2Executions += 1
      continue
    }
    if (observation.classification === 'legacy_v1') legacyV1Executions += 1
    else unclassifiedExecutions += 1
    const entry = entries.get(key(observation.workflowId, observation.runId))
    const unresolvedEntry = unresolvedFor(observation, entry, now)
    if (unresolvedEntry) {
      unresolvedExecutions += 1
      if (unresolved.length < maxReportEntries) unresolved.push(unresolvedEntry)
      continue
    }
    manifestCoveredExecutions += 1
    if (entry?.disposition === 'retained') retainedLegacyExecutions += 1
  }

  let status: ProductionAnalysisHistoryStatus = 'clear'
  if (truncated) status = 'incomplete'
  else if (unresolvedExecutions > 0) status = 'blocked'
  else if (retainedLegacyExecutions > 0) status = 'legacy_retention'

  return {
    status,
    query: productionAnalysisHistoryQuery,
    visibleExecutions,
    safeV2Executions,
    legacyV1Executions,
    unclassifiedExecutions,
    manifestCoveredExecutions,
    retainedLegacyExecutions,
    unresolvedExecutions,
    unresolved,
    truncated,
    maxExecutions: maximum
  }
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || value === null || !('toNumber' in value)) return 0
  const toNumber = value.toNumber
  return typeof toNumber === 'function' ? toNumber.call(value) : 0
}

function dateFromUnknown(value: unknown): Date | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!('seconds' in record)) return undefined
  const seconds = numberFromUnknown(record.seconds)
  const nanos = typeof record.nanos === 'number' ? record.nanos : 0
  const date = new Date(seconds * 1_000 + nanos / 1_000_000)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function decodeExactSafeMemo(raw: RawWorkflowExecutionInfo): Record<string, unknown> | undefined {
  const fields = raw.memo?.fields
  if (!fields) return undefined
  const keys = Object.keys(fields).sort()
  if (
    keys.length !== safeMemoKeys.length ||
    keys.some((key, index) => key !== safeMemoKeys[index])
  ) {
    return undefined
  }
  const decoded: Record<string, unknown> = {}
  const text = new TextDecoder()
  for (const key of safeMemoKeys) {
    const payload = fields[key]
    const encoding = payload?.metadata?.encoding
    if (!payload?.data || !encoding || text.decode(encoding) !== 'json/plain') return undefined
    if (payload.data.length > 256) return undefined
    try {
      const value: unknown = JSON.parse(text.decode(payload.data))
      if (typeof value !== 'string') return undefined
      decoded[key] = value
    } catch {
      return undefined
    }
  }
  return productionAnalysisWorkflowHistoryMemoSchema.safeParse(decoded).success
    ? decoded
    : undefined
}

function executionFromRaw(raw: RawWorkflowExecutionInfo): ProductionAnalysisHistoryExecution {
  const closeTime = dateFromUnknown(raw.closeTime)
  const memo = decodeExactSafeMemo(raw)
  return {
    workflowId: raw.execution?.workflowId ?? '',
    runId: raw.execution?.runId ?? '',
    status: { name: temporalStatusNames[raw.status ?? 0] ?? 'UNKNOWN' },
    startTime: dateFromUnknown(raw.startTime),
    historyLength: numberFromUnknown(raw.historyLength),
    ...(closeTime ? { closeTime } : {}),
    ...(raw.historySizeBytes ? { historySize: numberFromUnknown(raw.historySizeBytes) } : {}),
    ...(memo ? { memo } : {})
  }
}

/**
 * Adapt Temporal's raw visibility RPC without invoking the SDK data converter.
 * Only the exact small v2 memo is JSON-decoded; all other memo payloads are
 * treated as unclassified and remain opaque.
 */
export function createProductionAnalysisHistoryVisibilityClient(
  service: ProductionAnalysisHistoryVisibilityService,
  namespace: string
): ProductionAnalysisHistoryVisibilityClient {
  return {
    list: ({ query, pageSize }) => {
      async function* pages(): AsyncIterable<ProductionAnalysisHistoryExecution> {
        let nextPageToken = new Uint8Array()
        do {
          const response = await service.listWorkflowExecutions({
            namespace,
            query,
            pageSize,
            nextPageToken
          })
          for (const raw of response.executions ?? []) yield executionFromRaw(raw)
          nextPageToken = response.nextPageToken
            ? new Uint8Array(response.nextPageToken)
            : new Uint8Array()
        } while (nextPageToken.length > 0)
      }
      return pages()
    }
  }
}

export async function readProductionAnalysisHistoryManifest(
  filePath: string
): Promise<ProductionAnalysisHistoryManifest> {
  try {
    const content = await readFile(filePath, 'utf8')
    return productionAnalysisHistoryManifestSchema.parse(JSON.parse(content))
  } catch {
    throw new ProductionAnalysisHistoryManifestError()
  }
}

export const productionAnalysisHistoryCheckerDefaults = {
  pageSize: defaultPageSize,
  maxExecutions: defaultMaxExecutions,
  workflowVersion: productionAnalysisWorkflowVersion
} as const
