import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planPackageSchema } from '@appsea/contracts'
import { FileObjectStore, InMemoryObjectStore, ObjectStoreError } from './index'

const createdAt = '2026-07-26T00:00:00.000Z'
const planPackage = planPackageSchema.parse({
  opportunitySlug: 'safe-plan',
  generatedAt: createdAt,
  files: [
    {
      path: 'README.md',
      content: '# Plan\n\nGenerated from retained, policy-allowed evidence.\n'
    }
  ]
})
const body = new TextEncoder().encode(JSON.stringify(planPackage))

function input(overrides: Partial<Parameters<InMemoryObjectStore['put']>[0]> = {}) {
  return {
    workspaceId: 'workspace-test',
    kind: 'plan-package' as const,
    body,
    contentType: 'application/json',
    createdAt,
    retentionUntil: '2026-08-26T00:00:00.000Z',
    ...overrides
  }
}

describe.each([
  ['memory', () => new InMemoryObjectStore()],
  [
    'filesystem',
    async () => new FileObjectStore(await mkdtemp(join(tmpdir(), 'appsea-object-store-')))
  ]
])('%s object store', (_name, createStore) => {
  it('stores immutable content-addressed objects and replays identical puts', async () => {
    const store = await createStore()
    const first = await store.put(input())
    const replay = await store.put(input())

    expect(replay).toEqual(first)
    expect(first.uri).toBe(`appsea-object://workspace-test/plan-package/${first.contentHash}`)
    await expect(store.get('workspace-test', first)).resolves.toMatchObject({
      reference: first,
      body
    })
  })

  it('keeps workspace references isolated and deletion terminal', async () => {
    const store = await createStore()
    const reference = await store.put(input())

    await expect(store.get('workspace-other', reference)).rejects.toMatchObject({
      code: 'workspace-mismatch'
    })
    const deleted = await store.markDeleted(
      'workspace-test',
      reference,
      '2026-07-27T00:00:00.000Z',
      'source tombstone received'
    )
    expect(deleted.deletionState).toBe('deleted')
    await expect(store.get('workspace-test', deleted)).rejects.toMatchObject({ code: 'deleted' })
    await expect(
      store.markDeleted('workspace-test', deleted, '2026-07-27T00:00:00.000Z', 'different reason')
    ).rejects.toMatchObject({ code: 'immutable-conflict' })
  })

  it('requires deletion authorization and retention expiry before purge', async () => {
    const store = await createStore()
    const reference = await store.put(input())
    const deleted = await store.markDeleted(
      'workspace-test',
      reference,
      '2026-07-27T00:00:00.000Z',
      'retention cleanup'
    )

    await expect(
      store.purge('workspace-test', {
        reference: deleted,
        authorization: 'retention-expired',
        now: '2026-08-01T00:00:00.000Z'
      })
    ).rejects.toMatchObject({ code: 'retention' })
    await store.purge('workspace-test', {
      reference: deleted,
      authorization: 'retention-expired',
      now: '2026-09-01T00:00:00.000Z'
    })
    await expect(store.head('workspace-test', deleted)).resolves.toBeNull()
  })
})

describe('object-store validation', () => {
  it('rejects oversized bodies and invalid roots', async () => {
    expect(() => new FileObjectStore('relative-root')).toThrowError(ObjectStoreError)
    const store = new InMemoryObjectStore({ maxBytes: 4 })
    await expect(store.put(input({ body: new Uint8Array([1, 2, 3, 4, 5]) }))).rejects.toMatchObject(
      {
        code: 'invalid-input'
      }
    )
  })
})

describe('filesystem cleanup', () => {
  it('purges blob and metadata files without leaving content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appsea-object-store-cleanup-'))
    try {
      const store = new FileObjectStore(root)
      const reference = await store.put(input())
      const deleted = await store.markDeleted(
        'workspace-test',
        reference,
        '2026-07-27T00:00:00.000Z',
        'workspace closure'
      )
      await store.purge('workspace-test', {
        reference: deleted,
        authorization: 'workspace-closure',
        now: '2026-07-27T00:00:00.000Z'
      })
      await expect(store.head('workspace-test', deleted)).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes an orphaned body when a crash left no metadata sidecar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appsea-object-store-orphan-'))
    try {
      const store = new FileObjectStore(root)
      const reference = await store.put(input())
      const deleted = await store.markDeleted(
        'workspace-test',
        reference,
        '2026-07-27T00:00:00.000Z',
        'source deletion retention purge'
      )
      const workspaceSegment = Buffer.from('workspace-test', 'utf8').toString('base64url')
      const metadataPath = join(
        root,
        workspaceSegment,
        'plan-package',
        `${deleted.contentHash}.blob.json`
      )
      const bodyPath = metadataPath.slice(0, -'.json'.length)
      await rm(metadataPath)

      await store.purge('workspace-test', {
        reference: deleted,
        authorization: 'retention-expired',
        now: '2026-09-01T00:00:00.000Z'
      })
      await expect(store.head('workspace-test', deleted)).resolves.toBeNull()
      await expect(readFile(bodyPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
