import { describe, expect, it } from 'vitest'
import {
  modelGatewayRequestSchema,
  modelGatewayResultSchema,
  modelGatewaySnapshotSchema
} from './index'

const request = {
  workspaceId: 'workspace:one',
  requestId: 'model-request:one',
  idempotencyKey: 'model-analysis:one',
  task: 'complaint-analysis' as const,
  purpose: 'research-analysis' as const,
  routeVersion: 'complaint-analysis-route-v1',
  promptVersion: 'complaint-analysis-prompt-v1',
  modelVersion: 'deterministic-fallback-v1',
  outputSchemaVersion: 'complaint-analysis-suggestion-v1',
  segments: [
    { role: 'system' as const, content: 'fixed system' },
    { role: 'developer' as const, content: 'fixed developer' },
    { role: 'untrusted-data' as const, content: 'source text' }
  ],
  budget: { maxInputBytes: 100_000, maxOutputTokens: 512, maxCostMicros: 0 },
  sourcePolicy: {
    sourceId: 'manual-owner-import',
    policyVersion: 'manual-owner-import-v2',
    contentHash: 'a'.repeat(64)
  }
}

describe('model gateway contracts', () => {
  it('accepts trust-tagged requests and rejects raw prompt/log fields', () => {
    expect(modelGatewayRequestSchema.safeParse(request).success).toBe(true)
    expect(
      modelGatewayRequestSchema.safeParse({ ...request, prompt: 'unbounded raw prompt' }).success
    ).toBe(false)
    expect(
      modelGatewayRequestSchema.safeParse({
        ...request,
        segments: request.segments.map((segment) =>
          segment.role === 'untrusted-data' ? { ...segment, role: 'developer' as const } : segment
        )
      }).success
    ).toBe(false)
    expect(
      modelGatewayRequestSchema.safeParse({
        ...request,
        sourcePolicy: { ...request.sourcePolicy, modelUse: 'approved' }
      }).success
    ).toBe(false)
  })

  it('requires bounded hashes, fixed status, and non-authoritative suggestion shape', () => {
    const result = {
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      task: request.task,
      provider: 'deterministic-fallback' as const,
      status: 'fallback' as const,
      routeVersion: request.routeVersion,
      promptVersion: request.promptVersion,
      modelVersion: request.modelVersion,
      outputSchemaVersion: request.outputSchemaVersion,
      inputHash: 'b'.repeat(64),
      outputHash: 'c'.repeat(64),
      suggestion: {
        classification: 'complaint' as const,
        complaintType: 'workflow_gap' as const,
        severityHint: 3,
        recurrenceHint: 'repeated' as const,
        switchingIntentHint: 'unknown' as const,
        paymentSignalHint: 'unknown' as const,
        confidence: 0.7
      },
      safetyFindings: ['provider-not-approved' as const],
      inputTokensEstimate: 100,
      outputTokensEstimate: 20,
      costMicros: 0,
      completedAt: '2026-08-06T10:00:00.000Z'
    }
    expect(modelGatewayResultSchema.safeParse(result).success).toBe(true)
    expect(modelGatewayResultSchema.safeParse({ ...result, rawOutput: 'secret' }).success).toBe(
      false
    )
  })

  it('does not allow an unbounded gateway snapshot', () => {
    const snapshot = {
      version: 'model-gateway-v1' as const,
      provider: 'deterministic-fallback' as const,
      routeVersion: 'complaint-analysis-route-v1',
      promptVersion: 'complaint-analysis-prompt-v1',
      modelVersion: 'deterministic-fallback-v1',
      outputSchemaVersion: 'complaint-analysis-suggestion-v1',
      policyState: 'external-not-approved' as const,
      requestCount: 1,
      completedCount: 0,
      fallbackCount: 1,
      refusedCount: 0,
      safetyFindingCounts: [{ finding: 'provider-not-approved' as const, count: 1 }],
      inputTokensEstimate: 100,
      outputTokensEstimate: 20,
      costMicros: 0,
      inputHash: 'd'.repeat(64),
      capturedAt: '2026-08-06T10:00:00.000Z'
    }
    expect(modelGatewaySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(
      modelGatewaySnapshotSchema.safeParse({ ...snapshot, rawPrompt: 'not permitted' }).success
    ).toBe(false)
  })
})
