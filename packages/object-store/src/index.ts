import { createHash, randomUUID } from 'node:crypto'
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

export type { ObjectReference, ObjectStorageKind } from '@appsea/contracts'
