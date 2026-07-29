import { describe, expect, it } from 'vitest'
import { getOpportunity, getOpportunityComplaints, seedOpportunities } from './index'

describe('fixture catalog', () => {
  it('is sorted by descending score', () => {
    const scores = seedOpportunities.map((entry) => entry.scoreSnapshot.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('labels every opportunity as synthetic', () => {
    expect(seedOpportunities.every((entry) => entry.synthetic)).toBe(true)
  })

  it('resolves complaints for the top opportunity', () => {
    const opportunity = getOpportunity('inbox-relay')
    expect(opportunity).toBeDefined()
    expect(getOpportunityComplaints(opportunity!)).toHaveLength(4)
  })
})
