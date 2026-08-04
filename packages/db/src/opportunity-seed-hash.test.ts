import { describe, expect, it } from 'vitest'
import { productionOpportunitySeedSchema } from '@appsea/contracts'
import { contentHash } from './hash'
import { opportunitySeedContentHash } from './opportunity-seed-hash'

const seed = productionOpportunitySeedSchema.parse({
  id: 'opportunity:matrix',
  slug: 'matrix',
  name: 'Matrix',
  oneLine: 'A reviewed opportunity',
  thesis: 'A reviewed thesis',
  audience: 'Operators',
  firstWedge: 'Evidence review',
  tags: ['reviewed'],
  competitors: [
    {
      name: 'Existing tool',
      type: 'direct',
      positioning: 'A comparable product',
      strengths: ['Known'],
      weaknesses: ['Limited'],
      relatedComplaintCategories: ['handoff']
    }
  ],
  contraryEvidence: ['Needs validation'],
  scoreFactors: {
    complaintVolume: 60,
    painSeverity: 60,
    recurrence: 50,
    willingnessToPay: 40,
    competitiveGap: 50,
    buildFeasibility: 70,
    evidenceQuality: 80,
    contraryEvidencePenalty: 20
  },
  planFiles: [
    'README.md',
    '01-product-brief.md',
    '02-mvp-scope.md',
    '03-architecture.md',
    '04-task-graph.json',
    '05-validation.md'
  ]
})

describe('opportunity seed content hash compatibility', () => {
  it('keeps empty competitor matrices compatible with legacy seed content', () => {
    const legacy = {
      ...seed,
      competitors: seed.competitors.map(({ featureMatrix: _featureMatrix, ...competitor }) => {
        void _featureMatrix
        return competitor
      })
    }
    expect(opportunitySeedContentHash(seed)).toBe(contentHash(legacy))
  })

  it('includes populated competitor matrices in new seed content', () => {
    const populated = productionOpportunitySeedSchema.parse({
      ...seed,
      competitors: [
        {
          ...seed.competitors[0],
          featureMatrix: [
            {
              feature: 'Handoff history',
              status: 'partial',
              evidenceBasis: 'reviewed-seed',
              notes: 'Needs validation.'
            }
          ]
        }
      ]
    })
    expect(opportunitySeedContentHash(populated)).not.toBe(opportunitySeedContentHash(seed))
  })
})
