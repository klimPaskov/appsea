import { createHash } from 'node:crypto'
import {
  complaintSchema,
  manualImportFormatSchema,
  manualImportRecordSchema,
  type Complaint,
  type ManualImportFormat,
  type ManualImportRecord,
  type SourcePolicy
} from '@appsea/contracts'
import {
  assertPolicyAllowsCollection,
  SourceCollectionPreflightDeniedError,
  SourceQuotaExceededError,
  SourceQuotaReservationReplayError,
  type CollectionRequest,
  type ConnectorResult,
  type SourceConnector,
  type SourceQuotaLedger,
  type SourceQuotaReservation
} from './index'
import { manualOwnerImportSourcePolicy } from './index'

export const MANUAL_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const MANUAL_IMPORT_MAX_RECORDS = 5_000
const MANUAL_IMPORT_MAX_COLUMNS = 32
const MANUAL_IMPORT_MAX_CELL_BYTES = 20_000

const manualImportWarnings = [
  'Owner-authorized imports are tenant-private and do not establish public market coverage.',
  'Imported content was normalized and PII-scrubbed before persistence.',
  'AppSea does not fetch URLs from imported records.'
]

export interface ManualImportParseOptions {
  format: ManualImportFormat
  defaultQuery?: string
  now?: string
}

export interface ManualImportParseResult {
  format: ManualImportFormat
  records: ManualImportRecord[]
  warnings: string[]
  rejectedCount: number
}

export interface ManualImportBatchReader {
  readForCollection(input: {
    workspaceId: string
    batchId: string
    policyVersion: string
    runId: string
    limit: number
  }): Promise<{ records: ManualImportRecord[]; warnings: string[] }>
}

export interface ManualImportConnectorOptions {
  policy?: SourcePolicy
  batchReader: ManualImportBatchReader
  quotaLedger?: SourceQuotaLedger
  now?: () => string
}

class ManualImportRowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManualImportRowError'
  }
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const headerAliases: Record<string, keyof ManualImportRecord> = {
  id: 'sourceRecordId',
  record_id: 'sourceRecordId',
  source_id: 'sourceRecordId',
  source_record_id: 'sourceRecordId',
  sourcerecordid: 'sourceRecordId',
  url: 'canonicalLocator',
  link: 'canonicalLocator',
  locator: 'canonicalLocator',
  canonical_locator: 'canonicalLocator',
  captured_at: 'capturedAt',
  captured: 'capturedAt',
  published_at: 'publishedAt',
  published: 'publishedAt',
  query: 'query',
  search_query: 'query',
  product: 'product',
  product_name: 'product',
  company: 'company',
  company_name: 'company',
  feature: 'feature',
  workflow: 'feature',
  category: 'category',
  text: 'text',
  complaint: 'text',
  body: 'text',
  message: 'text',
  narrative: 'text',
  language: 'language',
  lang: 'language'
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function normalizeText(value: string): string {
  return value.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim()
}

function redactSensitiveText(value: string): { value: string; changed: boolean } {
  let result = normalizeText(value)
  const before = result
  result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
  result = result.replace(/\+?\d[\d().\s-]{7,}\d/g, '[redacted-phone]')
  result = result.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-number]')
  result = result.replace(
    /\b(?:bearer|token|api[_ -]?key|secret|password)\s*[:=]\s*\S+/gi,
    '[redacted-secret]'
  )
  return { value: result, changed: result !== before }
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function safeIsoDate(value: string, fallback: string, field: string): string {
  const candidate = value.trim() || fallback
  const timestamp = Date.parse(candidate)
  if (!Number.isFinite(timestamp)) throw new ManualImportRowError(`${field} is not a valid date`)
  return new Date(timestamp).toISOString()
}

function safeLocator(value: string): string | null {
  const candidate = value.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }
    url.hash = ''
    const normalized = url.toString()
    return byteLength(normalized) <= 2_000 ? normalized : null
  } catch {
    return null
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let justClosedQuote = false

  const pushCell = () => {
    if (byteLength(cell) > MANUAL_IMPORT_MAX_CELL_BYTES) {
      throw new Error('CSV cell exceeds the approved 20,000-byte limit')
    }
    row.push(cell)
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    if (row.some((entry) => entry.trim() !== '')) rows.push(row)
    row = []
    if (rows.length > MANUAL_IMPORT_MAX_RECORDS + 1) {
      throw new Error('CSV import exceeds the approved 5,000-record limit')
    }
  }

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
          justClosedQuote = true
        }
      } else {
        cell += character
      }
      continue
    }
    if (justClosedQuote) {
      if (character === ' ' || character === '\t') continue
      if (character === ',') {
        pushCell()
        justClosedQuote = false
        continue
      }
      if (character === '\n' || character === '\r') {
        pushRow()
        justClosedQuote = false
        if (character === '\r' && content[index + 1] === '\n') index += 1
        continue
      }
      throw new Error('CSV has characters after a closing quote')
    }
    if (character === '"' && cell === '') {
      quoted = true
    } else if (character === ',') {
      pushCell()
    } else if (character === '\n' || character === '\r') {
      pushRow()
      if (character === '\r' && content[index + 1] === '\n') index += 1
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (cell !== '' || row.length > 0 || justClosedQuote) pushRow()
  return rows
}

function objectRecords(content: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    throw new Error('JSON import is not valid JSON')
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).records
      : null
  if (!Array.isArray(records)) throw new Error('JSON import must be an array or {"records": []}')
  if (records.length > MANUAL_IMPORT_MAX_RECORDS) {
    throw new Error('JSON import exceeds the approved 5,000-record limit')
  }
  return records.filter(
    (record): record is Record<string, unknown> =>
      Boolean(record) && typeof record === 'object' && !Array.isArray(record)
  )
}

function mappedCsvRecords(content: string): Record<string, unknown>[] {
  const rows = parseCsv(content)
  if (rows.length < 2) throw new Error('CSV import requires a header and at least one record')
  const headers = rows[0]!.map(normalizeHeader)
  if (headers.some((header) => header === '')) throw new Error('CSV headers cannot be empty')
  if (headers.length > MANUAL_IMPORT_MAX_COLUMNS) {
    throw new Error('CSV exceeds the approved 32-column limit')
  }
  const seen = new Set<string>()
  for (const header of headers) {
    if (seen.has(header)) throw new Error(`CSV header ${header} is duplicated`)
    seen.add(header)
  }
  return rows.slice(1).map((values) => {
    if (values.length > headers.length) throw new Error('CSV row has too many fields')
    const record: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      const field = headerAliases[header]
      if (field) record[field] = values[index] ?? ''
    })
    return record
  })
}

function mapManualRecord(
  raw: Record<string, unknown>,
  ordinal: number,
  options: Required<Pick<ManualImportParseOptions, 'defaultQuery' | 'now'>>,
  warnings: string[]
): ManualImportRecord {
  const text = redactSensitiveText(stringValue(raw.text))
  if (!text.value) throw new ManualImportRowError('text is required')
  if (byteLength(text.value) > MANUAL_IMPORT_MAX_CELL_BYTES) {
    throw new ManualImportRowError('text exceeds the approved 20,000-byte limit')
  }
  const sourceRecordId = normalizeText(stringValue(raw.sourceRecordId)) || `row-${ordinal}`
  if (byteLength(sourceRecordId) > 200) throw new ManualImportRowError('sourceRecordId is too long')
  const locatorInput = normalizeText(stringValue(raw.canonicalLocator))
  const canonicalLocator = safeLocator(locatorInput)
  if (locatorInput && !canonicalLocator) warnings.push(`Row ${ordinal}: invalid URL was omitted.`)
  const capturedAt = safeIsoDate(stringValue(raw.capturedAt), options.now, 'capturedAt')
  const publishedInput = normalizeText(stringValue(raw.publishedAt))
  const publishedAt = publishedInput
    ? safeIsoDate(publishedInput, options.now, 'publishedAt')
    : null
  const product = redactSensitiveText(stringValue(raw.product) || 'Imported product')
  const company = redactSensitiveText(stringValue(raw.company) || 'Imported company')
  const feature = redactSensitiveText(stringValue(raw.feature) || 'Imported workflow')
  const category = redactSensitiveText(stringValue(raw.category) || 'other')
  const query = normalizeText(stringValue(raw.query)) || options.defaultQuery
  const language = (normalizeText(stringValue(raw.language)) || 'en').toLocaleLowerCase('en-US')
  if (language.length < 2 || language.length > 16) {
    throw new ManualImportRowError('language must contain 2-16 characters')
  }
  if (text.changed || product.changed || company.changed || feature.changed || category.changed) {
    warnings.push(`Row ${ordinal}: one or more text fields were PII-scrubbed.`)
  }
  return manualImportRecordSchema.parse({
    sourceRecordId,
    canonicalLocator,
    capturedAt,
    publishedAt,
    query,
    product: product.value,
    company: company.value,
    feature: feature.value,
    category: category.value,
    text: text.value,
    language
  })
}

export function parseManualImportContent(
  content: string,
  input: ManualImportParseOptions
): ManualImportParseResult {
  const format = manualImportFormatSchema.parse(input.format)
  if (typeof content !== 'string') throw new Error('Import content must be text')
  if (byteLength(content) > MANUAL_IMPORT_MAX_BYTES) {
    throw new Error('Import exceeds the approved 2 MiB upload limit')
  }
  const now = input.now ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(now))) throw new Error('Import timestamp is invalid')
  const defaultQuery = normalizeText(input.defaultQuery ?? '') || 'owner-authorized-import'
  const rawRecords = format === 'csv' ? mappedCsvRecords(content) : objectRecords(content)
  const warnings = [...manualImportWarnings]
  let rejectedCount = 0
  const records: ManualImportRecord[] = []
  rawRecords.forEach((raw, index) => {
    try {
      records.push(mapManualRecord(raw, index + 1, { defaultQuery, now }, warnings))
    } catch (error) {
      rejectedCount += 1
      if (warnings.length < 500) {
        warnings.push(
          `Row ${index + 1} rejected: ${error instanceof Error ? error.message : 'invalid record'}`
        )
      }
    }
  })
  if (rejectedCount > 25) {
    warnings.push(
      `${rejectedCount - 25} additional invalid rows were omitted from the warning list.`
    )
  }
  if (records.length === 0) throw new Error('Import contains no valid complaint records')
  return {
    format,
    records,
    warnings: warnings.slice(0, 500),
    rejectedCount
  }
}

function isoNow(now: () => string): string {
  const value = now()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('Manual import clock returned an invalid date')
  return new Date(timestamp).toISOString()
}

function complaintSourceRecordId(batchId: string, sourceRecordId: string): string {
  const candidate = `manual:${batchId}:${sourceRecordId}`
  if (candidate.length <= 240) return candidate
  const digest = createHash('sha256').update(sourceRecordId).digest('hex').slice(0, 32)
  return `manual:${batchId}:${digest}`.slice(0, 240)
}

function complaintId(batchId: string, sourceRecordId: string): string {
  return `manual-complaint-${createHash('sha256')
    .update(`${batchId}:${sourceRecordId}`)
    .digest('hex')}`
}

function mapManualComplaint(batchId: string, record: ManualImportRecord): Complaint {
  return complaintSchema.parse({
    id: complaintId(batchId, record.sourceRecordId),
    sourceId: manualOwnerImportSourcePolicy.sourceId,
    sourceRecordId: complaintSourceRecordId(batchId, record.sourceRecordId),
    canonicalLocator: record.canonicalLocator,
    capturedAt: record.capturedAt,
    publishedAt: record.publishedAt,
    query: record.query,
    product: record.product,
    company: record.company,
    feature: record.feature,
    category: record.category,
    text: record.text,
    language: record.language,
    synthetic: false,
    redacted: true,
    allowedRepresentation: 'excerpt'
  })
}

export class ManualImportConnector implements SourceConnector {
  readonly sourceId = manualOwnerImportSourcePolicy.sourceId
  readonly policy: SourcePolicy
  private readonly batchReader: ManualImportBatchReader
  private readonly quotaLedger: SourceQuotaLedger | undefined
  private readonly now: () => string
  private readonly requestTimestamps: number[] = []
  private readonly runRecordCounts = new Map<string, { count: number; touchedAt: number }>()

  constructor(options: ManualImportConnectorOptions) {
    const policy = options.policy ?? manualOwnerImportSourcePolicy
    if (
      policy.sourceId !== manualOwnerImportSourcePolicy.sourceId ||
      policy.sourceType !== 'manual' ||
      policy.displayMode !== 'excerpt'
    ) {
      throw new Error('Manual import connector policy identity does not match the reviewed source')
    }
    this.policy = policy
    this.batchReader = options.batchReader
    this.quotaLedger = options.quotaLedger
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private consumeLocalQuota(request: CollectionRequest): void {
    const now = Date.now()
    while (this.requestTimestamps[0] !== undefined && now - this.requestTimestamps[0] >= 60_000) {
      this.requestTimestamps.shift()
    }
    if (this.requestTimestamps.length >= this.policy.quota.requestsPerMinute) {
      throw new SourceQuotaExceededError('Manual import request quota exceeded')
    }
    const runKey = request.runId ?? '__unscoped__'
    const used = this.runRecordCounts.get(runKey)?.count ?? 0
    if (used + request.limit > this.policy.quota.maxRecordsPerRun) {
      throw new SourceQuotaExceededError('Manual import per-run record quota exceeded')
    }
    this.requestTimestamps.push(now)
    this.runRecordCounts.set(runKey, { count: used + request.limit, touchedAt: now })
  }

  private async reserveQuota(
    request: CollectionRequest
  ): Promise<SourceQuotaReservation | undefined> {
    if (!this.quotaLedger) {
      this.consumeLocalQuota(request)
      return undefined
    }
    if (!request.workspaceId || !request.runId || !request.policyVersion) {
      throw new Error(
        'Durable manual import collection requires workspaceId, runId, and policyVersion'
      )
    }
    const occurredAt = isoNow(this.now)
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          sourceId: this.sourceId,
          policyVersion: request.policyVersion,
          workspaceId: request.workspaceId,
          runId: request.runId,
          batchId: request.manualImportBatchId ?? null,
          idempotencyMaterial: request.idempotencyKey ?? '',
          request: {
            query: request.query,
            limit: request.limit,
            purpose: request.purpose,
            requestedDisplayMode: request.requestedDisplayMode
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
    if (reservation.status !== 'reserved')
      throw new Error('Manual import quota reservation is not active')
    return reservation
  }

  private async releaseQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined
  ): Promise<void> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) return
    await this.quotaLedger.release({
      workspaceId: request.workspaceId,
      reservationId: reservation.reservationId,
      occurredAt: isoNow(this.now)
    })
  }

  private async settleQuota(
    request: CollectionRequest,
    reservation: SourceQuotaReservation | undefined,
    actualRecords: number
  ): Promise<number> {
    if (!reservation || !this.quotaLedger || !request.workspaceId) {
      return this.policy.quota.costPerRequestMicros
    }
    await this.quotaLedger.commit({
      workspaceId: request.workspaceId,
      reservationId: reservation.reservationId,
      actualRecords: Math.max(0, Math.min(actualRecords, reservation.requestedRecords)),
      actualCostMicros: reservation.requestedCostMicros,
      occurredAt: isoNow(this.now)
    })
    return reservation.requestedCostMicros
  }

  async collect(request: CollectionRequest): Promise<ConnectorResult> {
    assertPolicyAllowsCollection(this.policy, request)
    if (!request.manualImportBatchId) {
      throw new Error('Manual import collection requires a staged batch identifier')
    }
    if (!request.workspaceId || !request.runId || !request.policyVersion) {
      throw new Error('Manual import collection requires workspace, run, and policy identifiers')
    }
    const reservation = await this.reserveQuota(request)
    try {
      if (request.beforeRequest && !(await request.beforeRequest())) {
        throw new SourceCollectionPreflightDeniedError()
      }
      const loaded = await this.batchReader.readForCollection({
        workspaceId: request.workspaceId,
        batchId: request.manualImportBatchId,
        policyVersion: request.policyVersion,
        runId: request.runId,
        limit: request.limit
      })
      const records = loaded.records.slice(0, request.limit)
      const warnings = [...manualImportWarnings, ...loaded.warnings]
      if (loaded.records.length > records.length) {
        warnings.push(
          `The staged batch contained ${loaded.records.length} records; this run requested only ${records.length}.`
        )
      }
      const complaints: Complaint[] = []
      let malformedCount = 0
      for (const record of records) {
        try {
          complaints.push(mapManualComplaint(request.manualImportBatchId, record))
        } catch (error) {
          if (!(error instanceof Error)) throw error
          malformedCount += 1
        }
      }
      if (malformedCount > 0) {
        warnings.push(`${malformedCount} staged records were skipped after contract validation.`)
      }
      const costMicros = await this.settleQuota(request, reservation, complaints.length)
      return {
        policy: this.policy,
        complaints,
        deletions: [],
        warnings: warnings.slice(0, 500),
        costMicros
      }
    } catch (error) {
      await this.releaseQuota(request, reservation)
      throw error
    }
  }
}
