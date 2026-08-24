import { describe, expect, it } from 'vitest'
import type {
  ProductionCollectionRecollectionTarget,
  ResearchCampaignReadModel
} from '@appsea/contracts'
import { recollectionCampaignOptions } from './workspace/recollection-campaign-options'

const target: ProductionCollectionRecollectionTarget = {
  tombstoneId: 'tombstone:source:record',
  sourceId: 'cfpb-consumer-complaints',
  sourceRecordId: '123456',
  reason: 'source_retention_expired',
  completedAt: '2026-08-01T00:00:00.000Z',
  activeSourceItem: false,
  activeWorkflowId: null
}

function campaign(
  overrides: Partial<ResearchCampaignReadModel['sources'][number]> = {}
): ResearchCampaignReadModel {
  return {
    workspaceId: 'workspace:private',
    campaignId: 'campaign:billing',
    name: 'Billing complaints',
    purpose: 'opportunity-research',
    state: 'draft',
    configuration: {
      schemaVersion: 'campaign-v1',
      goal: 'Find recurring workflow problems.',
      query: 'billing',
      seeds: ['billing'],
      sourceIds: ['cfpb-consumer-complaints'],
      languages: ['en'],
      geographies: [],
      dateRange: { from: null, to: null },
      exclusions: [],
      maxEvidenceCount: 100,
      refreshPolicy: 'manual',
      sensitiveTopicPolicy: 'review',
      requestedDisplayMode: 'excerpt'
    },
    budget: {
      currency: 'USD',
      maxSourceItems: 100,
      maxCostMicros: 500,
      maxActivityAttempts: 3
    },
    synthetic: false,
    sources: [
      {
        sourceId: 'cfpb-consumer-complaints',
        displayName: 'CFPB complaints',
        sourceType: 'api',
        lifecycleState: 'active',
        policyVersion: 'cfpb-v1',
        policyState: 'approved',
        permittedPurposes: ['opportunity-research'],
        displayMode: 'excerpt',
        enabled: true,
        synthetic: false,
        coverageNotes: [],
        reviewedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: null,
        ...overrides
      }
    ],
    refreshSchedule: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

describe('recollection campaign options', () => {
  it('only offers a current approved campaign matching source policy', () => {
    const options = recollectionCampaignOptions(target, [
      campaign(),
      campaign({ policyState: 'pending_review' }),
      campaign({ displayMode: 'metadata-only' }),
      campaign({ enabled: false }),
      campaign({ sourceType: 'manual' })
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      campaignId: 'campaign:billing',
      policyVersion: 'cfpb-v1',
      requestedDisplayMode: 'excerpt'
    })
  })

  it('returns no option when the campaign cannot represent the tombstone source', () => {
    const mismatched = campaign()
    mismatched.configuration = { ...mismatched.configuration, sourceIds: ['other-source'] }
    expect(recollectionCampaignOptions(target, [mismatched])).toEqual([])
  })
})
