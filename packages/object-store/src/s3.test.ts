import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FileObjectStore,
  objectStoreFromEnv,
  S3ObjectStore,
  ObjectStoreError,
  type ObjectStorePutInput
} from './index'

const createdAt = '2026-08-01T00:00:00.000Z'
const body = new TextEncoder().encode('{"approved":true,"source":"policy-bound"}')

interface StoredObject {
  body: Uint8Array
  etag: string
}

interface RequestRecord {
  url: string
  method: string
  headers: Headers
  redirect: RequestInit['redirect']
}

function objectInput(overrides: Partial<ObjectStorePutInput> = {}): ObjectStorePutInput {
  return {
    workspaceId: 'workspace-test',
    kind: 'report-json',
    body,
    contentType: 'application/json',
    createdAt,
    retentionUntil: '2026-08-26T00:00:00.000Z',
    ...overrides
  }
}

function etag(value: Uint8Array): string {
  return '"' + createHash('sha256').update(value).digest('hex') + '"'
}

function fakeS3() {
  const objects = new Map<string, StoredObject>()
  const requests: RequestRecord[] = []
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = String(init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    requests.push({ url: url.toString(), method, headers, redirect: init.redirect })
    const key = url.pathname
    const existing = objects.get(key)
    if (method === 'GET') {
      if (!existing) return new Response(null, { status: 404 })
      return new Response(Buffer.from(existing.body), {
        status: 200,
        headers: { etag: existing.etag, 'content-length': String(existing.body.byteLength) }
      })
    }
    if (method === 'PUT') {
      if (headers.get('if-none-match') === '*' && existing) {
        return new Response(null, { status: 412 })
      }
      if (headers.has('if-match') && (!existing || headers.get('if-match') !== existing.etag)) {
        return new Response(null, { status: 412 })
      }
      const written = new Uint8Array(await new Response(init.body ?? null).arrayBuffer())
      const next = { body: written, etag: etag(written) }
      objects.set(key, next)
      return new Response(null, { status: 200, headers: { etag: next.etag } })
    }
    if (method === 'DELETE') {
      if (!existing) return new Response(null, { status: 404 })
      if (headers.has('if-match') && headers.get('if-match') !== existing.etag) {
        return new Response(null, { status: 412 })
      }
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405 })
  }
  return { objects, requests, fetchImpl }
}

function createStore(fake: ReturnType<typeof fakeS3>) {
  return new S3ObjectStore({
    endpoint: 'https://objects.example.test',
    bucket: 'appsea-test',
    region: 'us-east-1',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    forcePathStyle: true,
    fetchImpl: fake.fetchImpl,
    now: () => new Date('2026-08-01T12:34:56.000Z')
  })
}

describe('S3ObjectStore', () => {
  it('round-trips immutable objects and signs requests without exposing the secret', async () => {
    const fake = fakeS3()
    const store = createStore(fake)

    const first = await store.put(objectInput())
    const replay = await store.put(objectInput())

    expect(replay).toEqual(first)
    await expect(store.get('workspace-test', first)).resolves.toMatchObject({
      reference: first,
      body
    })
    expect(fake.requests.length).toBeGreaterThan(0)
    for (const request of fake.requests) {
      expect(request.redirect).toBe('error')
      expect(request.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=test-access/
      )
      expect(request.headers.get('authorization')).not.toContain('test-secret')
      expect(request.headers.get('x-amz-date')).toBe('20260801T123456Z')
    }
  })

  it('keeps workspace isolation and enforces deletion retention before purge', async () => {
    const fake = fakeS3()
    const store = createStore(fake)
    const reference = await store.put(objectInput())

    await expect(store.get('workspace-other', reference)).rejects.toMatchObject({
      code: 'workspace-mismatch'
    })
    const deleted = await store.markDeleted(
      'workspace-test',
      reference,
      '2026-08-02T00:00:00.000Z',
      'source deletion tombstone'
    )
    await expect(store.get('workspace-test', deleted)).rejects.toMatchObject({ code: 'deleted' })
    await expect(
      store.purge('workspace-test', {
        reference: deleted,
        authorization: 'retention-expired',
        now: '2026-08-10T00:00:00.000Z'
      })
    ).rejects.toMatchObject({ code: 'retention' })
    await store.purge('workspace-test', {
      reference: deleted,
      authorization: 'retention-expired',
      now: '2026-09-01T00:00:00.000Z'
    })
    await expect(store.head('workspace-test', deleted)).resolves.toBeNull()
  })

  it('detects body corruption and rejects insecure non-loopback endpoints', async () => {
    const fake = fakeS3()
    const store = createStore(fake)
    const reference = await store.put(objectInput())
    const bodyRequest = fake.requests.find(
      (request) => request.method === 'PUT' && !request.url.endsWith('.json')
    )
    expect(bodyRequest).toBeDefined()
    const bodyKey = new URL(bodyRequest!.url).pathname
    fake.objects.set(bodyKey, { body: new TextEncoder().encode('tampered'), etag: '"tampered"' })
    await expect(store.get('workspace-test', reference)).rejects.toMatchObject({
      code: 'corrupt'
    })

    expect(
      () =>
        new S3ObjectStore({
          endpoint: 'http://objects.example.test',
          bucket: 'appsea-test',
          region: 'us-east-1',
          accessKeyId: 'test-access',
          secretAccessKey: 'test-secret',
          fetchImpl: fake.fetchImpl
        })
    ).toThrowError(ObjectStoreError)
  })

  it('allows loopback HTTP only when explicitly enabled for local adapters', () => {
    const fake = fakeS3()
    expect(
      () =>
        new S3ObjectStore({
          endpoint: 'http://127.0.0.1:9000',
          bucket: 'appsea-test',
          region: 'us-east-1',
          accessKeyId: 'test-access',
          secretAccessKey: 'test-secret',
          allowInsecureLocalhost: true,
          fetchImpl: fake.fetchImpl
        })
    ).not.toThrow()
  })
})

describe('object-store configuration', () => {
  it('selects S3 only from a complete cloud configuration', () => {
    const fake = fakeS3()
    const store = objectStoreFromEnv(
      {
        NODE_ENV: 'production',
        APPSEA_OBJECT_STORE_ENDPOINT: 'https://objects.example.test',
        APPSEA_OBJECT_STORE_BUCKET: 'appsea-test',
        APPSEA_OBJECT_STORE_REGION: 'us-east-1',
        APPSEA_OBJECT_STORE_ACCESS_KEY_ID: 'test-access',
        APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY: 'test-secret'
      },
      { fetchImpl: fake.fetchImpl }
    )
    expect(store).toBeInstanceOf(S3ObjectStore)
    expect(() =>
      objectStoreFromEnv({
        APPSEA_OBJECT_STORE_ENDPOINT: 'https://objects.example.test',
        APPSEA_OBJECT_STORE_BUCKET: 'appsea-test'
      })
    ).toThrowError(ObjectStoreError)
  })

  it('keeps local defaults explicit and rejects an absent production adapter', () => {
    expect(
      objectStoreFromEnv({ NODE_ENV: 'development' }, { defaultRoot: 'C:\\appsea-objects' })
    ).toBeInstanceOf(FileObjectStore)
    expect(() => objectStoreFromEnv({ NODE_ENV: 'production' })).toThrowError(ObjectStoreError)
    expect(() =>
      objectStoreFromEnv({ NODE_ENV: 'production', APPSEA_OBJECT_STORE_ROOT: 'C:\\appsea-objects' })
    ).toThrowError(ObjectStoreError)
    expect(() =>
      objectStoreFromEnv({
        APPSEA_OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:9000',
        APPSEA_OBJECT_STORE_BUCKET: 'appsea-test',
        APPSEA_OBJECT_STORE_REGION: 'us-east-1',
        APPSEA_OBJECT_STORE_ACCESS_KEY_ID: 'test-access',
        APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY: 'test-secret',
        APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST: 'true'
      })
    ).toThrowError(ObjectStoreError)
  })
})
