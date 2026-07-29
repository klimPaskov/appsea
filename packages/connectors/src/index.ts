import { createHash } from 'node:crypto'
import { seedComplaints } from '@appsea/catalog'
import type { Complaint, SourceDeletionEvent, SourcePolicy } from '@appsea/contracts'
import { complaintSchema, sourceDeletionEventSchema, sourcePolicySchema } from '@appsea/contracts'

const CFPB_API_BASE_URL =
  'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/'
const CFPB_REQUEST_TIMEOUT_MS = 30_000
const CFPB_MAX_RESPONSE_BYTES = 32 * 1024 * 1024

export class SourceQuotaExceededError extends Error {
  constructor(message = 'Source quota exceeded') {
    super(message)
    this.name = 'SourceQuotaExceededError'
  }
}

export class SourceQuotaReservationReplayError extends Error {
  constructor() {
    super(
      'Source quota reservation was already used or is still in flight; replay the persisted collection result'
    )
    this.name = 'SourceQuotaReservationReplayError'
  }
}

export class SourceRecordMalformedError extends Error {
  constructor() {
    super('Source record was malformed or lacked a permitted public narrative')
    this.name = 'SourceRecordMalformedError'
  }
}

export class SourceResponseTooLargeError extends Error {
  constructor() {
    super('Source response exceeded the approved byte limit')
    this.name = 'SourceResponseTooLargeError'
  }
}

export interface CollectionRequest {
  query: string
  limit: number
  purpose: string
  requestedDisplayMode: SourcePolicy['displayMode']
  runId?: string
  /** Workspace is required when a durable quota ledger is supplied. */
  workspaceId?: string
  /** Immutable source-policy version recorded by the persistence boundary. */
  policyVersion?: string
  /** Caller-provided idempotency material; it is hashed before persistence. */
  idempotencyKey?: string
}

export interface SourceQuotaReservationInput {
  workspaceId: string
  sourceId: string
  policyVersion: string
  runId: string
  idempotencyKey: string
  reservationId: string
  requestedRecords: number
  requestedCostMicros: number
  expiresAt: string
  occurredAt: string
}

export interface SourceQuotaReservation {
  reservationId: string
  status: 'reserved' | 'committed' | 'released' | 'expired'
  replayed: boolean
  requestedRecords: number
  requestedCostMicros: number
}

export interface SourceQuotaSettlementInput {
  workspaceId: string
  reservationId: string
  actualRecords: number
  actualCostMicros: number
  occurredAt: string
}

/**
 * Durable quota implementations live outside the connector package so source
 * code cannot bypass the database boundary. The connector only receives this
 * narrow capability and never sees the ledger's SQL or raw policy payload.
 */
export interface SourceQuotaLedger {
  reserve(input: SourceQuotaReservationInput): Promise<SourceQuotaReservation>
  commit(input: SourceQuotaSettlementInput): Promise<void>
  release(
    input: Pick<SourceQuotaSettlementInput, 'workspaceId' | 'reservationId' | 'occurredAt'>
  ): Promise<void>
}

export interface ConnectorResult {
  policy: SourcePolicy
  complaints: Complaint[]
  deletions: SourceDeletionEvent[]
  warnings: string[]
}

export interface SourceConnector {
  readonly sourceId: string
  readonly policy: SourcePolicy
  collect(request: CollectionRequest): Promise<ConnectorResult>
}

function freezePolicy(policy: SourcePolicy): SourcePolicy {
  Object.freeze(policy.permittedPurposes)
  Object.freeze(policy.coverageNotes)
  Object.freeze(policy.quota)
  Object.freeze(policy.deletion)
  return Object.freeze(policy) as SourcePolicy
}

export const fixtureSourcePolicy = freezePolicy(
  sourcePolicySchema.parse({
    sourceId: 'fixture-community-feed',
    displayName: 'Synthetic community fixture',
    sourceType: 'fixture',
    enabled: true,
    policyState: 'approved',
    permittedPurposes: ['development', 'testing', 'demonstration'],
    commercialUse: 'allowed',
    accessMethod: 'repository fixture',
    retentionDays: 0,
    deletionRequired: false,
    attributionRequired: false,
    displayMode: 'fixture',
    coverageNotes: [
      'Synthetic content only',
      'Does not represent current social media coverage',
      'Cannot support market-size claims'
    ],
    reviewedAt: '2026-07-10T00:00:00.000Z'
  })
)

export function assertPolicyAllowsCollection(
  policy: SourcePolicy,
  request: CollectionRequest
): void {
  if (!policy.enabled) {
    throw new Error(`Source ${policy.sourceId} is disabled`)
  }
  if (!policy.permittedPurposes.includes(request.purpose)) {
    throw new Error(`Purpose ${request.purpose} is not permitted for ${policy.sourceId}`)
  }
  if (policy.commercialUse === 'unknown') {
    throw new Error(`Commercial-use state is unknown for ${policy.sourceId}`)
  }
  if (policy.policyState !== 'approved') {
    throw new Error(`Policy state ${policy.policyState} is not approved for ${policy.sourceId}`)
  }
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) {
    throw new Error(`Policy for ${policy.sourceId} has expired`)
  }
  if (policy.displayMode !== request.requestedDisplayMode) {
    throw new Error(
      `Display mode ${request.requestedDisplayMode} is not permitted for ${policy.sourceId}`
    )
  }
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new Error('Collection limit must be a positive integer')
  }
  if (request.query.length > 500) {
    throw new Error('Collection query is too long')
  }
  if (request.runId !== undefined && !/^[A-Za-z0-9:_-]{1,160}$/.test(request.runId)) {
    throw new Error('Collection run identifier is invalid')
  }
  if (request.limit > policy.quota.maxRecordsPerRequest) {
    throw new SourceQuotaExceededError(
      `Requested ${request.limit} records but policy allows at most ${policy.quota.maxRecordsPerRequest}`
    )
  }
}

export class FixtureConnector implements SourceConnector {
  readonly sourceId = fixtureSourcePolicy.sourceId
  readonly policy = fixtureSourcePolicy

  async collect(request: CollectionRequest): Promise<ConnectorResult> {
    assertPolicyAllowsCollection(this.policy, request)
    const query = request.query.trim().toLowerCase()
    const matches = seedComplaints.filter((entry) => {
      if (!query) return true
      return [entry.product, entry.feature, entry.category, entry.text]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return {
      policy: this.policy,
      complaints: matches.slice(0, request.limit),
      deletions: [],
      warnings: ['Fixture results are synthetic and must not be presented as real market research.']
    }
  }
}

const cfpbSourcePolicy = freezePolicy(
  sourcePolicySchema.parse({
    sourceId: 'cfpb-consumer-complaints',
    displayName: 'CFPB Consumer Complaint Database',
    sourceType: 'api',
    enabled: false,
    policyState: 'pending_review',
    permittedPurposes: ['opportunity-research', 'development', 'testing'],
    commercialUse: 'allowed',
    accessMethod: 'Official CFPB public JSON search API; no credentials and no scraping',
    retentionDays: 30,
    deletionRequired: true,
    attributionRequired: true,
    displayMode: 'excerpt',
    coverageNotes: [
      'Engineering policy draft: legal, privacy, and security approval is still required.',
      'The public database is not a statistical sample and does not represent all consumer experiences.',
      'Filtered API pages cannot establish deletion absence; a full-snapshot reconciliation is required.',
      'Narratives are included only when the consumer consented and CFPB scrubbing produced a public record.',
      'The API does not provide a deletion webhook or tombstone feed.'
    ],
    reviewedAt: '2026-07-24T00:00:00.000Z',
    policyOwner: 'AppSea source-policy review queue',
    policyDocumentRef: 'https://www.consumerfinance.gov/complaint/data-use/',
    expiresAt: '2026-10-24T00:00:00.000Z',
    quota: {
      requestsPerMinute: 6,
      maxRecordsPerRequest: 1_000,
      maxRecordsPerRun: 1_000,
      costPerRequestMicros: 0
    },
    deletion: {
      sourceRecordIdField: 'complaint_id',
      supportsTombstones: false,
      deletionPollIntervalHours: 24,
      retentionAction: 'redact'
    }
  })
)

export { cfpbSourcePolicy }

type CfpbRecord = Record<string, unknown>

function asRecord(value: unknown): CfpbRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as CfpbRecord) : null
}

function stringValue(record: CfpbRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredString(record: CfpbRecord, key: string): string {
  const value = stringValue(record, key)
  if (!value) throw new SourceRecordMalformedError()
  return value
}

function asIsoDate(value: string | null): string {
  if (!value) throw new SourceRecordMalformedError()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new SourceRecordMalformedError()
  return new Date(timestamp).toISOString()
}

function cfpbRecordId(record: CfpbRecord): string {
  const value = record.complaint_id
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return value
  throw new SourceRecordMalformedError()
}

export function mapCfpbRecord(record: unknown, capturedAt: string, query: string): Complaint {
  const value = asRecord(record)
  if (!value) throw new SourceRecordMalformedError()
  const sourceRecordId = cfpbRecordId(value)
  const narrative = requiredString(value, 'complaint_what_happened')
  if (narrative.length > 20_000) throw new SourceRecordMalformedError()
  const product = requiredString(value, 'product')
  const issue = stringValue(value, 'issue') ?? product
  const feature = stringValue(value, 'sub_product') ?? stringValue(value, 'sub_issue') ?? issue
  const company = stringValue(value, 'company') ?? 'Company not disclosed'
  return complaintSchema.parse({
    id: `cfpb-complaint-${sourceRecordId}`,
    sourceId: cfpbSourcePolicy.sourceId,
    sourceRecordId,
    capturedAt: asIsoDate(capturedAt),
    // CFPB's date_received is an intake date, not a publication timestamp.
    // Keep it out of publishedAt until the contract has a dedicated receivedAt field.
    publishedAt: null,
    query: query.trim() || '*',
    product,
    company,
    feature,
    category: issue,
    text: narrative,
    language: 'en',
    synthetic: false,
    redacted: true,
    allowedRepresentation: 'excerpt'
  })
}

function extractCfpbRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const root = asRecord(payload)
  if (!root) throw new SourceRecordMalformedError()
  if (Array.isArray(root.results)) return root.results
  if (Array.isArray(root.data)) return root.data
  const hits = asRecord(root.hits)
  if (hits && Array.isArray(hits.hits)) {
    return hits.hits.map((entry) => {
      const hit = asRecord(entry)
      return hit && '_source' in hit ? hit._source : entry
    })
  }
  throw new SourceRecordMalformedError()
}

async function readCfpbJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers?.get('content-length')
  if (declaredLength && Number.isFinite(Number(declaredLength))) {
    if (Number(declaredLength) > CFPB_MAX_RESPONSE_BYTES) {
      throw new SourceResponseTooLargeError()
    }
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const payload = (await response.json()) as unknown
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
    if (bytes > CFPB_MAX_RESPONSE_BYTES) throw new SourceResponseTooLargeError()
    return payload
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > CFPB_MAX_RESPONSE_BYTES) throw new SourceResponseTooLargeError()
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export interface CfpbDeletionSyncRequest {
  knownSourceRecordIds: readonly string[]
  currentSourceRecordIds: readonly string[]
  fullSnapshot: boolean
  observedAt: string
}

export interface CfpbDeletionSyncResult {
  deletions: SourceDeletionEvent[]
  warnings: string[]
}

export function syncCfpbDeletions(request: CfpbDeletionSyncRequest): CfpbDeletionSyncResult {
  const observedAt = asIsoDate(request.observedAt)
  if (!request.fullSnapshot) {
    return {
      deletions: [],
      warnings: [
        'Filtered CFPB results cannot establish deletion absence; no tombstones were emitted.'
      ]
    }
  }
  const current = new Set(request.currentSourceRecordIds)
  const deletions = [...new Set(request.knownSourceRecordIds)]
    .filter((sourceRecordId) => !current.has(sourceRecordId))
    .map((sourceRecordId) =>
      sourceDeletionEventSchema.parse({
        sourceId: cfpbSourcePolicy.sourceId,
        sourceRecordId,
        observedAt,
        reason: 'Record was absent from a full public snapshot and requires policy review.'
      })
    )
  return { deletions, warnings: [] }
}

export interface CfpbConnectorOptions {
  fetchImpl?: typeof fetch
  baseUrl?: string
  policy?: SourcePolicy
  now?: () => string
  quotaLedger?: SourceQuotaLedger
}

export class CfpbConnector implements SourceConnector {
  readonly sourceId = cfpbSourcePolicy.sourceId
  readonly policy: SourcePolicy
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly now: () => string
  private readonly quotaLedger: SourceQuotaLedger | undefined
  private readonly requestTimestamps: number[] = []
  private readonly runRecordCounts = new Map<string, { count: number; touchedAt: number }>()

  constructor(options: CfpbConnectorOptions = {}) {
    if (
      options.policy &&
      process.env.NODE_ENV !== 'test' &&
      (!options.policy.enabled || options.policy.policyState !== 'approved')
    ) {
      throw new Error('CFPB runtime policy must be enabled and approved by the source registry')
    }
    const policy = options.policy ?? cfpbSourcePolicy
    if (
      policy.sourceId !== cfpbSourcePolicy.sourceId ||
      policy.sourceType !== cfpbSourcePolicy.sourceType ||
      policy.displayMode !== cfpbSourcePolicy.displayMode
    ) {
      throw new Error('CFPB connector policy identity does not match the reviewed source')
    }
    if (process.env.NODE_ENV !== 'test' && !options.quotaLedger) {
      throw new Error('CFPB connector requires a durable quota ledger outside tests')
    }
    this.policy = policy
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? CFPB_API_BASE_URL
    const baseUrl = new URL(this.baseUrl)
    const officialUrl = new URL(CFPB_API_BASE_URL)
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.origin !== officialUrl.origin ||
      !baseUrl.pathname.startsWith(officialUrl.pathname)
    ) {
      throw new Error('CFPB connector URL must remain on the official HTTPS API origin')
    }
    this.now = options.now ?? (() => new Date().toISOString())
    this.quotaLedger = options.quotaLedger
  }

  private async reserveDurableQuota(
    request: CollectionRequest
  ): Promise<SourceQuotaReservation | undefined> {
    if (!this.quotaLedger) {
      this.consumeQuota(request)
      return undefined
    }
    if (!request.workspaceId || !request.runId || !request.policyVersion) {
      throw new Error(
        'Durable CFPB collection requires workspaceId, runId, and policyVersion at the boundary'
      )
    }
    const occurredAt = asIsoDate(this.now())
    const idempotencyMaterial = request.idempotencyKey ?? ''
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          sourceId: this.sourceId,
          policyVersion: request.policyVersion,
          workspaceId: request.workspaceId,
          runId: request.runId,
          idempotencyMaterial,
          request: {
            query: request.query,
            limit: request.limit,
            purpose: request.purpose,
            requestedDisplayMode: request.requestedDisplayMode
          }
        })
      )
      .digest('hex')
    const expiresAt = new Date(Date.parse(occurredAt) + 10 * 60_000).toISOString()
    const reservation = await this.quotaLedger.reserve({
      workspaceId: request.workspaceId,
      sourceId: this.sourceId,
      policyVersion: request.policyVersion,
      runId: request.runId,
      idempotencyKey: `quota-key:${digest}`,
      reservationId: `quota:${this.sourceId}:${digest.slice(0, 48)}`,
      requestedRecords: request.limit,
      requestedCostMicros: this.policy.quota.costPerRequestMicros,
      expiresAt,
      occurredAt
    })
    if (reservation.replayed || reservation.status === 'committed') {
      throw new SourceQuotaReservationReplayError()
    }
    if (reservation.status !== 'reserved') {
      throw new Error('Source quota reservation is not active')
    }
    return reservation
  }

  private async commitDurableQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined,
    actualRecords: number
  ): Promise<void> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) return
    try {
      await this.quotaLedger.commit({
        workspaceId: request.workspaceId,
        reservationId: reservation.reservationId,
        actualRecords: Math.max(0, Math.min(actualRecords, reservation.requestedRecords)),
        actualCostMicros: reservation.requestedCostMicros,
        occurredAt: asIsoDate(this.now())
      })
    } catch {
      throw new Error('CFPB quota settlement failed; collection result is not trusted')
    }
  }

  private consumeQuota(request: CollectionRequest): void {
    const now = Date.now()
    while (this.requestTimestamps[0] !== undefined && now - this.requestTimestamps[0] >= 60_000) {
      this.requestTimestamps.shift()
    }
    if (this.requestTimestamps.length >= this.policy.quota.requestsPerMinute) {
      throw new SourceQuotaExceededError('CFPB connector request-per-minute quota exceeded')
    }
    const runKey = request.runId ?? '__unscoped__'
    const previous = this.runRecordCounts.get(runKey)
    const used = previous?.count ?? 0
    if (used + request.limit > this.policy.quota.maxRecordsPerRun) {
      throw new SourceQuotaExceededError('CFPB connector per-run record quota exceeded')
    }
    this.requestTimestamps.push(now)
    this.runRecordCounts.set(runKey, { count: used + request.limit, touchedAt: now })
    if (this.runRecordCounts.size > 10_000) {
      const oldest = [...this.runRecordCounts.entries()]
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
        .slice(0, this.runRecordCounts.size - 10_000)
      for (const [key] of oldest) this.runRecordCounts.delete(key)
    }
  }

  async collect(request: CollectionRequest): Promise<ConnectorResult> {
    assertPolicyAllowsCollection(this.policy, request)
    const reservation = await this.reserveDurableQuota(request)
    const url = new URL(this.baseUrl)
    if (request.query.trim()) url.searchParams.set('search_term', request.query.trim())
    url.searchParams.set('field', 'all')
    url.searchParams.set('frm', '0')
    url.searchParams.set('size', String(request.limit))
    url.searchParams.set('format', 'json')

    let response: Response
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), CFPB_REQUEST_TIMEOUT_MS)
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
        redirect: 'error'
      })
    } catch {
      clearTimeout(timeout)
      await this.commitDurableQuota(request, reservation, 0)
      throw new Error('CFPB connector request failed before a response was received')
    }
    if (!response.ok) {
      clearTimeout(timeout)
      await this.commitDurableQuota(request, reservation, 0)
      throw new Error('CFPB connector returned a non-success response')
    }

    let payload: unknown
    try {
      payload = await readCfpbJson(response)
    } catch (error) {
      clearTimeout(timeout)
      await this.commitDurableQuota(request, reservation, 0)
      if (error instanceof SourceResponseTooLargeError) throw error
      throw new SourceRecordMalformedError()
    }
    clearTimeout(timeout)
    let records: unknown[]
    try {
      records = extractCfpbRecords(payload)
    } catch (error) {
      await this.commitDurableQuota(request, reservation, 0)
      throw error
    }
    if (records.length > request.limit || records.length > this.policy.quota.maxRecordsPerRequest) {
      await this.commitDurableQuota(request, reservation, request.limit)
      throw new SourceQuotaExceededError('CFPB response exceeded the approved record quota')
    }
    const complaints: Complaint[] = []
    let malformedCount = 0
    try {
      for (const record of records) {
        try {
          complaints.push(mapCfpbRecord(record, this.now(), request.query))
        } catch (error) {
          if (!(error instanceof SourceRecordMalformedError)) throw error
          malformedCount += 1
        }
      }
    } catch (error) {
      await this.commitDurableQuota(request, reservation, records.length)
      throw error
    }
    const warnings = [
      'CFPB coverage includes only records published through the official public API route.',
      'Narratives without public consent or that fail the source scrubbing rules are not collected.',
      'CFPB date_received is an intake date, not a publication timestamp; publishedAt is left unset.'
    ]
    if (malformedCount > 0) {
      warnings.push(
        `${malformedCount} source records were skipped because they lacked a permitted narrative or valid fields.`
      )
    }
    warnings.push(
      'Deletion synchronization requires a full snapshot; this filtered request emitted no tombstones.'
    )
    await this.commitDurableQuota(request, reservation, records.length)
    return { policy: this.policy, complaints, deletions: [], warnings }
  }
}
