import { describe, expect, it } from 'vitest'
import {
  decodeCampaignHistoryCursor,
  encodeCampaignHistoryCursor
} from './campaign-history-pagination'

describe('campaign history cursors', () => {
  it('round-trips an identifier-only stable cursor', () => {
    const encoded = encodeCampaignHistoryCursor(
      'runs',
      '2026-08-02T00:00:00.000Z',
      'workflow:production:workspace:one:aaaaaaaa'
    )
    expect(decodeCampaignHistoryCursor(encoded, 'runs')).toEqual({
      version: 1,
      requestedAt: '2026-08-02T00:00:00.000Z',
      itemId: 'workflow:production:workspace:one:aaaaaaaa'
    })
    expect(() => decodeCampaignHistoryCursor(encoded, 'orchestrations')).toThrow(
      'Campaign history cursor is invalid'
    )
  })

  it('rejects malformed and non-url-safe cursors', () => {
    expect(() => decodeCampaignHistoryCursor('not a cursor', 'runs')).toThrow(
      'Campaign history cursor is invalid'
    )
  })
})
