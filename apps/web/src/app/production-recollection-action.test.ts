import { describe, expect, it } from 'vitest'
import {
  productionCollectionWorkflowStartRequestSchema,
  type ProductionCollectionRecollectionTarget
} from '@appsea/contracts'
import {
  buildProductionRecollectionRequest,
  type ProductionRecollectionCampaignOption
} from './workspace/production-recollection-action'

const target: ProductionCollectionRecollectionTarget = {
  tombstoneId: 'tombstone:source:record',
  sourceId: 'cfpb-consumer-complaints',
  sourceRecordId: '123456',
  reason: 'source_retention_expired',
  completedAt: '2026-08-01T00:00:00.000Z',
  activeSourceItem: false,
  activeWorkflowId: null
}

const campaign: ProductionRecollectionCampaignOption = {
  campaignId: 'campaign:billing',
  campaignName: 'Billing complaints',
  policyVersion: 'cfpb-v1',
  query: 'billing',
  dateRange: { from: null, to: null },
  purpose: 'opportunity-research',
  requestedDisplayMode: 'excerpt',
  budget: {
    currency: 'USD',
    maxSourceItems: 100,
    maxCostMicros: 500,
    maxActivityAttempts: 3
  }
}

describe('production recollection action', () => {
  it('builds a one-record request with bounded campaign budget and tombstone lineage', () => {
    const request = buildProductionRecollectionRequest(
      'workspace:private',
      target,
      campaign,
      'a'.repeat(32),
      '2026-08-02T00:00:00.000Z'
    )

    expect(productionCollectionWorkflowStartRequestSchema.parse(request)).toMatchObject({
      workspaceId: 'workspace:private',
      campaignId: 'campaign:billing',
      sourceId: 'cfpb-consumer-complaints',
      limit: 1,
      recollectionTombstoneId: 'tombstone:source:record',
      budget: { maxSourceItems: 1 }
    })
    expect(JSON.stringify(request)).not.toContain('rawPayload')
  })
})
