import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  appseaIdentifierSchema,
  objectReferenceSchema,
  objectStorageKindSchema,
  type ObjectReference,
  type ObjectStorageKind
} from '@appsea/contracts'

const defaultMaxBytes = 10_000_000

export type ObjectStorePurgeAuthorization =
  'retention-expired' | 'deletion-tombstone' | 'workspace-closure'

export interface ObjectStorePutInput {
  workspaceId: string
  kind: ObjectStorageKind
  body: Uint8Array
  contentType: string
  createdAt: string
  retentionUntil?: string | null
}

export interface ObjectStoreGetResult {
  reference: ObjectReference
  body: Uint8Array
}

export interface ObjectStorePurgeInput {
  reference: ObjectReference
  authorization: ObjectStorePurgeAuthorization
  now: string
}

export interface ObjectStore {
  put(input: ObjectStorePutInput): Promise<ObjectReference>
  head(workspaceId: string, reference: ObjectReference): Promise<ObjectReference | null>
  get(workspaceId: string, reference: ObjectReference): Promise<ObjectStoreGetResult | null>
  markDeleted(
    workspaceId: string,
    reference: ObjectReference,
    deletedAt: string,
    reason: string
  ): Promise<ObjectReference>
  purge(workspaceId: string, input: ObjectStorePurgeInput): Promise<void>
}

export class ObjectStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-input'
      | 'not-found'
      | 'workspace-mismatch'
      | 'immutable-conflict'
      | 'deleted'
      | 'retention'
      | 'corrupt'
      | 'unavailable'
  ) {
    super(message)
    this.name = 'ObjectStoreError'
  }
}

export interface ObjectStoreOptions {
  maxBytes?: number
}

function validateTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new ObjectStoreError(`${label} must be an ISO timestamp`, 'invalid-input')
  }
  return parsed.toISOString()
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

function validatePutInput(input: ObjectStorePutInput, maxBytes: number): ObjectStorePutInput {
  const workspaceId = appseaIdentifierSchema.safeParse(input.workspaceId)
  const kind = objectStorageKindSchema.safeParse(input.kind)
  if (!workspaceId.success || !kind.success) {
    throw new ObjectStoreError('Object workspace or kind is invalid', 'invalid-input')
  }
  if (!(input.body instanceof Uint8Array)) {
    throw new ObjectStoreError('Object body must be a byte array', 'invalid-input')
  }
  if (input.body.byteLength > maxBytes) {
    throw new ObjectStoreError(`Object exceeds the ${maxBytes}-byte limit`, 'invalid-input')
  }
  if (
    input.contentType.length < 1 ||
    input.contentType.length > 160 ||
    hasControlCharacter(input.contentType)
  ) {
    throw new ObjectStoreError('Object content type is invalid', 'invalid-input')
  }
  const createdAt = validateTimestamp(input.createdAt, 'createdAt')
  const retentionUntil =
    input.retentionUntil === undefined || input.retentionUntil === null
      ? null
      : validateTimestamp(input.retentionUntil, 'retentionUntil')
  if (retentionUntil !== null && retentionUntil < createdAt) {
    throw new ObjectStoreError('Retention cannot end before creation', 'invalid-input')
  }
  return {
    workspaceId: workspaceId.data,
    kind: kind.data,
    body: input.body,
    contentType: input.contentType,
    createdAt,
    retentionUntil
  }
}

function contentHash(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function buildReference(input: ObjectStorePutInput): ObjectReference {
  const hash = contentHash(input.body)
  return objectReferenceSchema.parse({
    version: 1,
    uri: `appsea-object://${input.workspaceId}/${input.kind}/${hash}`,
    workspaceId: input.workspaceId,
    kind: input.kind,
    contentHash: hash,
    byteLength: input.body.byteLength,
    contentType: input.contentType,
    createdAt: input.createdAt,
    retentionUntil: input.retentionUntil ?? null,
    deletionState: 'active',
    deletedAt: null,
    deletionReason: null
  })
}

function validateReferenceForWorkspace(
  workspaceId: string,
  reference: ObjectReference
): ObjectReference {
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedReference = objectReferenceSchema.safeParse(reference)
  if (!parsedWorkspaceId.success || !parsedReference.success) {
    throw new ObjectStoreError('Object reference is invalid', 'invalid-input')
  }
  if (parsedReference.data.workspaceId !== parsedWorkspaceId.data) {
    throw new ObjectStoreError(
      'Object reference belongs to another workspace',
      'workspace-mismatch'
    )
  }
  return parsedReference.data
}

function sameImmutableMetadata(left: ObjectReference, right: ObjectReference): boolean {
  return (
    left.uri === right.uri &&
    left.workspaceId === right.workspaceId &&
    left.kind === right.kind &&
    left.contentHash === right.contentHash &&
    left.byteLength === right.byteLength &&
    left.contentType === right.contentType &&
    left.createdAt === right.createdAt &&
    left.retentionUntil === right.retentionUntil
  )
}

function deletedReference(
  reference: ObjectReference,
  deletedAt: string,
  reason: string
): ObjectReference {
  if (reason.length < 1 || reason.length > 240 || hasControlCharacter(reason)) {
    throw new ObjectStoreError('Deletion reason is invalid', 'invalid-input')
  }
  return objectReferenceSchema.parse({
    ...reference,
    deletionState: 'deleted',
    deletedAt: validateTimestamp(deletedAt, 'deletedAt'),
    deletionReason: reason
  })
}

function assertPurgeAllowed(reference: ObjectReference, input: ObjectStorePurgeInput): void {
  const now = validateTimestamp(input.now, 'now')
  if (reference.deletionState !== 'deleted') {
    throw new ObjectStoreError('Only deleted objects may be purged', 'invalid-input')
  }
  if (
    input.authorization === 'retention-expired' &&
    reference.retentionUntil !== null &&
    now < reference.retentionUntil
  ) {
    throw new ObjectStoreError('Retention window has not expired', 'retention')
  }
}

function cloneBody(body: Uint8Array): Uint8Array {
  return new Uint8Array(body)
}

/** In-memory adapter used by deterministic package and repository tests. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { reference: ObjectReference; body: Uint8Array }>()
  private readonly maxBytes: number

  constructor(options: ObjectStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? defaultMaxBytes
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 100_000_000) {
      throw new ObjectStoreError('Object size limit is invalid', 'invalid-input')
    }
  }

  async put(input: ObjectStorePutInput): Promise<ObjectReference> {
    const parsed = validatePutInput(input, this.maxBytes)
    const reference = buildReference(parsed)
    const existing = this.objects.get(reference.uri)
    if (existing) {
      if (existing.reference.deletionState === 'deleted') {
        throw new ObjectStoreError('Deleted object cannot be resurrected', 'deleted')
      }
      if (!sameImmutableMetadata(existing.reference, reference)) {
        throw new ObjectStoreError(
          'Object metadata conflicts with immutable content',
          'immutable-conflict'
        )
      }
      if (contentHash(existing.body) !== reference.contentHash) {
        throw new ObjectStoreError('Stored object content hash is corrupt', 'corrupt')
      }
      return existing.reference
    }
    this.objects.set(reference.uri, { reference, body: cloneBody(parsed.body) })
    return reference
  }

  async head(workspaceId: string, reference: ObjectReference): Promise<ObjectReference | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    return this.objects.get(parsed.uri)?.reference ?? null
  }

  async get(workspaceId: string, reference: ObjectReference): Promise<ObjectStoreGetResult | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = this.objects.get(parsed.uri)
    if (!stored) return null
    if (stored.reference.deletionState === 'deleted') {
      throw new ObjectStoreError('Object has been deleted', 'deleted')
    }
    if (contentHash(stored.body) !== stored.reference.contentHash) {
      throw new ObjectStoreError('Stored object content hash is corrupt', 'corrupt')
    }
    return { reference: stored.reference, body: cloneBody(stored.body) }
  }

  async markDeleted(
    workspaceId: string,
    reference: ObjectReference,
    deletedAt: string,
    reason: string
  ): Promise<ObjectReference> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = this.objects.get(parsed.uri)
    if (!stored) throw new ObjectStoreError('Object was not found', 'not-found')
    if (stored.reference.deletionState === 'deleted') {
      if (stored.reference.deletionReason !== reason) {
        throw new ObjectStoreError(
          'Deletion reason conflicts with immutable tombstone',
          'immutable-conflict'
        )
      }
      return stored.reference
    }
    const deleted = deletedReference(stored.reference, deletedAt, reason)
    this.objects.set(parsed.uri, { reference: deleted, body: stored.body })
    return deleted
  }

  async purge(workspaceId: string, input: ObjectStorePurgeInput): Promise<void> {
    const parsed = validateReferenceForWorkspace(workspaceId, input.reference)
    const stored = this.objects.get(parsed.uri)
    if (!stored) return
    assertPurgeAllowed(stored.reference, input)
    this.objects.delete(parsed.uri)
  }
}

function encodedSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function assertInsideRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new ObjectStoreError('Object path escapes the configured root', 'invalid-input')
  }
}

/**
 * Filesystem adapter for local/CI and an S3-compatible implementation seam.
 * It uses content-addressed immutable files and sidecar metadata; production
 * deployment must provide encrypted storage, versioning, lifecycle rules, and
 * backup deletion verification around the same interface.
 */
export class FileObjectStore implements ObjectStore {
  private readonly root: string
  private readonly maxBytes: number

  constructor(root: string, options: ObjectStoreOptions = {}) {
    if (!root || !isAbsolute(root)) {
      throw new ObjectStoreError('Object store root must be an absolute path', 'invalid-input')
    }
    this.root = resolve(root)
    this.maxBytes = options.maxBytes ?? defaultMaxBytes
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 100_000_000) {
      throw new ObjectStoreError('Object size limit is invalid', 'invalid-input')
    }
  }

  private paths(reference: ObjectReference): { body: string; metadata: string } {
    const body = resolve(
      this.root,
      encodedSegment(reference.workspaceId),
      reference.kind,
      `${reference.contentHash}.blob`
    )
    const metadata = `${body}.json`
    assertInsideRoot(this.root, body)
    assertInsideRoot(this.root, metadata)
    return { body, metadata }
  }

  private async readReference(reference: ObjectReference): Promise<ObjectReference | null> {
    const paths = this.paths(reference)
    try {
      const raw = await readFile(paths.metadata, 'utf8')
      const parsed = objectReferenceSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) throw new ObjectStoreError('Object metadata is corrupt', 'corrupt')
      if (!sameImmutableMetadata(parsed.data, reference)) {
        throw new ObjectStoreError('Object metadata conflicts with its reference', 'corrupt')
      }
      return parsed.data
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async writeMetadata(reference: ObjectReference): Promise<void> {
    const paths = this.paths(reference)
    await mkdir(dirname(paths.metadata), { recursive: true })
    const temporary = `${paths.metadata}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(reference), { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, paths.metadata)
  }

  async put(input: ObjectStorePutInput): Promise<ObjectReference> {
    const parsed = validatePutInput(input, this.maxBytes)
    const reference = buildReference(parsed)
    const existing = await this.readReference(reference)
    if (existing) {
      if (existing.deletionState === 'deleted') {
        throw new ObjectStoreError('Deleted object cannot be resurrected', 'deleted')
      }
      if (!sameImmutableMetadata(existing, reference)) {
        throw new ObjectStoreError(
          'Object metadata conflicts with immutable content',
          'immutable-conflict'
        )
      }
      const stored = await readFile(this.paths(existing).body)
      if (contentHash(stored) !== existing.contentHash) {
        throw new ObjectStoreError('Stored object content hash is corrupt', 'corrupt')
      }
      return existing
    }

    const paths = this.paths(reference)
    await mkdir(dirname(paths.body), { recursive: true })
    const temporary = `${paths.body}.${randomUUID()}.tmp`
    await writeFile(temporary, parsed.body, { flag: 'wx' })
    try {
      await open(paths.body, 'wx').then(async (handle) => {
        await handle.writeFile(parsed.body)
        await handle.close()
        await rm(temporary, { force: true })
      })
    } catch (error) {
      await rm(temporary, { force: true })
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existingAfterRace = await this.readReference(reference)
      if (!existingAfterRace)
        throw new ObjectStoreError('Object write race lost metadata', 'corrupt')
      if (existingAfterRace.deletionState === 'deleted') {
        throw new ObjectStoreError('Deleted object cannot be resurrected', 'deleted')
      }
      return existingAfterRace
    }
    await this.writeMetadata(reference)
    return reference
  }

  async head(workspaceId: string, reference: ObjectReference): Promise<ObjectReference | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    return this.readReference(parsed)
  }

  async get(workspaceId: string, reference: ObjectReference): Promise<ObjectStoreGetResult | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = await this.readReference(parsed)
    if (!stored) return null
    if (stored.deletionState === 'deleted') {
      throw new ObjectStoreError('Object has been deleted', 'deleted')
    }
    let body: Uint8Array
    try {
      body = await readFile(this.paths(stored).body)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ObjectStoreError('Object body is missing', 'corrupt')
      }
      throw error
    }
    if (body.byteLength !== stored.byteLength || contentHash(body) !== stored.contentHash) {
      throw new ObjectStoreError('Stored object content hash is corrupt', 'corrupt')
    }
    return { reference: stored, body: cloneBody(body) }
  }

  async markDeleted(
    workspaceId: string,
    reference: ObjectReference,
    deletedAt: string,
    reason: string
  ): Promise<ObjectReference> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = await this.readReference(parsed)
    if (!stored) throw new ObjectStoreError('Object was not found', 'not-found')
    if (stored.deletionState === 'deleted') {
      if (stored.deletionReason !== reason) {
        throw new ObjectStoreError(
          'Deletion reason conflicts with immutable tombstone',
          'immutable-conflict'
        )
      }
      return stored
    }
    const deleted = deletedReference(stored, deletedAt, reason)
    await this.writeMetadata(deleted)
    return deleted
  }

  async purge(workspaceId: string, input: ObjectStorePurgeInput): Promise<void> {
    const parsed = validateReferenceForWorkspace(workspaceId, input.reference)
    const stored = await this.readReference(parsed)
    // A crash can leave the body without its sidecar metadata after the
    // metadata was durably tombstoned. The queue retains the immutable
    // reference, so retrying purge must still remove that orphan rather than
    // treating a missing sidecar as a successful no-op.
    if (stored) assertPurgeAllowed(stored, input)
    const paths = this.paths(stored ?? parsed)
    await rm(paths.body, { force: true })
    await rm(paths.metadata, { force: true })
    try {
      if ((await stat(dirname(paths.body))).isDirectory()) {
        await rm(dirname(paths.body), { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export interface S3ObjectStoreOptions extends ObjectStoreOptions {
  /** S3 or S3-compatible endpoint, including an https scheme in production. */
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  forcePathStyle?: boolean
  /** Injectable transport for deterministic tests and reviewed gateways. */
  fetchImpl?: typeof globalThis.fetch
  /** Injectable clock so signatures and metadata tests do not depend on wall time. */
  now?: () => Date
  /** Permit http only for loopback test endpoints; never enable this in production. */
  allowInsecureLocalhost?: boolean
}

const emptySha256 = createHash('sha256').update('').digest('hex')

function hmacSha256(key: Uint8Array | string, value: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(value).digest())
}

function hexDigest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hexBytes(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

function normalizedHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function awsDateParts(value: Date): { short: string; long: string } {
  if (Number.isNaN(value.getTime())) {
    throw new ObjectStoreError('S3 signing clock returned an invalid date', 'invalid-input')
  }
  const iso = value.toISOString().replace(/[-:]/g, '')
  return { short: iso.slice(0, 8), long: iso.slice(0, 15) + 'Z' }
}

function validateS3Text(value: string, label: string, maximum: number): string {
  if (
    value.length < 1 ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new ObjectStoreError('S3 ' + label + ' is invalid', 'invalid-input')
  }
  return value
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]'
}

function assertS3Options(options: S3ObjectStoreOptions): URL {
  let endpoint: URL
  try {
    endpoint = new URL(options.endpoint)
  } catch {
    throw new ObjectStoreError('S3 endpoint must be an absolute URL', 'invalid-input')
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.hostname
  ) {
    throw new ObjectStoreError(
      'S3 endpoint must not contain credentials or query state',
      'invalid-input'
    )
  }
  if (
    endpoint.protocol !== 'https:' &&
    !(
      options.allowInsecureLocalhost === true &&
      endpoint.protocol === 'http:' &&
      isLoopback(endpoint.hostname)
    )
  ) {
    throw new ObjectStoreError('S3 endpoint must use verified HTTPS', 'invalid-input')
  }
  validateS3Text(options.bucket, 'bucket', 255)
  validateS3Text(options.region, 'region', 120)
  validateS3Text(options.accessKeyId, 'access key', 256)
  validateS3Text(options.secretAccessKey, 'secret key', 256)
  if (options.sessionToken !== undefined) {
    validateS3Text(options.sessionToken, 'session token', 4096)
  }
  return endpoint
}

function joinS3Path(endpoint: URL, bucket: string, key: string, forcePathStyle: boolean): URL {
  const url = new URL(endpoint.toString())
  const prefix = url.pathname.split('/').filter(Boolean)
  const keySegments = key.split('/').filter(Boolean)
  if (forcePathStyle) {
    prefix.push(bucket)
  } else {
    url.hostname = bucket + '.' + url.hostname
  }
  prefix.push(...keySegments)
  url.pathname = '/' + prefix.map((segment) => encodeURIComponent(segment)).join('/')
  url.search = ''
  url.hash = ''
  return url
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&')
}

function responseEtag(response: Response): string | null {
  const value = response.headers.get('etag')
  return value && value.length <= 1024 ? value : null
}

async function boundedResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new ObjectStoreError('S3 response exceeds the object size limit', 'corrupt')
    }
  }
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > maxBytes) {
    throw new ObjectStoreError('S3 response exceeds the object size limit', 'corrupt')
  }
  return body
}

/**
 * S3-compatible adapter for production object storage.
 *
 * Objects use the same content-addressed reference as the local adapters. A
 * body and JSON sidecar are written with conditional requests; the sidecar is
 * the deletion/retention authority. The adapter never follows redirects and
 * signs every request with AWS Signature Version 4.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly endpoint: URL
  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly sessionToken: string | undefined
  private readonly forcePathStyle: boolean
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => Date
  private readonly maxBytes: number

  constructor(options: S3ObjectStoreOptions) {
    this.endpoint = assertS3Options(options)
    this.bucket = options.bucket
    this.region = options.region
    this.accessKeyId = options.accessKeyId
    this.secretAccessKey = options.secretAccessKey
    this.sessionToken = options.sessionToken
    this.forcePathStyle =
      options.forcePathStyle === true ||
      (options.forcePathStyle === undefined && isLoopback(this.endpoint.hostname))
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? (() => new Date())
    this.maxBytes = options.maxBytes ?? defaultMaxBytes
    if (typeof this.fetchImpl !== 'function') {
      throw new ObjectStoreError('S3 fetch transport is unavailable', 'unavailable')
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 100_000_000) {
      throw new ObjectStoreError('Object size limit is invalid', 'invalid-input')
    }
  }

  private key(reference: ObjectReference, metadata = false): string {
    const workspace = encodedSegment(reference.workspaceId)
    return (
      workspace +
      '/' +
      reference.kind +
      '/' +
      reference.contentHash +
      '.blob' +
      (metadata ? '.json' : '')
    )
  }

  private url(key: string): URL {
    return joinS3Path(this.endpoint, this.bucket, key, this.forcePathStyle)
  }

  private signedHeaders(
    method: string,
    url: URL,
    body: Uint8Array | undefined,
    extra: Record<string, string>
  ): Record<string, string> {
    const { short, long } = awsDateParts(this.now())
    const payloadHash = body ? hexDigest(body) : emptySha256
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': long,
      ...extra
    }
    if (this.sessionToken) headers['x-amz-security-token'] = this.sessionToken
    const names = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort()
    const canonicalHeaders =
      names.map((name) => name + ':' + normalizedHeaderValue(headers[name] ?? '')).join('\n') + '\n'
    const signed = names.join(';')
    const canonicalRequest = [
      method,
      url.pathname || '/',
      canonicalQuery(url),
      canonicalHeaders,
      signed,
      payloadHash
    ].join('\n')
    const scope = short + '/' + this.region + '/s3/aws4_request'
    const stringToSign = ['AWS4-HMAC-SHA256', long, scope, hexDigest(canonicalRequest)].join('\n')
    const dateKey = hmacSha256('AWS4' + this.secretAccessKey, short)
    const regionKey = hmacSha256(dateKey, this.region)
    const serviceKey = hmacSha256(regionKey, 's3')
    const signingKey = hmacSha256(serviceKey, 'aws4_request')
    const signature = hexBytes(hmacSha256(signingKey, stringToSign))
    return {
      ...headers,
      authorization:
        'AWS4-HMAC-SHA256 Credential=' +
        this.accessKeyId +
        '/' +
        scope +
        ', SignedHeaders=' +
        signed +
        ', Signature=' +
        signature
    }
  }

  private async send(
    method: string,
    reference: ObjectReference,
    options: {
      body?: Uint8Array
      contentType?: string
      ifMatch?: string
      ifNoneMatch?: string
      metadata?: boolean
    } = {}
  ): Promise<Response> {
    const body = options.body
    const url = this.url(this.key(reference, options.metadata))
    const headers: Record<string, string> = {}
    if (options.contentType) headers['content-type'] = options.contentType
    if (options.ifMatch) headers['if-match'] = options.ifMatch
    if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch
    const signed = this.signedHeaders(method, url, body, headers)
    try {
      const init: RequestInit = {
        method,
        headers: signed,
        redirect: 'error'
      }
      if (body) init.body = Buffer.from(body)
      return await this.fetchImpl(url, init)
    } catch {
      throw new ObjectStoreError('S3 object-store transport failed', 'unavailable')
    }
  }

  private async assertResponse(response: Response, operation: string): Promise<void> {
    if (response.ok) return
    if (response.status === 404) {
      throw new ObjectStoreError('S3 object ' + operation + ' was not found', 'not-found')
    }
    if (response.status === 409 || response.status === 412) {
      throw new ObjectStoreError('S3 object ' + operation + ' conflicted', 'immutable-conflict')
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new ObjectStoreError('S3 object ' + operation + ' is unavailable', 'unavailable')
    }
    throw new ObjectStoreError('S3 object ' + operation + ' failed', 'corrupt')
  }

  private async readMetadata(
    reference: ObjectReference
  ): Promise<{ reference: ObjectReference; etag: string | null } | null> {
    const response = await this.send('GET', reference, { metadata: true })
    if (response.status === 404) return null
    await this.assertResponse(response, 'metadata read')
    const body = await boundedResponseBody(response, Math.min(this.maxBytes, 1_000_000))
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(body))
    } catch {
      throw new ObjectStoreError('S3 object metadata is corrupt', 'corrupt')
    }
    const stored = objectReferenceSchema.safeParse(parsed)
    if (!stored.success || !sameImmutableMetadata(stored.data, reference)) {
      throw new ObjectStoreError('S3 object metadata conflicts with its reference', 'corrupt')
    }
    return { reference: stored.data, etag: responseEtag(response) }
  }

  private async readBody(reference: ObjectReference): Promise<Uint8Array> {
    const response = await this.send('GET', reference)
    await this.assertResponse(response, 'body read')
    const body = await boundedResponseBody(response, this.maxBytes)
    if (body.byteLength !== reference.byteLength || contentHash(body) !== reference.contentHash) {
      throw new ObjectStoreError('S3 object content hash is corrupt', 'corrupt')
    }
    return body
  }

  private async replay(
    expected: ObjectReference,
    stored: { reference: ObjectReference; etag: string | null }
  ): Promise<ObjectReference> {
    if (!sameImmutableMetadata(expected, stored.reference)) {
      throw new ObjectStoreError('S3 object metadata conflicts with its reference', 'corrupt')
    }
    if (stored.reference.deletionState === 'deleted') {
      throw new ObjectStoreError('Deleted object cannot be resurrected', 'deleted')
    }
    await this.readBody(stored.reference)
    return stored.reference
  }

  async put(input: ObjectStorePutInput): Promise<ObjectReference> {
    const parsed = validatePutInput(input, this.maxBytes)
    const reference = buildReference(parsed)
    const existing = await this.readMetadata(reference)
    if (existing) return this.replay(reference, existing)

    const bodyResponse = await this.send('PUT', reference, {
      body: parsed.body,
      contentType: parsed.contentType,
      ifNoneMatch: '*'
    })
    if (bodyResponse.status === 412 || bodyResponse.status === 409) {
      const replay = await this.readMetadata(reference)
      if (!replay) throw new ObjectStoreError('S3 object write race lost metadata', 'corrupt')
      return this.replay(reference, replay)
    }
    await this.assertResponse(bodyResponse, 'body write')

    const metadata = new TextEncoder().encode(JSON.stringify(reference))
    const metadataResponse = await this.send('PUT', reference, {
      body: metadata,
      contentType: 'application/json',
      ifNoneMatch: '*',
      metadata: true
    })
    if (metadataResponse.status === 412 || metadataResponse.status === 409) {
      const replay = await this.readMetadata(reference)
      if (!replay) throw new ObjectStoreError('S3 object metadata write race lost', 'corrupt')
      return this.replay(reference, replay)
    }
    await this.assertResponse(metadataResponse, 'metadata write')
    return reference
  }

  async head(workspaceId: string, reference: ObjectReference): Promise<ObjectReference | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = await this.readMetadata(parsed)
    return stored?.reference ?? null
  }

  async get(workspaceId: string, reference: ObjectReference): Promise<ObjectStoreGetResult | null> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = await this.readMetadata(parsed)
    if (!stored) return null
    if (stored.reference.deletionState === 'deleted') {
      throw new ObjectStoreError('Object has been deleted', 'deleted')
    }
    const body = await this.readBody(stored.reference)
    return { reference: stored.reference, body: cloneBody(body) }
  }

  async markDeleted(
    workspaceId: string,
    reference: ObjectReference,
    deletedAt: string,
    reason: string
  ): Promise<ObjectReference> {
    const parsed = validateReferenceForWorkspace(workspaceId, reference)
    const stored = await this.readMetadata(parsed)
    if (!stored) throw new ObjectStoreError('Object was not found', 'not-found')
    if (stored.reference.deletionState === 'deleted') {
      if (stored.reference.deletionReason !== reason) {
        throw new ObjectStoreError(
          'Deletion reason conflicts with immutable tombstone',
          'immutable-conflict'
        )
      }
      return stored.reference
    }
    const deleted = deletedReference(stored.reference, deletedAt, reason)
    const response = await this.send('PUT', deleted, {
      body: new TextEncoder().encode(JSON.stringify(deleted)),
      contentType: 'application/json',
      ifMatch: stored.etag ?? '*',
      metadata: true
    })
    if (response.status === 409 || response.status === 412) {
      const current = await this.readMetadata(parsed)
      if (
        current?.reference.deletionState === 'deleted' &&
        current.reference.deletionReason === reason
      ) {
        return current.reference
      }
      throw new ObjectStoreError('Deletion metadata changed concurrently', 'immutable-conflict')
    }
    await this.assertResponse(response, 'deletion mark')
    return deleted
  }

  async purge(workspaceId: string, input: ObjectStorePurgeInput): Promise<void> {
    const parsed = validateReferenceForWorkspace(workspaceId, input.reference)
    const stored = await this.readMetadata(parsed)
    const reference = stored?.reference ?? parsed
    assertPurgeAllowed(reference, input)
    const bodyResponse = await this.send('DELETE', reference)
    if (bodyResponse.status !== 404) await this.assertResponse(bodyResponse, 'body purge')
    const metadataResponse = await this.send(
      'DELETE',
      reference,
      stored?.etag ? { ifMatch: stored.etag, metadata: true } : { metadata: true }
    )
    if (metadataResponse.status !== 404)
      await this.assertResponse(metadataResponse, 'metadata purge')
  }
}

export interface ObjectStoreFactoryOptions {
  /** Development-only fallback. Production callers must omit this. */
  defaultRoot?: string
  maxBytes?: number
  fetchImpl?: typeof globalThis.fetch
  now?: () => Date
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim()
  return value ? value : undefined
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environmentValue(environment, name)
  if (!value) throw new ObjectStoreError(name + ' is required for object storage', 'invalid-input')
  return value
}

/**
 * Selects the reviewed object-store adapter from deployment configuration.
 * Local development may use an explicit absolute filesystem root. Production
 * must provide all S3-compatible credentials and cannot silently fall back to
 * a process-local directory.
 */
export function objectStoreFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
  options: ObjectStoreFactoryOptions = {}
): ObjectStore {
  const endpoint = environmentValue(environment, 'APPSEA_OBJECT_STORE_ENDPOINT')
  const root = environmentValue(environment, 'APPSEA_OBJECT_STORE_ROOT')
  const cloudValues = [
    'APPSEA_OBJECT_STORE_BUCKET',
    'APPSEA_OBJECT_STORE_REGION',
    'APPSEA_OBJECT_STORE_ACCESS_KEY_ID',
    'APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY'
  ]
  const hasPartialCloudConfig = cloudValues.some((name) => environmentValue(environment, name))
  if (endpoint || hasPartialCloudConfig) {
    if (!endpoint) {
      throw new ObjectStoreError(
        'APPSEA_OBJECT_STORE_ENDPOINT is required with cloud object-store settings',
        'invalid-input'
      )
    }
    if (root) {
      throw new ObjectStoreError(
        'Filesystem and cloud object-store settings cannot be combined',
        'invalid-input'
      )
    }
    const insecureLocalhost = environmentValue(
      environment,
      'APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST'
    )
    if (
      insecureLocalhost !== undefined &&
      insecureLocalhost !== 'true' &&
      insecureLocalhost !== 'false'
    ) {
      throw new ObjectStoreError(
        'APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST must be true or false',
        'invalid-input'
      )
    }
    if (
      insecureLocalhost === 'true' &&
      !['development', 'test'].includes(environmentValue(environment, 'NODE_ENV') ?? '')
    ) {
      throw new ObjectStoreError(
        'Insecure localhost object storage is not allowed in production',
        'invalid-input'
      )
    }
    const forcePathStyle = environmentValue(environment, 'APPSEA_OBJECT_STORE_FORCE_PATH_STYLE')
    if (forcePathStyle !== undefined && forcePathStyle !== 'true' && forcePathStyle !== 'false') {
      throw new ObjectStoreError(
        'APPSEA_OBJECT_STORE_FORCE_PATH_STYLE must be true or false',
        'invalid-input'
      )
    }
    const s3Options: S3ObjectStoreOptions = {
      endpoint,
      bucket: requiredEnvironmentValue(environment, 'APPSEA_OBJECT_STORE_BUCKET'),
      region: requiredEnvironmentValue(environment, 'APPSEA_OBJECT_STORE_REGION'),
      accessKeyId: requiredEnvironmentValue(environment, 'APPSEA_OBJECT_STORE_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironmentValue(
        environment,
        'APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY'
      ),
      allowInsecureLocalhost: insecureLocalhost === 'true',
      ...(forcePathStyle === undefined ? {} : { forcePathStyle: forcePathStyle === 'true' }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.now === undefined ? {} : { now: options.now })
    }
    const sessionToken = environmentValue(environment, 'APPSEA_OBJECT_STORE_SESSION_TOKEN')
    if (sessionToken) s3Options.sessionToken = sessionToken
    return new S3ObjectStore(s3Options)
  }
  if (root && environmentValue(environment, 'NODE_ENV') === 'production') {
    throw new ObjectStoreError(
      'Production object storage requires signed S3-compatible configuration',
      'invalid-input'
    )
  }
  if (root) {
    return new FileObjectStore(
      root,
      options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }
    )
  }
  if (options.defaultRoot) {
    return new FileObjectStore(
      options.defaultRoot,
      options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }
    )
  }
  throw new ObjectStoreError(
    'Configure APPSEA_OBJECT_STORE_ROOT or the S3-compatible object-store settings',
    'invalid-input'
  )
}

export type { ObjectReference, ObjectStorageKind } from '@appsea/contracts'
