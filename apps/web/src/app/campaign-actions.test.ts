import { describe, expect, it } from 'vitest'
import { extractCampaignSourceIds, withCampaignSourceIds } from './workspace/campaign-actions'

describe('campaign source picker helpers', () => {
  it('reads unique string source IDs from a draft configuration', () => {
    expect(
      extractCampaignSourceIds({ sourceIds: ['source:one', 'source:one', 7, 'source:two'] })
    ).toEqual(['source:one', 'source:two'])
    expect(extractCampaignSourceIds({ sourceIds: 'source:one' })).toEqual([])
    expect(extractCampaignSourceIds(null)).toEqual([])
  })

  it('replaces only the source allowlist while preserving the rest of the draft', () => {
    expect(
      withCampaignSourceIds(
        { schemaVersion: 'campaign-v1', goal: 'Find gaps', sourceIds: ['source:old'] },
        ['source:new', 'source:new']
      )
    ).toEqual({ schemaVersion: 'campaign-v1', goal: 'Find gaps', sourceIds: ['source:new'] })
  })

  it('rejects a non-object campaign configuration', () => {
    expect(() => withCampaignSourceIds([], ['source:one'])).toThrow(
      'Campaign configuration must be a JSON object'
    )
  })
})
