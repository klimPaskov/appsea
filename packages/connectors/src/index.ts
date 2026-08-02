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

/** A policy/lease check denied the request before any source HTTP call. */
export class SourceCollectionPreflightDeniedError extends Error {
  constructor() {
    super('Source collection preflight denied the external request')
    this.name = 'SourceCollectionPreflightDeniedError'
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
  /** Identifier-only exact lookup used by an approved source re-collection. */
  sourceRecordId?: string
  /**
   * Worker-owned policy/lease assertion invoked immediately before the
   * external request. A false result fails closed without spending the source
   * request or settling the reserved quota.
   */
  beforeRequest?: () => Promise<boolean>
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
  /** Settled source request cost, in micro-USD. */
  costMicros: number
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
  if (
    request.sourceRecordId !== undefined &&
    (request.sourceRecordId.length < 1 || request.sourceRecordId.length > 240)
  ) {
    throw new Error('Collection source record identifier is invalid')
  }
  if (request.sourceRecordId !== undefined && request.limit !== 1) {
    throw new Error('Exact source record collection requires a limit of one')
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
      if (request.sourceRecordId !== undefined) {
        return entry.sourceRecordId === request.sourceRecordId
      }
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
      warnings: [
        'Fixture results are synthetic and must not be presented as real market research.'
      ],
      costMicros: 0
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
    permittedPurposes: [
      'opportunity-research',
      'deletion-reconciliation',
      'development',
      'testing'
    ],
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

/**
 * Stack Exchange is a source candidate for competitor and contrary-signal
 * research, not an activated production source. Public contributions carry
 * CC BY-SA obligations and the API terms require visible Stack Exchange
 * attribution, so the policy deliberately remains disabled until an
 * independent legal/privacy/security review records the exact commercial
 * display and retention decision.
 */
const stackExchangeSourcePolicy = freezePolicy(
  sourcePolicySchema.parse({
    sourceId: 'stackexchange-stackoverflow',
    displayName: 'Stack Overflow public questions',
    sourceType: 'api',
    enabled: false,
    policyState: 'pending_review',
    permittedPurposes: ['competitor-research', 'contrary-evidence', 'development', 'testing'],
    commercialUse: 'restricted',
    accessMethod:
      'Official Stack Exchange API v2.3 search/advanced endpoint; no scraping; optional application key supplied only through runtime configuration',
    retentionDays: 14,
    deletionRequired: true,
    attributionRequired: true,
    displayMode: 'excerpt',
    coverageNotes: [
      'Engineering policy draft: independent legal, privacy, and security approval is still required.',
      'Coverage is limited to Stack Overflow questions matching an explicit bounded query; it is not a census of developer experience.',
      'Public contributions carry time-dependent CC BY-SA terms and API responses require visible Stack Exchange attribution.',
      'Question bodies are sanitized and retained only as bounded excerpts; answers, comments, user profiles, and private data are not collected.',
      'Deleted or withheld questions may disappear without a tombstone feed; filtered search never establishes deletion absence.'
    ],
    reviewedAt: '2026-08-02T00:00:00.000Z',
    policyOwner: 'AppSea source-policy review queue',
    policyDocumentRef: 'https://engineering.stackexchange.com/legal/api-terms-of-use',
    expiresAt: '2026-11-02T00:00:00.000Z',
    quota: {
      requestsPerMinute: 30,
      maxRecordsPerRequest: 100,
      maxRecordsPerRun: 1_000,
      costPerRequestMicros: 0
    },
    deletion: {
      sourceRecordIdField: 'question_id',
      supportsTombstones: false,
      deletionPollIntervalHours: 24,
      retentionAction: 'redact'
    }
  })
)

export { stackExchangeSourcePolicy }

/** Production worker connector identities; fixture sources are intentionally excluded. */
export const productionConnectorSourceIds = [
  cfpbSourcePolicy.sourceId,
  stackExchangeSourcePolicy.sourceId
] as const

export function isProductionConnectorSourceId(sourceId: string): boolean {
  return productionConnectorSourceIds.includes(
    sourceId as (typeof productionConnectorSourceIds)[number]
  )
}

const STACKEXCHANGE_API_BASE_URL = 'https://api.stackexchange.com/2.3/'
const STACKEXCHANGE_REQUEST_TIMEOUT_MS = 30_000
const STACKEXCHANGE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const STACKEXCHANGE_SITE = 'stackoverflow'

type StackExchangeRecord = Record<string, unknown>

function stackExchangeRecord(value: unknown): StackExchangeRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as StackExchangeRecord)
    : null
}

function stackExchangeQuestionId(record: StackExchangeRecord): string {
  const value = record.question_id
  const id =
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === 'string' && /^[1-9][0-9]{0,30}$/.test(value)
        ? value
        : null
  if (!id) throw new SourceRecordMalformedError()
  return id
}

function stackExchangeTimestamp(value: unknown): string {
  const seconds =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : typeof value === 'string' && /^[0-9]{1,12}$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new SourceRecordMalformedError()
  const date = new Date(seconds * 1_000)
  if (!Number.isFinite(date.getTime())) throw new SourceRecordMalformedError()
  return date.toISOString()
}

function stackExchangeLocator(record: StackExchangeRecord, questionId: string): string {
  const fallback = `https://stackoverflow.com/questions/${questionId}`
  const candidate = typeof record.link === 'string' ? record.link : null
  if (!candidate) return fallback
  try {
    const url = new URL(candidate)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'stackoverflow.com' ||
      (url.port !== '' && url.port !== '443') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return fallback
    }
    const questionPath = `/questions/${questionId}`
    if (url.pathname !== questionPath && !url.pathname.startsWith(`${questionPath}/`)) {
      return fallback
    }
    return `${url.origin}${url.pathname}`
  } catch {
    return fallback
  }
}

function stackExchangeTags(record: StackExchangeRecord): string[] {
  if (!Array.isArray(record.tags)) return []
  return record.tags
    .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    .slice(0, 20)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code)
      return Number.isSafeInteger(point) &&
        point >= 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(Math.min(point, 0x10ffff))
        : ' '
    })
}

function stackExchangeExcerpt(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\0/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 20_000 ? `${text.slice(0, 19_997)}...` : text
}

/** Map one Stack Overflow question to a minimized, attribution-bound complaint. */
export function mapStackExchangeQuestion(
  record: unknown,
  capturedAt: string,
  query: string
): Complaint {
  const value = stackExchangeRecord(record)
  if (!value) throw new SourceRecordMalformedError()
  const questionId = stackExchangeQuestionId(value)
  const title = typeof value.title === 'string' ? stackExchangeExcerpt(value.title) : ''
  const body = stackExchangeExcerpt(value.body)
  const text = [title, body].filter(Boolean).join(' — ')
  if (!text) throw new SourceRecordMalformedError()
  const tags = stackExchangeTags(value)
  const feature = tags[0] ?? 'general workflow'
  return complaintSchema.parse({
    id: `stackexchange-question-${questionId}`,
    sourceId: stackExchangeSourcePolicy.sourceId,
    sourceRecordId: `${STACKEXCHANGE_SITE}:${questionId}`,
    canonicalLocator: stackExchangeLocator(value, questionId),
    capturedAt: asIsoDate(capturedAt),
    publishedAt: stackExchangeTimestamp(value.creation_date),
    query: query.trim() || `source-record:${questionId}`,
    product: 'Stack Overflow community',
    company: 'Community contributors',
    feature,
    category: 'community signal',
    text,
    language: 'en',
    synthetic: false,
    redacted: true,
    allowedRepresentation: 'excerpt'
  })
}

function extractStackExchangeRecords(payload: unknown): { items: unknown[]; backoff: number } {
  const root = stackExchangeRecord(payload)
  if (!root || !Array.isArray(root.items)) throw new SourceRecordMalformedError()
  if (typeof root.error_id === 'number' || typeof root.error_name === 'string') {
    throw new SourceRecordMalformedError()
  }
  const backoff =
    typeof root.backoff === 'number' && Number.isFinite(root.backoff)
      ? Math.max(0, root.backoff)
      : 0
  return { items: root.items, backoff }
}

async function readStackExchangeJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers?.get('content-length')
  if (declaredLength && Number.isFinite(Number(declaredLength))) {
    if (Number(declaredLength) > STACKEXCHANGE_MAX_RESPONSE_BYTES) {
      throw new SourceResponseTooLargeError()
    }
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const payload = (await response.json()) as unknown
    if (
      new TextEncoder().encode(JSON.stringify(payload)).byteLength >
      STACKEXCHANGE_MAX_RESPONSE_BYTES
    ) {
      throw new SourceResponseTooLargeError()
    }
    return payload
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > STACKEXCHANGE_MAX_RESPONSE_BYTES) throw new SourceResponseTooLargeError()
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

function stackExchangeSourceRecordId(value: string): string {
  const match = /^(?:stackoverflow:)?([1-9][0-9]{0,30})$/.exec(value)
  if (!match) throw new SourceRecordMalformedError()
  return match[1]!
}

export interface StackExchangeConnectorOptions {
  fetchImpl?: typeof fetch
  baseUrl?: string
  policy?: SourcePolicy
  now?: () => string
  quotaLedger?: SourceQuotaLedger
  /** Optional API key supplied by a deployment secret; never persisted or logged. */
  apiKey?: string
}

export class StackExchangeConnector implements SourceConnector {
  readonly sourceId = stackExchangeSourcePolicy.sourceId
  readonly policy: SourcePolicy
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly now: () => string
  private readonly quotaLedger: SourceQuotaLedger | undefined
  private readonly apiKey: string | undefined
  private readonly requestTimestamps: number[] = []
  private readonly runRecordCounts = new Map<string, { count: number; touchedAt: number }>()

  constructor(options: StackExchangeConnectorOptions = {}) {
    if (
      options.policy &&
      process.env.NODE_ENV !== 'test' &&
      (!options.policy.enabled || options.policy.policyState !== 'approved')
    ) {
      throw new Error(
        'Stack Exchange runtime policy must be enabled and approved by the source registry'
      )
    }
    const policy = options.policy ?? stackExchangeSourcePolicy
    if (
      policy.sourceId !== stackExchangeSourcePolicy.sourceId ||
      policy.sourceType !== stackExchangeSourcePolicy.sourceType ||
      policy.displayMode !== stackExchangeSourcePolicy.displayMode
    ) {
      throw new Error('Stack Exchange connector policy identity does not match the reviewed source')
    }
    if (process.env.NODE_ENV !== 'test' && !options.quotaLedger) {
      throw new Error('Stack Exchange connector requires a durable quota ledger outside tests')
    }
    this.policy = policy
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? STACKEXCHANGE_API_BASE_URL
    const baseUrl = new URL(this.baseUrl)
    const officialUrl = new URL(STACKEXCHANGE_API_BASE_URL)
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.origin !== officialUrl.origin ||
      baseUrl.pathname !== officialUrl.pathname ||
      baseUrl.search !== '' ||
      baseUrl.hash !== '' ||
      baseUrl.username !== '' ||
      baseUrl.password !== ''
    ) {
      throw new Error('Stack Exchange connector URL must remain on the official HTTPS API origin')
    }
    this.now = options.now ?? (() => new Date().toISOString())
    this.quotaLedger = options.quotaLedger
    this.apiKey = options.apiKey?.trim() || undefined
  }

  private consumeQuota(request: CollectionRequest): void {
    const now = Date.now()
    while (this.requestTimestamps[0] !== undefined && now - this.requestTimestamps[0] >= 60_000) {
      this.requestTimestamps.shift()
    }
    if (this.requestTimestamps.length >= this.policy.quota.requestsPerMinute) {
      throw new SourceQuotaExceededError('Stack Exchange connector request quota exceeded')
    }
    const runKey = request.runId ?? '__unscoped__'
    const previous = this.runRecordCounts.get(runKey)
    const used = previous?.count ?? 0
    if (used + request.limit > this.policy.quota.maxRecordsPerRun) {
      throw new SourceQuotaExceededError('Stack Exchange connector per-run record quota exceeded')
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

  private async reserveQuota(
    request: CollectionRequest
  ): Promise<SourceQuotaReservation | undefined> {
    if (!this.quotaLedger) {
      this.consumeQuota(request)
      return undefined
    }
    if (!request.workspaceId || !request.runId || !request.policyVersion) {
      throw new Error(
        'Durable Stack Exchange collection requires workspaceId, runId, and policyVersion at the boundary'
      )
    }
    const occurredAt = asIsoDate(this.now())
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          sourceId: this.sourceId,
          policyVersion: request.policyVersion,
          workspaceId: request.workspaceId,
          runId: request.runId,
          idempotencyMaterial: request.idempotencyKey ?? '',
          request: {
            query: request.query,
            limit: request.limit,
            purpose: request.purpose,
            requestedDisplayMode: request.requestedDisplayMode,
            sourceRecordId: request.sourceRecordId ?? null
          }
        })
      )
      .digest('hex')
    const reservation = await this.quotaLedger.reserve({
      workspaceId: request.workspaceId,
      sourceId: this.sourceId,
      policyVersion: request.policyVersion,
      runId: request.runId,
      idempotencyKey: `quota-key:${digest}`,
      reservationId: `quota:${this.sourceId}:${digest.slice(0, 48)}`,
      requestedRecords: request.limit,
      requestedCostMicros: this.policy.quota.costPerRequestMicros,
      expiresAt: new Date(Date.parse(occurredAt) + 10 * 60_000).toISOString(),
      occurredAt
    })
    if (reservation.replayed || reservation.status === 'committed') {
      throw new SourceQuotaReservationReplayError()
    }
    if (reservation.status !== 'reserved') throw new Error('Source quota reservation is not active')
    return reservation
  }

  private async settleQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined,
    actualRecords: number
  ): Promise<number> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) {
      return this.policy.quota.costPerRequestMicros
    }
    try {
      await this.quotaLedger.commit({
        workspaceId: request.workspaceId,
        reservationId: reservation.reservationId,
        actualRecords: Math.max(0, Math.min(actualRecords, reservation.requestedRecords)),
        actualCostMicros: reservation.requestedCostMicros,
        occurredAt: asIsoDate(this.now())
      })
      return reservation.requestedCostMicros
    } catch {
      throw new Error('Stack Exchange quota settlement failed; collection result is not trusted')
    }
  }

  private async releaseReservedQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined
  ): Promise<void> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) return
    try {
      await this.quotaLedger.release({
        workspaceId: request.workspaceId,
        reservationId: reservation.reservationId,
        occurredAt: asIsoDate(this.now())
      })
    } catch {
      throw new Error(
        'Stack Exchange quota preflight release failed; operator reconciliation is required'
      )
    }
  }

  async collect(request: CollectionRequest): Promise<ConnectorResult> {
    assertPolicyAllowsCollection(this.policy, request)
    if (!request.sourceRecordId && !request.query.trim()) {
      throw new Error('Stack Exchange search requires a non-empty query')
    }
    const reservation = await this.reserveQuota(request)
    const questionId = request.sourceRecordId
      ? stackExchangeSourceRecordId(request.sourceRecordId)
      : undefined
    const url = questionId
      ? new URL(`questions/${encodeURIComponent(questionId)}`, this.baseUrl)
      : new URL('search/advanced', this.baseUrl)
    url.searchParams.set('site', STACKEXCHANGE_SITE)
    url.searchParams.set('filter', 'withbody')
    if (questionId) {
      url.searchParams.set('pagesize', '1')
    } else {
      url.searchParams.set('q', request.query.trim())
      url.searchParams.set('sort', 'relevance')
      url.searchParams.set('pagesize', String(request.limit))
    }
    if (this.apiKey) url.searchParams.set('key', this.apiKey)

    try {
      if (request.beforeRequest && !(await request.beforeRequest())) {
        throw new SourceCollectionPreflightDeniedError()
      }
    } catch (error) {
      await this.releaseReservedQuota(request, reservation)
      throw error
    }

    let response: Response
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), STACKEXCHANGE_REQUEST_TIMEOUT_MS)
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'AppSea-source-connector' },
        signal: abortController.signal,
        redirect: 'error'
      })
    } catch {
      clearTimeout(timeout)
      await this.settleQuota(request, reservation, 0)
      throw new Error('Stack Exchange connector request failed before a response was received')
    }
    if (!response.ok) {
      clearTimeout(timeout)
      await this.settleQuota(request, reservation, 0)
      if (response.status === 429)
        throw new SourceQuotaExceededError('Stack Exchange API throttled the request')
      throw new Error('Stack Exchange API returned a non-success response')
    }
    let payload: unknown
    try {
      payload = await readStackExchangeJson(response)
    } catch (error) {
      clearTimeout(timeout)
      await this.settleQuota(request, reservation, 0)
      if (error instanceof SourceResponseTooLargeError) throw error
      throw new SourceRecordMalformedError()
    }
    clearTimeout(timeout)
    let extracted: { items: unknown[]; backoff: number }
    try {
      extracted = extractStackExchangeRecords(payload)
    } catch (error) {
      await this.settleQuota(request, reservation, 0)
      throw error
    }
    if (extracted.backoff > 0) {
      await this.settleQuota(request, reservation, extracted.items.length)
      throw new SourceQuotaExceededError('Stack Exchange API requested a bounded backoff')
    }
    if (
      extracted.items.length > request.limit ||
      extracted.items.length > this.policy.quota.maxRecordsPerRequest
    ) {
      await this.settleQuota(request, reservation, request.limit)
      throw new SourceQuotaExceededError(
        'Stack Exchange response exceeded the approved record quota'
      )
    }
    const complaints: Complaint[] = []
    let malformedCount = 0
    for (const item of extracted.items) {
      try {
        complaints.push(mapStackExchangeQuestion(item, this.now(), request.query))
      } catch (error) {
        if (!(error instanceof SourceRecordMalformedError)) throw error
        malformedCount += 1
      }
    }
    const warnings = [
      'Stack Exchange coverage is limited to bounded Stack Overflow questions matching the requested query.',
      'The API response is minimized to sanitized question excerpts and source links; answers, comments, and user profiles are not collected.',
      'Filtered Stack Exchange search cannot establish deletion absence; no deletion tombstones were emitted.'
    ]
    if (malformedCount > 0) {
      warnings.push(
        `${malformedCount} Stack Exchange records were skipped because required public fields were invalid.`
      )
    }
    if (questionId) {
      warnings.push(
        'This exact source-record re-collection used the official question-by-ID route and emitted no deletion tombstones.'
      )
    }
    const costMicros = await this.settleQuota(request, reservation, extracted.items.length)
    return { policy: this.policy, complaints, deletions: [], warnings, costMicros }
  }
}

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
  const id =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string' && /^[0-9]+$/.test(value)
        ? value
        : null
  if (id && id.length <= 240) return id
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
    canonicalLocator: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/${encodeURIComponent(sourceRecordId)}/`,
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
  if ('complaint_id' in root) return [root]
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

/** Identifier-only page used by the durable full-snapshot reconciliation job. */
export interface CfpbSnapshotPageRequest {
  offset: number
  limit: number
  purpose: string
  requestedDisplayMode: SourcePolicy['displayMode']
  workspaceId?: string
  reconciliationId?: string
  policyVersion?: string
  idempotencyKey?: string
  /** Worker-owned policy/lease assertion invoked immediately before HTTP. */
  beforeRequest?: () => Promise<boolean>
}

export interface CfpbSnapshotPageResult {
  offset: number
  pageSize: number
  sourceRecordCount: number
  sourceRecordIds: string[]
  shortPage: boolean
  completeSnapshot: boolean
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
            requestedDisplayMode: request.requestedDisplayMode,
            sourceRecordId: request.sourceRecordId ?? null
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
  ): Promise<number> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) {
      return this.policy.quota.costPerRequestMicros
    }
    try {
      await this.quotaLedger.commit({
        workspaceId: request.workspaceId,
        reservationId: reservation.reservationId,
        actualRecords: Math.max(0, Math.min(actualRecords, reservation.requestedRecords)),
        actualCostMicros: reservation.requestedCostMicros,
        occurredAt: asIsoDate(this.now())
      })
      return reservation.requestedCostMicros
    } catch {
      throw new Error('CFPB quota settlement failed; collection result is not trusted')
    }
  }

  private async releaseReservedQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined
  ): Promise<void> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) return
    try {
      await this.quotaLedger.release({
        workspaceId: request.workspaceId,
        reservationId: reservation.reservationId,
        occurredAt: asIsoDate(this.now())
      })
    } catch {
      throw new Error('CFPB quota preflight release failed; operator reconciliation is required')
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
    const url = request.sourceRecordId
      ? new URL(encodeURIComponent(request.sourceRecordId), this.baseUrl)
      : new URL(this.baseUrl)
    if (!request.sourceRecordId) {
      if (request.query.trim()) url.searchParams.set('search_term', request.query.trim())
      url.searchParams.set('field', 'all')
      url.searchParams.set('frm', '0')
      url.searchParams.set('size', String(request.limit))
      url.searchParams.set('format', 'json')
    }

    try {
      if (request.beforeRequest && !(await request.beforeRequest())) {
        throw new SourceCollectionPreflightDeniedError()
      }
    } catch (error) {
      await this.releaseReservedQuota(request, reservation)
      throw error
    }

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
      request.sourceRecordId
        ? 'This exact source-record re-collection used the official complaint-by-ID route and emitted no deletion tombstones.'
        : 'Deletion synchronization requires a full snapshot; this filtered request emitted no tombstones.'
    )
    const costMicros = await this.commitDurableQuota(request, reservation, records.length)
    return { policy: this.policy, complaints, deletions: [], warnings, costMicros }
  }

  /**
   * Fetch one unfiltered, identifier-only page. This method never maps or
   * persists complaint narratives. A page is deletion-safe only when it is
   * short and every returned record has a valid stable source identifier.
   */
  async collectSnapshotPage(request: CfpbSnapshotPageRequest): Promise<CfpbSnapshotPageResult> {
    if (!Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > 1_000_000) {
      throw new Error('CFPB snapshot offset is outside the supported range')
    }
    if (request.purpose !== 'deletion-reconciliation') {
      throw new Error('CFPB snapshot pages require the deletion-reconciliation purpose')
    }
    if (!this.policy.deletionRequired) {
      throw new Error('CFPB snapshot pages require a source policy with deletion duties')
    }
    const collectionRequest: CollectionRequest = {
      query: '',
      limit: request.limit,
      purpose: request.purpose,
      requestedDisplayMode: request.requestedDisplayMode,
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.reconciliationId ? { runId: request.reconciliationId } : {}),
      ...(request.policyVersion ? { policyVersion: request.policyVersion } : {}),
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.beforeRequest ? { beforeRequest: request.beforeRequest } : {})
    }
    assertPolicyAllowsCollection(this.policy, collectionRequest)
    const reservation = await this.reserveDurableQuota(collectionRequest)
    const url = new URL(this.baseUrl)
    url.searchParams.set('field', 'all')
    url.searchParams.set('frm', String(request.offset))
    url.searchParams.set('size', String(request.limit))
    url.searchParams.set('format', 'json')

    try {
      if (request.beforeRequest && !(await request.beforeRequest())) {
        throw new SourceCollectionPreflightDeniedError()
      }
    } catch (error) {
      await this.releaseReservedQuota(collectionRequest, reservation)
      throw error
    }

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
      await this.commitDurableQuota(collectionRequest, reservation, 0)
      throw new Error('CFPB snapshot request failed before a response was received')
    }
    if (!response.ok) {
      clearTimeout(timeout)
      await this.commitDurableQuota(collectionRequest, reservation, 0)
      throw new Error('CFPB snapshot returned a non-success response')
    }

    let payload: unknown
    try {
      payload = await readCfpbJson(response)
    } catch (error) {
      clearTimeout(timeout)
      await this.commitDurableQuota(collectionRequest, reservation, 0)
      if (error instanceof SourceResponseTooLargeError) throw error
      throw new SourceRecordMalformedError()
    }
    clearTimeout(timeout)

    let records: unknown[]
    try {
      records = extractCfpbRecords(payload)
    } catch (error) {
      await this.commitDurableQuota(collectionRequest, reservation, 0)
      throw error
    }
    if (records.length > request.limit || records.length > this.policy.quota.maxRecordsPerRequest) {
      await this.commitDurableQuota(collectionRequest, reservation, request.limit)
      throw new SourceQuotaExceededError('CFPB snapshot exceeded the approved record quota')
    }

    const sourceRecordIds: string[] = []
    let malformedCount = 0
    for (const record of records) {
      try {
        sourceRecordIds.push(cfpbRecordId(asRecord(record) ?? {}))
      } catch (error) {
        if (!(error instanceof SourceRecordMalformedError)) throw error
        malformedCount += 1
      }
    }
    const warnings =
      malformedCount > 0
        ? [
            `${malformedCount} source records lacked a valid complaint identifier; the snapshot cannot establish deletion absence.`
          ]
        : []
    await this.commitDurableQuota(collectionRequest, reservation, records.length)
    const shortPage = records.length < request.limit
    return {
      offset: request.offset,
      pageSize: request.limit,
      sourceRecordCount: records.length,
      sourceRecordIds: [...new Set(sourceRecordIds)],
      shortPage,
      completeSnapshot: shortPage && warnings.length === 0,
      warnings
    }
  }
}
