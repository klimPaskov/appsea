import { describe, expect, it } from 'vitest'
import { decodePathParam } from './path-params'

describe('decodePathParam', () => {
  it('decodes one encoded persistence-safe path segment', () => {
    expect(decodePathParam('workspace%3Aabc123')).toBe('workspace:abc123')
  })

  it('does not recursively decode untrusted input', () => {
    expect(decodePathParam('workspace%253Aabc123')).toBe('workspace%3Aabc123')
  })

  it('leaves malformed encodings for the caller schema to reject', () => {
    expect(decodePathParam('workspace%3')).toBe('workspace%3')
  })
})
