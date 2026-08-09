import { describe, expect, it } from 'vitest'
import {
  decodeWorkspaceArtifactHistoryCursor,
  encodeWorkspaceArtifactHistoryCursor,
  WorkspaceArtifactHistoryCursorError
} from './workspace-artifact-history-pagination'

describe('workspace artifact history cursors', () => {
  it('round-trips a workspace/opportunity-scoped report cursor', () => {
    const encoded = encodeWorkspaceArtifactHistoryCursor(
      'workspace:one',
      'opportunity:one',
      'reports',
      '2026-08-09T00:00:00.000Z',
      'report:one'
    )
    expect(
      decodeWorkspaceArtifactHistoryCursor(encoded, 'workspace:one', 'opportunity:one', 'reports')
    ).toEqual({
      version: 1,
      generatedAt: '2026-08-09T00:00:00.000Z',
      itemId: 'report:one'
    })
  })

  it('rejects malformed, cross-scope, and cross-family cursors', () => {
    expect(() =>
      decodeWorkspaceArtifactHistoryCursor(
        'not-a-cursor',
        'workspace:one',
        'opportunity:one',
        'reports'
      )
    ).toThrow(WorkspaceArtifactHistoryCursorError)
    const encoded = encodeWorkspaceArtifactHistoryCursor(
      'workspace:one',
      'opportunity:one',
      'plans',
      '2026-08-09T00:00:00.000Z',
      'plan:one'
    )
    expect(() =>
      decodeWorkspaceArtifactHistoryCursor(encoded, 'workspace:other', 'opportunity:one', 'plans')
    ).toThrow(WorkspaceArtifactHistoryCursorError)
    expect(() =>
      decodeWorkspaceArtifactHistoryCursor(encoded, 'workspace:one', 'opportunity:one', 'reports')
    ).toThrow(WorkspaceArtifactHistoryCursorError)
  })
})
