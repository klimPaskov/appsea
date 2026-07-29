import { describe, expect, it } from 'vitest'
import { objectReferenceSchema } from './index'

const hash = 'a'.repeat(64)

const active = {
  version: 1 as const,
  uri: `appsea-object://workspace-test/plan-package/${hash}`,
  workspaceId: 'workspace-test',
  kind: 'plan-package' as const,
  contentHash: hash,
  byteLength: 128,
  contentType: 'application/json',
  createdAt: '2026-07-26T00:00:00.000Z',
  retentionUntil: '2026-08-26T00:00:00.000Z',
  deletionState: 'active' as const,
  deletedAt: null,
  deletionReason: null
}

describe('object reference contract', () => {
  it('accepts a content-addressed active reference', () => {
    expect(objectReferenceSchema.parse(active)).toEqual(active)
  })

  it('rejects URI/hash mismatches and incomplete tombstones', () => {
    expect(() =>
      objectReferenceSchema.parse({ ...active, uri: active.uri.replace(hash, 'b'.repeat(64)) })
    ).toThrow()
    expect(() =>
      objectReferenceSchema.parse({
        ...active,
        deletionState: 'deleted',
        deletedAt: null,
        deletionReason: 'source deletion'
      })
    ).toThrow()
  })
})
