import { describe, expect, it } from 'vitest'
import { productionCollectionWorkflowInputSchema } from '@appsea/contracts'
import { productionCollectionRequestFromActivityInput } from './production-workflow-activities'

describe('production collection activity request reconstruction', () => {
  it('forwards the staged owner-import batch through the Temporal boundary', () => {
    const input = productionCollectionWorkflowInputSchema.parse({
      workspaceId: 'workspace:manual-forwarding-test',
      campaignId: 'campaign:manual-forwarding-test',
      runId: 'run:manual-forwarding-test',
      idempotencyDigest: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
      workflowVersion: 'production-collection-v1',
      sourceId: 'manual-owner-import',
      policyVersion: 'manual-owner-import-v1',
      query: 'workflow problem',
      limit: 10,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt',
      budget: {
        currency: 'USD',
        maxSourceItems: 10,
        maxCostMicros: 0,
        maxActivityAttempts: 3
      },
      requestedAt: '2026-07-10T00:00:00.000Z',
      manualImportBatchId: 'batch:manual-forwarding-test'
    })

    expect(productionCollectionRequestFromActivityInput(input)).toMatchObject({
      idempotencyKey: 'a'.repeat(64),
      sourceId: 'manual-owner-import',
      manualImportBatchId: 'batch:manual-forwarding-test'
    })
  })
})
