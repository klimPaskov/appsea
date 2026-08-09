import { describe, expect, it } from 'vitest'
import { comparePlanPackages } from './plan-comparison'

describe('plan package comparison', () => {
  it('compares sorted file paths using deterministic hashes and UTF-8 bytes', () => {
    const before = {
      opportunitySlug: 'inbox-relay',
      generatedAt: '2026-07-10T00:00:00.000Z',
      files: [
        { path: 'z.md', content: 'same' },
        { path: 'a.md', content: 'before' },
        { path: 'removed.md', content: 'gone' }
      ]
    }
    const after = {
      opportunitySlug: 'inbox-relay',
      generatedAt: '2026-07-11T00:00:00.000Z',
      files: [
        { path: 'new.md', content: 'new' },
        { path: 'z.md', content: 'same' },
        { path: 'a.md', content: 'after' }
      ]
    }

    const comparison = comparePlanPackages(before, after)
    expect(comparison.files.map((file) => file.path)).toEqual([
      'a.md',
      'new.md',
      'removed.md',
      'z.md'
    ])
    expect(comparison.changedPaths).toEqual(['a.md'])
    expect(comparison.addedPaths).toEqual(['new.md'])
    expect(comparison.removedPaths).toEqual(['removed.md'])
    expect(comparison.unchangedPaths).toEqual(['z.md'])
    expect(comparison.before.files.map((file) => file.path)).toEqual(['a.md', 'removed.md', 'z.md'])
    expect(comparison.before.files[0]).toMatchObject({ path: 'a.md', bytes: 6 })
    expect(comparison.before.files[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(comparison.identical).toBe(false)
    expect(comparison.metadataChanged).toBe(true)
  })

  it('ignores input file order and generated time for content identity', () => {
    const first = {
      opportunitySlug: 'inbox-relay',
      generatedAt: '2026-07-10T00:00:00.000Z',
      files: [
        { path: 'b.md', content: 'same' },
        { path: 'a.md', content: 'same' }
      ]
    }
    const replay = {
      opportunitySlug: 'inbox-relay',
      generatedAt: '2026-07-11T00:00:00.000Z',
      files: [
        { path: 'a.md', content: 'same' },
        { path: 'b.md', content: 'same' }
      ]
    }

    const comparison = comparePlanPackages(first, replay)
    expect(comparison.identical).toBe(true)
    expect(comparison.metadataChanged).toBe(true)
    expect(comparison.before.hash).toBe(comparison.after.hash)
    expect(comparison.changed).toHaveLength(0)
  })
})
