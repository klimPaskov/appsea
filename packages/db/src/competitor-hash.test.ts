import { describe, expect, it } from 'vitest'
import { competitorSchema } from '@appsea/contracts'
import { contentHash } from './hash'
import { competitorContentHash } from './competitor-hash'

const base = competitorSchema.parse({
  name: 'Fixture alternative',
  type: 'adjacent',
  positioning: 'A test alternative',
  strengths: ['simple'],
  weaknesses: ['manual'],
  relatedComplaintCategories: ['handoff']
})

describe('competitor content hash compatibility', () => {
  it('keeps empty feature matrices compatible with legacy rows', () => {
    const { featureMatrix, ...legacy } = base
    void featureMatrix
    expect(competitorContentHash(base)).toBe(contentHash(legacy))
  })

  it('includes populated feature matrices in immutable content', () => {
    const withMatrix = competitorSchema.parse({
      ...base,
      featureMatrix: [
        {
          feature: 'Handoff history',
          status: 'partial',
          evidenceBasis: 'reviewed-seed',
          notes: 'Requires manual review.'
        }
      ]
    })
    expect(competitorContentHash(withMatrix)).not.toBe(competitorContentHash(base))
  })
})
