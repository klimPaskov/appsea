import { z } from 'zod'
import taskGraphJsonSchema from '../../../schemas/task_graph.schema.json' with { type: 'json' }

const fixturePurposes = new Set(['development', 'testing', 'demonstration'])
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function hasUnsupportedPostgresText(value: string): boolean {
  if (value.includes('\0')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function isPortablePlanPath(value: string): boolean {
  const containsControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    containsControlCharacter
  ) {
    return false
  }
  return value
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !/[. ]$/.test(segment) &&
        !windowsDeviceName.test(segment)
    )
}

export const opportunitySlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const taskGraphSchema = z.fromJSONSchema(
  taskGraphJsonSchema as unknown as Parameters<typeof z.fromJSONSchema>[0]
)

export const sourceQuotaSchema = z
  .object({
    requestsPerMinute: z.number().int().positive().max(10_000),
    maxRecordsPerRequest: z.number().int().positive().max(5_000),
    maxRecordsPerRun: z.number().int().positive().max(50_000),
    costPerRequestMicros: z.number().int().nonnegative().max(1_000_000_000_000)
  })
  .strict()

export const sourceDeletionPolicySchema = z
  .object({
    sourceRecordIdField: z.string().min(1).max(120),
    supportsTombstones: z.boolean(),
    deletionPollIntervalHours: z.number().int().nonnegative().max(8_760),
    retentionAction: z.enum(['tombstone', 'redact', 'purge'])
  })
  .strict()

export const sourcePolicyStateSchema = z.enum(['approved', 'pending_review', 'expired', 'revoked'])

const policyDocumentRefSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'Policy document references must use HTTP(S)')

const canonicalLocatorSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Canonical source locators must use HTTP(S)')

export const sourcePolicySchema = z.object({
  sourceId: z.string().min(1),
  displayName: z.string().min(1),
  sourceType: z.enum(['fixture', 'api', 'export', 'licensed-feed', 'manual']),
  enabled: z.boolean(),
  // A policy is unapproved until a reviewed source record explicitly says
  // otherwise. Connectors must never become collectible by omission.
  policyState: sourcePolicyStateSchema.default('pending_review'),
  permittedPurposes: z.array(z.string().min(1)).min(1),
  commercialUse: z.enum(['allowed', 'restricted', 'unknown']),
  accessMethod: z.string().min(1),
  retentionDays: z.number().int().nonnegative(),
  deletionRequired: z.boolean(),
  attributionRequired: z.boolean(),
  displayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
  coverageNotes: z.array(z.string()),
  reviewedAt: z.string().datetime(),
  policyOwner: z.string().min(1).max(160).default('unassigned'),
  policyDocumentRef: policyDocumentRefSchema.nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  quota: sourceQuotaSchema.default({
    requestsPerMinute: 60,
    maxRecordsPerRequest: 5_000,
    maxRecordsPerRun: 50_000,
    costPerRequestMicros: 0
  }),
  deletion: sourceDeletionPolicySchema.default({
    sourceRecordIdField: 'source_record_id',
    supportsTombstones: false,
    deletionPollIntervalHours: 24,
    retentionAction: 'tombstone'
  })
})

export const sourceDeletionEventSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceRecordId: z.string().min(1).max(240),
    observedAt: z.string().datetime(),
    reason: z.string().min(1).max(240)
  })
  .strict()

export const complaintSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  /** Stable source URL used for attribution and operator inspection. */
  canonicalLocator: canonicalLocatorSchema.nullable().default(null),
  capturedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  query: z.string().min(1),
  product: z.string().min(1),
  company: z.string().min(1),
  feature: z.string().min(1),
  category: z.string().min(1),
  text: z.string().min(1),
  language: z.string().min(2),
  synthetic: z.boolean(),
  redacted: z.boolean(),
  allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
  /** Fields removed from the current display projection after collection. */
  redactedFields: z
    .array(z.enum(['text', 'product', 'company', 'feature', 'category', 'canonicalLocator']))
    .max(6)
    .optional()
})

export const evidenceRedactionFieldSchema = z.enum([
  'text',
  'product',
  'company',
  'feature',
  'category',
  'canonicalLocator'
])

export const evidenceRedactionReasonSchema = z.enum([
  'pii',
  'legal_request',
  'policy_minimization',
  'operator_correction'
])

export const complaintReviewStateSchema = z.enum([
  'unreviewed',
  'confirmed',
  'corrected',
  'rejected'
])

export const complaintClassificationSchema = z.enum([
  'complaint',
  'feature_request',
  'question',
  'praise',
  'support_response',
  'joke',
  'spam',
  'unrelated'
])

export const complaintTypeSchema = z.enum([
  'missing_capability',
  'broken_behavior',
  'usability',
  'performance',
  'reliability',
  'integration',
  'pricing',
  'privacy',
  'security',
  'support',
  'accessibility',
  'platform_restriction',
  'workflow_gap',
  'other'
])

export const complaintEntityReferenceSchema = z
  .object({
    entityType: z.enum(['product', 'company', 'feature', 'substitute', 'competitor']),
    surfaceText: z.string().min(1).max(240),
    canonicalName: z.string().min(1).max(240).nullable(),
    confidence: z.number().min(0).max(1),
    resolution: z.enum(['exact', 'normalized', 'contextual', 'ambiguous', 'unresolved']),
    evidence: z.enum(['source-field', 'source-context', 'reviewed-seed', 'not-inferred'])
  })
  .strict()

export const complaintEntityResolutionSchema = z
  .object({
    product: complaintEntityReferenceSchema,
    company: complaintEntityReferenceSchema,
    feature: complaintEntityReferenceSchema,
    substitutes: z.array(complaintEntityReferenceSchema).max(50),
    competitors: z.array(complaintEntityReferenceSchema).max(50),
    unresolvedTypes: z
      .array(z.enum(['product', 'company', 'feature', 'substitute', 'competitor']))
      .max(5)
  })
  .strict()

/**
 * A derived observation is intentionally separate from the source complaint.
 * It records deterministic extraction, entity confidence, and unresolved
 * market dimensions without turning a missing lookup into negative evidence.
 */
export const complaintAnalysisSchema = z
  .object({
    complaintId: z.string().min(1),
    classification: complaintClassificationSchema,
    complaintType: complaintTypeSchema,
    problemStatement: z.string().min(1).max(20_000),
    expectedOutcome: z.string().min(1).max(2_000).nullable(),
    observedOutcome: z.string().min(1).max(20_000),
    consequence: z.string().min(1).max(2_000).nullable(),
    affectedWorkflow: z.string().min(1).max(2_000),
    workaround: z.string().min(1).max(2_000).nullable(),
    featureMentions: z.array(z.string().min(1).max(240)).max(50),
    userSegmentHints: z.array(z.string().min(1).max(240)).max(50),
    severity: z.number().int().min(0).max(5),
    recurrence: z.enum(['none', 'occasional', 'repeated', 'persistent', 'unknown']),
    switchingIntent: z.enum(['none', 'possible', 'explicit', 'unknown']),
    paymentSignal: z.enum(['none', 'weak', 'explicit', 'unknown']),
    actionabilityProbability: z.number().min(0).max(1),
    classificationConfidence: z.number().min(0).max(1),
    entityConfidence: z.number().min(0).max(1),
    manipulationRisk: z.number().min(0).max(1),
    piiFlags: z.array(z.string().min(1).max(120)).max(50),
    policyFlags: z.array(z.string().min(1).max(160)).max(50),
    reviewState: complaintReviewStateSchema,
    extractionVersion: z.string().min(1).max(80),
    derivation: z
      .object({
        skillVersion: z.string().min(1).max(80),
        modelVersion: z.string().min(1).max(80),
        promptVersion: z.string().min(1).max(80)
      })
      .strict(),
    entities: complaintEntityResolutionSchema
  })
  .strict()

/**
 * Human edits may change only the derived complaint interpretation. Source
 * evidence, provenance, policy flags, and derivation metadata remain owned by
 * the collection/analysis pipeline. The complete snapshot is rebuilt and
 * validated at the repository boundary before it is persisted.
 */
export const complaintAnalysisCorrectionSchema = z
  .object({
    classification: complaintClassificationSchema.optional(),
    complaintType: complaintTypeSchema.optional(),
    problemStatement: z.string().min(1).max(20_000).optional(),
    expectedOutcome: z.string().min(1).max(2_000).nullable().optional(),
    observedOutcome: z.string().min(1).max(20_000).optional(),
    consequence: z.string().min(1).max(2_000).nullable().optional(),
    affectedWorkflow: z.string().min(1).max(2_000).optional(),
    workaround: z.string().min(1).max(2_000).nullable().optional(),
    featureMentions: z.array(z.string().min(1).max(240)).max(50).optional(),
    userSegmentHints: z.array(z.string().min(1).max(240)).max(50).optional(),
    severity: z.number().int().min(0).max(5).optional(),
    recurrence: z.enum(['none', 'occasional', 'repeated', 'persistent', 'unknown']).optional(),
    switchingIntent: z.enum(['none', 'possible', 'explicit', 'unknown']).optional(),
    paymentSignal: z.enum(['none', 'weak', 'explicit', 'unknown']).optional(),
    actionabilityProbability: z.number().min(0).max(1).optional(),
    classificationConfidence: z.number().min(0).max(1).optional(),
    entityConfidence: z.number().min(0).max(1).optional(),
    manipulationRisk: z.number().min(0).max(1).optional(),
    piiFlags: z.array(z.string().min(1).max(120)).max(50).optional(),
    entities: complaintEntityResolutionSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one derived analysis field must be corrected'
  })

export const complaintClusterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  product: z.string().min(1),
  category: z.string().min(1),
  summary: z.string().min(1),
  complaintIds: z.array(z.string().min(1)).min(1),
  uniqueObservationCount: z.number().int().positive(),
  sourceCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1)
})

const competitorFeatureMatrixObservationIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_:-]*$/)

export const competitorFeatureMatrixStatusSchema = z.enum([
  'supported',
  'partial',
  'missing',
  'unknown'
])

export const competitorFeatureMatrixEvidenceBasisSchema = z.enum([
  'fixture',
  'reviewed-seed',
  'source-observation',
  'mixed'
])

/**
 * A bounded comparison claim. Seed and fixture entries are assumptions or
 * examples; source-backed entries must point at retained competitive
 * observations rather than carrying raw provider content.
 */
export const competitorFeatureMatrixEntrySchema = z
  .object({
    feature: z.string().min(1).max(240),
    status: competitorFeatureMatrixStatusSchema,
    evidenceBasis: competitorFeatureMatrixEvidenceBasisSchema,
    observationIds: z.array(competitorFeatureMatrixObservationIdSchema).max(50).default([]),
    notes: z.string().min(1).max(2_000).nullable().default(null)
  })
  .strict()
  .superRefine((entry, context) => {
    const requiresObservation =
      entry.evidenceBasis === 'source-observation' || entry.evidenceBasis === 'mixed'
    if (requiresObservation && entry.observationIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['observationIds'],
        message: 'Source-backed feature coverage requires an observation identifier'
      })
    }
    if (
      (entry.evidenceBasis === 'fixture' || entry.evidenceBasis === 'reviewed-seed') &&
      entry.observationIds.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationIds'],
        message: 'Fixture and reviewed-seed coverage cannot claim source observations'
      })
    }
  })

export const competitorFeatureMatrixSchema = z
  .array(competitorFeatureMatrixEntrySchema)
  .max(200)
  .superRefine((entries, context) => {
    const seen = new Map<string, number>()
    entries.forEach((entry, index) => {
      const key = entry.feature.trim().toLocaleLowerCase('en-US')
      const previous = seen.get(key)
      if (previous !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [index, 'feature'],
          message: `Feature duplicates entry ${previous + 1}`
        })
      } else {
        seen.set(key, index)
      }
    })
  })

export const competitorSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['direct', 'adjacent', 'platform', 'workaround', 'do-nothing']),
  positioning: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  relatedComplaintCategories: z.array(z.string()),
  featureMatrix: competitorFeatureMatrixSchema.default([])
})

export const appseaIdentifierSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_:-]*$/)

export const scoreFactorsSchema = z.object({
  complaintVolume: z.number().min(0).max(100),
  painSeverity: z.number().min(0).max(100),
  recurrence: z.number().min(0).max(100),
  willingnessToPay: z.number().min(0).max(100),
  competitiveGap: z.number().min(0).max(100),
  buildFeasibility: z.number().min(0).max(100),
  evidenceQuality: z.number().min(0).max(100),
  contraryEvidencePenalty: z.number().min(0).max(100)
})

const scoreSnapshotLegacySchema = z
  .object({
    score: z.number().min(0).max(100),
    version: z.string().min(1),
    calculatedAt: z.string().datetime(),
    factors: scoreFactorsSchema,
    weights: scoreFactorsSchema
  })
  .strict()

const scoreSignalSchema = z.number().min(0).max(100)
const confidenceSignalSchema = z.number().min(0).max(1)

/** Reviewed inputs for the balanced v1 opportunity score. Values are supplied
 * by a reviewed seed; the scorer never derives market claims from complaint
 * text. Each signal is normalized to 0..100 before its fixed spec weight is
 * applied. */
export const balancedScoreInputSchema = z
  .object({
    profile: z.literal('balanced'),
    demand: z
      .object({
        complaintFrequency: scoreSignalSchema,
        independentUserCount: scoreSignalSchema,
        sourceDiversity: scoreSignalSchema,
        recentVelocity: scoreSignalSchema,
        timePersistence: scoreSignalSchema,
        segmentDensity: scoreSignalSchema
      })
      .strict(),
    pain: z
      .object({
        severity: scoreSignalSchema,
        workflowCriticality: scoreSignalSchema,
        workaroundCost: scoreSignalSchema,
        switchingIntent: scoreSignalSchema
      })
      .strict(),
    marketOpening: z
      .object({
        competitorDissatisfaction: scoreSignalSchema,
        unresolvedSolutionGap: scoreSignalSchema,
        substituteWeakness: scoreSignalSchema,
        timing: scoreSignalSchema
      })
      .strict(),
    businessQuality: z
      .object({
        willingnessToPay: scoreSignalSchema,
        repeatUseRetention: scoreSignalSchema,
        audienceReachability: scoreSignalSchema,
        expansionPotential: scoreSignalSchema
      })
      .strict(),
    executionQuality: z
      .object({
        mvpFeasibility: scoreSignalSchema,
        dataIntegrationFeasibility: scoreSignalSchema,
        trustComplianceFeasibility: scoreSignalSchema,
        platformIndependence: scoreSignalSchema
      })
      .strict(),
    riskPenalties: z
      .object({
        sourceLegal: z.number().min(0).max(10),
        platformConcentration: z.number().min(0).max(7),
        commoditization: z.number().min(0).max(5),
        regulatoryTrust: z.number().min(0).max(5),
        manipulation: z.number().min(0).max(4),
        eventDriven: z.number().min(0).max(4)
      })
      .strict(),
    confidenceComponents: z
      .object({
        sample: confidenceSignalSchema,
        sourceDiversity: confidenceSignalSchema,
        directness: confidenceSignalSchema,
        entityConfidence: confidenceSignalSchema,
        timeStability: confidenceSignalSchema,
        manipulationSpam: confidenceSignalSchema,
        methodAgreementHumanReview: confidenceSignalSchema
      })
      .strict(),
    evidenceSnapshotId: appseaIdentifierSchema,
    coverageSummary: z
      .object({
        sourceCount: z.number().int().nonnegative().max(10_000),
        observationCount: z.number().int().nonnegative().max(1_000_000),
        independentUserCount: z.number().int().nonnegative().max(1_000_000),
        gapCount: z.number().int().nonnegative().max(10_000),
        summary: z.string().min(1).max(1_000)
      })
      .strict(),
    freshnessSummary: z
      .object({
        oldestObservationAt: z.string().datetime().nullable(),
        newestObservationAt: z.string().datetime().nullable(),
        asOf: z.string().datetime(),
        ageDays: z.number().nonnegative().max(36_500),
        summary: z.string().min(1).max(1_000)
      })
      .strict()
  })
  .strict()

export const scoreComponentExplanationSchema = z
  .object({
    key: z.string().min(1).max(120),
    value: z.number().min(0).max(100),
    weight: z.number().positive().max(100),
    contribution: z.number().min(-100).max(100),
    evidenceIds: z.array(appseaIdentifierSchema).max(100),
    transformation: z.string().min(1).max(240),
    confidence: confidenceSignalSchema,
    changeReason: z.string().min(1).max(500)
  })
  .strict()

const scoreWeightSchema = z.number().positive().max(100)
const scoreWeightDimensionSchema = z
  .object({
    demand: z
      .object({
        complaintFrequency: scoreWeightSchema,
        independentUserCount: scoreWeightSchema,
        sourceDiversity: scoreWeightSchema,
        recentVelocity: scoreWeightSchema,
        timePersistence: scoreWeightSchema,
        segmentDensity: scoreWeightSchema
      })
      .strict(),
    pain: z
      .object({
        severity: scoreWeightSchema,
        workflowCriticality: scoreWeightSchema,
        workaroundCost: scoreWeightSchema,
        switchingIntent: scoreWeightSchema
      })
      .strict(),
    marketOpening: z
      .object({
        competitorDissatisfaction: scoreWeightSchema,
        unresolvedSolutionGap: scoreWeightSchema,
        substituteWeakness: scoreWeightSchema,
        timing: scoreWeightSchema
      })
      .strict(),
    businessQuality: z
      .object({
        willingnessToPay: scoreWeightSchema,
        repeatUseRetention: scoreWeightSchema,
        audienceReachability: scoreWeightSchema,
        expansionPotential: scoreWeightSchema
      })
      .strict(),
    executionQuality: z
      .object({
        mvpFeasibility: scoreWeightSchema,
        dataIntegrationFeasibility: scoreWeightSchema,
        trustComplianceFeasibility: scoreWeightSchema,
        platformIndependence: scoreWeightSchema
      })
      .strict(),
    riskPenalties: z
      .object({
        sourceLegal: scoreWeightSchema,
        platformConcentration: scoreWeightSchema,
        commoditization: scoreWeightSchema,
        regulatoryTrust: scoreWeightSchema,
        manipulation: scoreWeightSchema,
        eventDriven: scoreWeightSchema
      })
      .strict()
  })
  .strict()

export const scoreSnapshotV1Schema = z
  .object({
    score: z.number().min(0).max(100),
    rawScore: z.number().min(0).max(100),
    riskPenalty: z.number().min(0).max(35),
    riskAdjustedScore: z.number().min(0).max(100),
    evidenceConfidence: confidenceSignalSchema,
    uncertaintyMargin: z.number().min(0).max(20),
    rankingScore: z.number().min(0).max(100),
    version: z.literal('opportunity-score-v1.0.0'),
    modelVersion: z.string().min(1).max(120),
    scoringProfile: z.literal('balanced'),
    calculatedAt: z.string().datetime(),
    evidenceSnapshotId: appseaIdentifierSchema,
    coverageSummary: balancedScoreInputSchema.shape.coverageSummary,
    freshnessSummary: balancedScoreInputSchema.shape.freshnessSummary,
    factors: scoreFactorsSchema,
    weights: scoreFactorsSchema,
    positiveFactors: z
      .object({
        demand: balancedScoreInputSchema.shape.demand,
        pain: balancedScoreInputSchema.shape.pain,
        marketOpening: balancedScoreInputSchema.shape.marketOpening,
        businessQuality: balancedScoreInputSchema.shape.businessQuality,
        executionQuality: balancedScoreInputSchema.shape.executionQuality
      })
      .strict(),
    scoringWeights: scoreWeightDimensionSchema,
    riskPenalties: balancedScoreInputSchema.shape.riskPenalties,
    confidenceComponents: balancedScoreInputSchema.shape.confidenceComponents,
    componentExplanations: z.array(scoreComponentExplanationSchema).min(1).max(64)
  })
  .strict()

export const scoreSnapshotSchema = z.union([scoreSnapshotV1Schema, scoreSnapshotLegacySchema])

export const opportunitySchema = z.object({
  id: z.string().min(1),
  slug: opportunitySlugSchema,
  name: z.string().min(1),
  oneLine: z.string().min(1),
  thesis: z.string().min(1),
  audience: z.string().min(1),
  firstWedge: z.string().min(1),
  complaintCount: z.number().int().nonnegative(),
  synthetic: z.boolean(),
  tags: z.array(z.string()).max(100),
  complaintIds: z.array(z.string()).max(5_000),
  competitors: z.array(competitorSchema).max(500),
  scoreSnapshot: scoreSnapshotSchema,
  contraryEvidence: z.array(z.string()),
  planFiles: z.array(z.string())
})

export const manualImportFormatSchema = z.enum(['csv', 'json'])

/** One normalized, privacy-scrubbed row staged for an owner-authorized import. */
export const manualImportRecordSchema = z
  .object({
    sourceRecordId: z.string().min(1).max(200),
    canonicalLocator: canonicalLocatorSchema.nullable(),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    query: z.string().max(500),
    product: z.string().min(1).max(240),
    company: z.string().min(1).max(240),
    feature: z.string().min(1).max(240),
    category: z.string().min(1).max(240),
    text: z.string().min(1).max(20_000),
    language: z.string().min(2).max(16)
  })
  .strict()

export const manualImportBatchStateSchema = z.enum(['staged', 'consumed', 'deleted', 'failed'])

/** Persisted metadata for a tenant-private import; raw upload bytes are not retained here. */
export const manualImportBatchCreateInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    batchId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    sourceId: z.literal('manual-owner-import'),
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    purpose: z.string().min(1).max(120),
    requestedDisplayMode: z.literal('excerpt'),
    idempotencyDigest: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    format: manualImportFormatSchema,
    filename: z.string().trim().min(1).max(240),
    records: z.array(manualImportRecordSchema).min(1).max(5_000),
    warnings: z.array(z.string().min(1).max(500)).max(500),
    authorizationAttested: z.literal(true),
    attestedBy: appseaIdentifierSchema,
    attestedAt: z.string().datetime(),
    createdAt: z.string().datetime()
  })
  .strict()

export const manualImportBatchReadModelSchema = z
  .object({
    batchId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    sourceId: z.literal('manual-owner-import'),
    policyVersion: z.string().min(1).max(80),
    format: manualImportFormatSchema,
    filename: z.string().min(1).max(240),
    recordCount: z.number().int().nonnegative().max(5_000),
    warningCount: z.number().int().nonnegative().max(500),
    state: manualImportBatchStateSchema,
    contentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    runId: appseaIdentifierSchema.nullable(),
    createdAt: z.string().datetime(),
    consumedAt: z.string().datetime().nullable(),
    deletedAt: z.string().datetime().nullable()
  })
  .strict()

export const manualImportDeletionResultSchema = z
  .object({
    batchId: appseaIdentifierSchema,
    state: z.literal('deleted'),
    tombstoneCount: z.number().int().nonnegative().max(5_000),
    replayed: z.boolean()
  })
  .strict()

export const evidenceRedactionInputSchema = z
  .object({
    redactionId: appseaIdentifierSchema,
    fields: z.array(evidenceRedactionFieldSchema).min(1).max(6),
    reason: evidenceRedactionReasonSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.fields).size !== value.fields.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Redaction fields must be unique'
      })
    }
  })

export const evidenceRedactionResultSchema = z
  .object({
    redactionId: appseaIdentifierSchema,
    evidenceId: appseaIdentifierSchema,
    fields: z.array(evidenceRedactionFieldSchema).min(1).max(6),
    reason: evidenceRedactionReasonSchema,
    redactedAt: z.string().datetime(),
    replayed: z.boolean()
  })
  .strict()

export const workspaceEvidenceRedactionInputSchema = z
  .object({
    evidenceId: appseaIdentifierSchema,
    redactionId: appseaIdentifierSchema,
    fields: z.array(evidenceRedactionFieldSchema).min(1).max(6),
    reason: evidenceRedactionReasonSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.fields).size !== value.fields.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Redaction fields must be unique'
      })
    }
  })

/** Safe private source-registry metadata; policy payloads and review identities stay out. */
export const workspaceSourceReadModelSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    displayName: z.string().min(1).max(160),
    sourceType: z.enum(['fixture', 'api', 'export', 'licensed-feed', 'manual']),
    lifecycleState: z.enum([
      'active',
      'disabled_pending_review',
      'disabled_policy',
      'disabled_operator',
      'retired'
    ]),
    currentPolicyVersion: z.string().min(1).max(80).nullable(),
    policyVersion: z.string().min(1).max(80).nullable(),
    policyState: sourcePolicyStateSchema.nullable(),
    permittedPurposes: z.array(z.string().min(1).max(120)).max(100),
    commercialUse: z.enum(['allowed', 'restricted', 'unknown']).nullable(),
    accessMethod: z.string().min(1).max(500).nullable(),
    retentionDays: z.number().int().nonnegative().max(36_500).nullable(),
    deletionRequired: z.boolean().nullable(),
    attributionRequired: z.boolean().nullable(),
    displayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']).nullable(),
    coverageNotes: z.array(z.string().max(500)).max(100),
    policyDocumentRef: policyDocumentRefSchema.nullable(),
    reviewedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    quota: sourceQuotaSchema.nullable(),
    deletion: sourceDeletionPolicySchema.nullable(),
    enabled: z.boolean(),
    synthetic: z.boolean(),
    collectible: z.boolean()
  })
  .strict()

export const sourcePolicyReviewerRoleSchema = z.enum([
  'legal',
  'privacy',
  'security',
  'independent_operator'
])

const sourcePolicyReviewerIdentitySchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:@/+~-]*$/)
  .refine((value) => value === value.toLowerCase(), 'Reviewer identity must be lowercase')

export const sourcePolicyApprovalInputSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    reviewId: appseaIdentifierSchema,
    reviewer: z.string().min(1).max(160),
    reviewerIdentity: sourcePolicyReviewerIdentitySchema,
    reviewerRole: sourcePolicyReviewerRoleSchema,
    independenceAttested: z.literal(true),
    approvalReference: z.string().min(1).max(500),
    notes: z.array(z.string().min(1).max(500)).max(100),
    contentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    reviewedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    recordedAt: z.string().datetime()
  })
  .strict()

export const workflowActorSchema = z.discriminatedUnion('actorType', [
  z
    .object({
      actorType: z.literal('user'),
      actorId: appseaIdentifierSchema
    })
    .strict(),
  z
    .object({
      actorType: z.literal('service'),
      actorId: z.literal('appsea-worker')
    })
    .strict()
])

export const productionAnalysisTransportSchema = z.enum(['offline-sample', 'persisted-collection'])

const contentHashSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/)

const qualityVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/)

const qualityMetricSampleSchema = z
  .object({
    sampleSize: z.number().int().nonnegative().max(1_000_000),
    value: z.number().min(0).max(1)
  })
  .strict()

const researchQualityExpectedEntitySchema = z
  .object({
    product: z.string().min(1).max(240).nullable(),
    company: z.string().min(1).max(240).nullable(),
    feature: z.string().min(1).max(240).nullable()
  })
  .strict()

/** A reviewed label for one synthetic, redacted observation. The text is
 * deliberately fixture-only and cannot be interpreted as source evidence. */
export const researchQualityBenchmarkCaseSchema = z
  .object({
    id: appseaIdentifierSchema,
    complaint: complaintSchema,
    expected: z
      .object({
        classification: complaintClassificationSchema,
        complaintType: complaintTypeSchema,
        entities: researchQualityExpectedEntitySchema,
        duplicateGroupId: appseaIdentifierSchema,
        clusterGroupId: appseaIdentifierSchema,
        actionable: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((entry, context) => {
    if (!entry.complaint.synthetic) {
      context.addIssue({
        code: 'custom',
        path: ['complaint', 'synthetic'],
        message: 'Quality benchmark complaints must be synthetic'
      })
    }
    if (!entry.complaint.redacted) {
      context.addIssue({
        code: 'custom',
        path: ['complaint', 'redacted'],
        message: 'Quality benchmark complaints must be redacted'
      })
    }
    if (entry.complaint.allowedRepresentation !== 'fixture') {
      context.addIssue({
        code: 'custom',
        path: ['complaint', 'allowedRepresentation'],
        message: 'Quality benchmark complaints must use fixture representation'
      })
    }
    if (entry.complaint.id !== entry.id) {
      context.addIssue({
        code: 'custom',
        path: ['complaint', 'id'],
        message: 'Benchmark case and complaint identifiers must match'
      })
    }
  })

export const researchQualityRankingCaseSchema = z
  .object({
    candidateId: appseaIdentifierSchema,
    reviewedScore: z.number().min(0).max(100),
    accepted: z.boolean()
  })
  .strict()

export const researchQualityBenchmarkSchema = z
  .object({
    version: qualityVersionSchema,
    cases: z.array(researchQualityBenchmarkCaseSchema).min(1).max(1_000),
    rankingCases: z.array(researchQualityRankingCaseSchema).max(1_000).default([]),
    evidenceSnapshotId: appseaIdentifierSchema.nullable().default(null),
    reviewedInputOnly: z.literal(true).default(true),
    notes: z.array(z.string().min(1).max(500)).max(50).default([])
  })
  .strict()
  .superRefine((benchmark, context) => {
    const caseIds = benchmark.cases.map((entry) => entry.id)
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'Quality benchmark case identifiers must be unique'
      })
    }
    const rankingIds = benchmark.rankingCases.map((entry) => entry.candidateId)
    if (new Set(rankingIds).size !== rankingIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['rankingCases'],
        message: 'Quality ranking candidate identifiers must be unique'
      })
    }
    if (benchmark.evidenceSnapshotId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceSnapshotId'],
        message: 'The synthetic quality benchmark cannot bind to source evidence'
      })
    }
  })

export const researchQualitySnapshotSchema = z
  .object({
    schemaVersion: z.literal('research-quality-v1.0.0'),
    benchmarkVersion: qualityVersionSchema,
    evaluatorVersion: qualityVersionSchema,
    generatedAt: z.string().datetime(),
    benchmarkHash: contentHashSchema,
    contentHash: contentHashSchema,
    synthetic: z.literal(true),
    reviewedInputOnly: z.literal(true),
    evidenceSnapshotId: appseaIdentifierSchema.nullable(),
    factorProvenance: z.literal('reviewed-input-only'),
    metrics: z
      .object({
        classifier: z
          .object({
            accuracy: qualityMetricSampleSchema,
            complaintTypeAccuracy: qualityMetricSampleSchema,
            macroF1: qualityMetricSampleSchema,
            actionabilityPrecision: qualityMetricSampleSchema,
            calibrationError: qualityMetricSampleSchema
          })
          .strict(),
        entity: z
          .object({
            top1Accuracy: qualityMetricSampleSchema,
            topKRecall: qualityMetricSampleSchema,
            abstentionRate: qualityMetricSampleSchema,
            highImpactWrongLinkRate: qualityMetricSampleSchema
          })
          .strict(),
        deduplication: z
          .object({
            pairPrecision: qualityMetricSampleSchema,
            pairRecall: qualityMetricSampleSchema,
            f1: qualityMetricSampleSchema
          })
          .strict(),
        clustering: z
          .object({
            pairPrecision: qualityMetricSampleSchema,
            pairRecall: qualityMetricSampleSchema,
            f1: qualityMetricSampleSchema,
            purity: qualityMetricSampleSchema
          })
          .strict(),
        stability: z
          .object({
            duplicateInjection: qualityMetricSampleSchema,
            sourceAblation: qualityMetricSampleSchema
          })
          .strict(),
        ranking: z
          .object({
            topKPrecision: qualityMetricSampleSchema,
            topKRecall: qualityMetricSampleSchema,
            rankCorrelation: qualityMetricSampleSchema
          })
          .strict(),
        calibration: z
          .object({
            expectedCalibrationError: qualityMetricSampleSchema,
            brierScore: qualityMetricSampleSchema
          })
          .strict()
      })
      .strict(),
    warnings: z.array(z.string().min(1).max(1_000)).max(100),
    provenance: z
      .object({
        mode: z.literal('synthetic-redacted-benchmark'),
        sourceCoverage: z.literal('not-derived'),
        factorInputs: z.literal('reviewed-input-only'),
        note: z.string().min(1).max(1_000)
      })
      .strict()
  })
  .strict()

export const competitiveResearchStatusSchema = z.enum([
  'unresolved',
  'reviewed-seed-only',
  'source-backed'
])

export const competitiveResearchSeedReadModelSchema = z
  .object({
    reviewId: appseaIdentifierSchema,
    seedVersion: z.string().min(1).max(80),
    contentHash: contentHashSchema,
    reviewedBy: z.string().min(1).max(160),
    reviewedAt: z.string().datetime()
  })
  .strict()

export const competitiveResearchObservationClaimTypeSchema = z.enum([
  'positioning',
  'feature',
  'pricing',
  'weakness',
  'contrary_signal',
  'availability',
  'recent_change'
])

export const competitiveResearchObservationReviewStateSchema = z.enum([
  'unreviewed',
  'confirmed',
  'rejected'
])

const competitiveResearchObservationClaimSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !hasUnsupportedPostgresText(value), 'Observation claim contains invalid text')

/**
 * A bounded, provenance-only competitive claim. The source and evidence IDs
 * must already exist in the workspace; this contract never accepts raw source
 * payloads or caller-supplied source policy metadata.
 */
export const competitiveResearchObservationSchema = z
  .object({
    observationId: appseaIdentifierSchema,
    opportunityId: appseaIdentifierSchema,
    competitorId: appseaIdentifierSchema,
    sourceId: appseaIdentifierSchema,
    sourceRecordId: z.string().min(1).max(240),
    sourceItemId: appseaIdentifierSchema,
    evidenceId: appseaIdentifierSchema.nullable(),
    claimType: competitiveResearchObservationClaimTypeSchema,
    claim: competitiveResearchObservationClaimSchema,
    observedAt: z.string().datetime(),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    confidence: z.number().min(0).max(1),
    reviewState: competitiveResearchObservationReviewStateSchema,
    synthetic: z.boolean(),
    allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
    canonicalLocator: canonicalLocatorSchema.nullable(),
    createdBy: appseaIdentifierSchema,
    reviewedBy: appseaIdentifierSchema.nullable(),
    reviewedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()

export const competitiveResearchObservationCreateInputSchema = z
  .object({
    observationId: appseaIdentifierSchema,
    competitorId: appseaIdentifierSchema,
    sourceItemId: appseaIdentifierSchema,
    evidenceId: appseaIdentifierSchema.nullable().default(null),
    claimType: competitiveResearchObservationClaimTypeSchema,
    claim: competitiveResearchObservationClaimSchema,
    observedAt: z.string().datetime(),
    confidence: z.number().min(0).max(1)
  })
  .strict()

export const competitiveResearchObservationReviewInputSchema = z
  .object({
    action: z.enum(['confirmed', 'rejected'])
  })
  .strict()

/**
 * Competitive records are useful only when their research state is visible.
 * A reviewed seed is an auditable human assumption, not source-backed market
 * research. Source-backed status requires a confirmed non-synthetic
 * observation plus permitted source and retained evidence identifiers.
 */
export const competitiveResearchReadModelSchema = z
  .object({
    status: competitiveResearchStatusSchema,
    observedAt: z.string().datetime().nullable(),
    sourceIds: z.array(appseaIdentifierSchema).max(100),
    evidenceIds: z.array(appseaIdentifierSchema).max(500),
    observations: z.array(competitiveResearchObservationSchema).max(500).default([]),
    coverageGaps: z.array(z.string().min(1).max(500)).max(100),
    seedReview: competitiveResearchSeedReadModelSchema.nullable(),
    synthetic: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.synthetic && value.status !== 'unresolved') {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Synthetic competitive records must remain unresolved'
      })
    }
    if (value.synthetic && value.observations.some((observation) => !observation.synthetic)) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Synthetic competitive records cannot contain non-synthetic observations'
      })
    }
    if (value.status === 'source-backed') {
      if (value.synthetic) {
        context.addIssue({
          code: 'custom',
          path: ['synthetic'],
          message: 'Synthetic competitive records cannot be source-backed'
        })
      }
      if (value.sourceIds.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['sourceIds'],
          message: 'Source-backed competitive research requires source identifiers'
        })
      }
      if (value.evidenceIds.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceIds'],
          message: 'Source-backed competitive research requires evidence identifiers'
        })
      }
      if (value.observedAt === null) {
        context.addIssue({
          code: 'custom',
          path: ['observedAt'],
          message: 'Source-backed competitive research requires an observation time'
        })
      }
      if (
        !value.observations.some(
          (observation) => !observation.synthetic && observation.reviewState === 'confirmed'
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations'],
          message: 'Source-backed competitive research requires a confirmed observation'
        })
      }
    }
    if (value.status === 'reviewed-seed-only' && value.seedReview === null) {
      context.addIssue({
        code: 'custom',
        path: ['seedReview'],
        message: 'Reviewed seed-only research requires seed review provenance'
      })
    }
  })

export function composeCompetitiveResearchReadModel(input: {
  synthetic: boolean
  coverageGaps: string[]
  seedReview?: {
    reviewId: string
    seedVersion: string
    contentHash: string
    reviewedBy: string
    reviewedAt: string
  } | null
  observedAt?: string | null
  sourceIds?: string[]
  evidenceIds?: string[]
  observations?: CompetitiveResearchObservation[]
}): CompetitiveResearchReadModel {
  const observations = input.observations ?? []
  const confirmedObservations = observations.filter(
    (observation) => !observation.synthetic && observation.reviewState === 'confirmed'
  )
  const sourceIds = [
    ...new Set([
      ...(input.sourceIds ?? []),
      ...confirmedObservations.map((observation) => observation.sourceId)
    ])
  ]
  const evidenceIds = [
    ...new Set([
      ...(input.evidenceIds ?? []),
      ...confirmedObservations.flatMap((observation) =>
        observation.evidenceId === null ? [] : [observation.evidenceId]
      )
    ])
  ]
  const seedReview = input.seedReview ?? null
  const observedAt =
    input.observedAt ??
    (confirmedObservations.length > 0
      ? (confirmedObservations
          .map((observation) => observation.observedAt)
          .sort()
          .at(-1) ?? null)
      : null)
  const sourceBacked =
    !input.synthetic &&
    confirmedObservations.length > 0 &&
    sourceIds.length > 0 &&
    evidenceIds.length > 0 &&
    observedAt !== null
  const status = sourceBacked
    ? 'source-backed'
    : seedReview !== null
      ? 'reviewed-seed-only'
      : 'unresolved'
  const relevantGaps = input.coverageGaps.filter((gap) =>
    /competitor|contrary|market research|substitute|workaround/i.test(gap)
  )
  if (relevantGaps.length === 0 && status !== 'source-backed') {
    relevantGaps.push(
      input.synthetic
        ? 'Competitor records are synthetic examples, not verified market research.'
        : 'No permitted competitor or contrary-signal source evidence is attached; reviewed seed values are not market research.'
    )
  }
  return competitiveResearchReadModelSchema.parse({
    status,
    observedAt,
    sourceIds,
    evidenceIds,
    observations,
    coverageGaps: [...new Set(relevantGaps)],
    seedReview,
    synthetic: input.synthetic
  })
}

const policyVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._:-]+$/)

export const objectStorageKindSchema = z.enum([
  'evidence',
  'report-json',
  'report-markdown',
  'plan-package',
  'workflow-artifact',
  'export'
])

export const objectStorageDeletionStateSchema = z.enum(['active', 'deleted'])

const objectMetadataTextSchema = z.string().refine(
  (value) =>
    ![...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    }),
  'Object metadata cannot contain control characters'
)

/**
 * Content-addressed object metadata. The URI is an opaque reference; callers
 * must not derive filesystem paths or provider keys from untrusted content.
 */
export const objectReferenceSchema = z
  .object({
    version: z.literal(1),
    uri: z
      .string()
      .min(32)
      .max(512)
      .regex(/^appsea-object:\/\/[a-z][a-z0-9_:-]*\/(?:[a-z][a-z0-9-]*\/)\b[a-f0-9]{64}$/),
    workspaceId: appseaIdentifierSchema,
    kind: objectStorageKindSchema,
    contentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative().max(100_000_000),
    contentType: objectMetadataTextSchema.min(1).max(160),
    createdAt: z.string().datetime(),
    retentionUntil: z.string().datetime().nullable(),
    deletionState: objectStorageDeletionStateSchema,
    deletedAt: z.string().datetime().nullable(),
    deletionReason: objectMetadataTextSchema.min(1).max(240).nullable()
  })
  .strict()
  .superRefine((reference, context) => {
    const active = reference.deletionState === 'active'
    if (active && (reference.deletedAt !== null || reference.deletionReason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['deletionState'],
        message: 'Active objects cannot carry deletion metadata'
      })
    }
    if (!active && (reference.deletedAt === null || reference.deletionReason === null)) {
      context.addIssue({
        code: 'custom',
        path: ['deletionState'],
        message: 'Deleted objects require deletion metadata'
      })
    }
    if (
      reference.retentionUntil !== null &&
      Date.parse(reference.retentionUntil) < Date.parse(reference.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retentionUntil'],
        message: 'Object retention cannot end before creation'
      })
    }
    if (
      reference.deletedAt !== null &&
      Date.parse(reference.deletedAt) < Date.parse(reference.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['deletedAt'],
        message: 'Deletion cannot precede creation'
      })
    }
    const expectedUri = `appsea-object://${reference.workspaceId}/${reference.kind}/${reference.contentHash}`
    if (reference.uri !== expectedUri) {
      context.addIssue({
        code: 'custom',
        path: ['uri'],
        message: 'Object URI must be content-addressed to its workspace, kind, and hash'
      })
    }
  })

/** Canonical files emitted by the deterministic production coding package. */
export const productionPlanPackagePaths = [
  'README.md',
  '01-product-brief.md',
  '02-mvp-scope.md',
  '03-architecture.md',
  '04-task-graph.json',
  '05-validation.md'
] as const

/**
 * A production analysis seed is reviewed input, not a model output. The
 * analysis stage may calculate the deterministic score from these factors,
 * but it must not invent willingness-to-pay, feasibility, competitor, or
 * contrary-evidence values from complaint text.
 *
 * The storage schema intentionally remains portable-path compatible so that
 * already-reviewed rows remain readable during a manifest rollout. New seed
 * writes and analysis inputs use `productionOpportunitySeedSchema`, which
 * adds the canonical six-file package manifest below.
 */
const productionOpportunitySeedStorageSchema = z
  .object({
    id: appseaIdentifierSchema,
    slug: opportunitySlugSchema,
    name: z.string().min(1).max(240),
    oneLine: z.string().min(1).max(500),
    thesis: z.string().min(1).max(5_000),
    audience: z.string().min(1).max(2_000),
    firstWedge: z.string().min(1).max(2_000),
    tags: z.array(z.string().min(1).max(120)).max(100),
    competitors: z.array(competitorSchema).max(500),
    contraryEvidence: z.array(z.string().min(1).max(2_000)).max(500),
    scoreFactors: scoreFactorsSchema,
    balancedScoreInput: balancedScoreInputSchema.optional(),
    planFiles: z
      .array(
        z
          .string()
          .min(1)
          .max(240)
          .refine(isPortablePlanPath, 'Plan package paths must be portable relative POSIX paths')
      )
      .min(1)
      .max(64)
  })
  .strict()
  .superRefine((seed, context) => {
    const inspect = (value: unknown, path: Array<string | number>): void => {
      if (typeof value === 'string') {
        if (hasUnsupportedPostgresText(value)) {
          context.addIssue({
            code: 'custom',
            path,
            message: 'Seed text contains a character unsupported by PostgreSQL JSON storage'
          })
        }
        return
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => inspect(entry, [...path, index]))
        return
      }
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => inspect(entry, [...path, key]))
      }
    }
    inspect(seed, [])
    seed.competitors.forEach((competitor, competitorIndex) => {
      competitor.featureMatrix.forEach((entry, featureIndex) => {
        if (entry.evidenceBasis !== 'reviewed-seed') {
          context.addIssue({
            code: 'custom',
            path: ['competitors', competitorIndex, 'featureMatrix', featureIndex, 'evidenceBasis'],
            message:
              'Production opportunity seeds may contain reviewed-seed feature assumptions only'
          })
        }
      })
    })
    if (new TextEncoder().encode(JSON.stringify(seed)).byteLength > 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Opportunity seed reviews must be at most 1 MB when serialized'
      })
    }
  })

/** New seed writes and production analysis inputs require the supported package manifest. */
export const productionOpportunitySeedSchema = productionOpportunitySeedStorageSchema.superRefine(
  (seed, context) => {
    const uniquePlanFiles = new Set(seed.planFiles)
    if (
      seed.planFiles.length !== productionPlanPackagePaths.length ||
      uniquePlanFiles.size !== productionPlanPackagePaths.length ||
      !productionPlanPackagePaths.every((path) => uniquePlanFiles.has(path))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planFiles'],
        message: 'Production seed planFiles must contain the supported six-file package manifest'
      })
    }
  }
)

/**
 * Immutable policy provenance supplied by the source-registry read boundary.
 * The policy payload is still validated separately; the version, content hash,
 * and review identifier make it impossible for a downstream analysis caller to
 * silently substitute a different approval snapshot.
 */
export const productionPolicySnapshotSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    policyVersion: policyVersionSchema,
    contentHash: contentHashSchema,
    reviewId: appseaIdentifierSchema,
    policy: sourcePolicySchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.sourceId !== snapshot.policy.sourceId) {
      context.addIssue({
        code: 'custom',
        path: ['policy', 'sourceId'],
        message: 'Policy snapshot source must match its source identifier'
      })
    }
    if (snapshot.policy.sourceType === 'fixture' || snapshot.policy.displayMode === 'fixture') {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: 'Production policy snapshots cannot describe fixture sources'
      })
    }
  })

/**
 * Product, competitor, contrary-signal, and score inputs are reviewed seed
 * data. They are never inferred from complaint text by the deterministic
 * analysis composer.
 */
export const productionOpportunitySeedReviewSchema = z
  .object({
    seed: productionOpportunitySeedSchema,
    seedVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    contentHash: contentHashSchema,
    reviewId: appseaIdentifierSchema,
    reviewedBy: z.string().min(1).max(160),
    reviewedAt: z.string().datetime()
  })
  .strict()

export const workspaceOpportunitySeedReviewStateSchema = z.enum([
  'unreviewed',
  'reviewed',
  'approved',
  'withdrawn'
])

/** A seed is immutable input; revisions use a new review identifier. */
export const workspaceOpportunitySeedCreateInputSchema = z
  .object({
    seedReviewId: appseaIdentifierSchema,
    seedVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    seed: productionOpportunitySeedSchema
  })
  .strict()

export const workspaceOpportunitySeedApprovalActionSchema = z.enum([
  'reviewed',
  'approved',
  'withdrawn'
])

export const workspaceOpportunitySeedApprovalInputSchema = z
  .object({
    action: workspaceOpportunitySeedApprovalActionSchema
  })
  .strict()

export const workspaceOpportunitySeedReadModelSchema = z
  .object({
    seedReviewId: appseaIdentifierSchema,
    seedVersion: z.string().min(1).max(80),
    seed: productionOpportunitySeedStorageSchema,
    contentHash: contentHashSchema,
    reviewState: workspaceOpportunitySeedReviewStateSchema,
    createdBy: appseaIdentifierSchema,
    reviewedBy: appseaIdentifierSchema.nullable(),
    reviewedAt: z.string().datetime().nullable(),
    approvedBy: appseaIdentifierSchema.nullable(),
    approvedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()

/**
 * Production analysis keeps the normalized complaint identity separate from
 * its source evidence. This is the mapping used by persistence and reports;
 * complaint IDs must never be used as a substitute evidence identifier.
 */
export const productionAnalysisComplaintSchema = complaintSchema
  .extend({
    evidenceId: appseaIdentifierSchema,
    sourceItemId: appseaIdentifierSchema,
    evidenceHash: contentHashSchema
  })
  .strict()

export const researchArtifactSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['fixture', 'production']),
  createdAt: z.string().datetime(),
  sourcePolicies: z.array(sourcePolicySchema).min(1).max(16),
  complaints: z.array(complaintSchema).min(1).max(5_000),
  analyses: z.array(complaintAnalysisSchema).min(1).max(5_000),
  clusters: z.array(complaintClusterSchema).min(1).max(2_000),
  opportunity: opportunitySchema,
  coverageGaps: z.array(z.string()).max(500),
  warnings: z.array(z.string()).max(500),
  /** Optional offline benchmark evidence; absent in legacy artifacts. */
  qualitySnapshot: researchQualitySnapshotSchema.optional()
})

export const fixtureResearchArtifactSchema = researchArtifactSchema
  .extend({ mode: z.literal('fixture') })
  .superRefine((artifact, context) => {
    const addIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: 'custom', path, message })
    }
    const unique = (values: string[]): boolean => new Set(values).size === values.length
    const sameSet = (left: string[], right: string[]): boolean => {
      const leftSet = new Set(left)
      const rightSet = new Set(right)
      return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
    }
    const inspectText = (value: unknown, path: Array<string | number>): void => {
      if (typeof value === 'string') {
        if (hasUnsupportedPostgresText(value)) {
          addIssue(path, 'Text contains a character unsupported by PostgreSQL JSON storage')
        }
        return
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => inspectText(entry, [...path, index]))
        return
      }
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => inspectText(entry, [...path, key]))
      }
    }

    inspectText(artifact, [])
    if (new TextEncoder().encode(JSON.stringify(artifact)).byteLength > 5_000_000) {
      addIssue([], 'Fixture research artifacts must be at most 5 MB when serialized')
    }

    const sourceIds = artifact.sourcePolicies.map((policy) => policy.sourceId)
    if (!unique(sourceIds)) addIssue(['sourcePolicies'], 'Fixture source policy IDs must be unique')
    artifact.sourcePolicies.forEach((policy, index) => {
      if (
        policy.sourceType !== 'fixture' ||
        policy.displayMode !== 'fixture' ||
        !policy.enabled ||
        policy.commercialUse !== 'allowed' ||
        !policy.permittedPurposes.includes('testing') ||
        policy.permittedPurposes.some((purpose) => !fixturePurposes.has(purpose))
      ) {
        addIssue(
          ['sourcePolicies', index],
          'Fixture artifacts require enabled, allowed fixture policies with fixture-only purposes'
        )
      }
    })

    const complaintIds = artifact.complaints.map((complaint) => complaint.id)
    const complaintIdSet = new Set(complaintIds)
    if (!unique(complaintIds)) addIssue(['complaints'], 'Fixture complaint IDs must be unique')
    const analysisIds = artifact.analyses.map((analysis) => analysis.complaintId)
    if (!unique(analysisIds))
      addIssue(['analyses'], 'Fixture analysis complaint IDs must be unique')
    if (!sameSet(analysisIds, complaintIds)) {
      addIssue(['analyses'], 'Fixture analyses must cover each complaint exactly once')
    }
    artifact.analyses.forEach((analysis, index) => {
      if (!complaintIdSet.has(analysis.complaintId)) {
        addIssue(
          ['analyses', index, 'complaintId'],
          'Analysis must reference an artifact complaint'
        )
      }
    })
    const nativeKeys = artifact.complaints.map(
      (complaint) => `${complaint.sourceId}\0${complaint.sourceRecordId}`
    )
    if (!unique(nativeKeys)) {
      addIssue(['complaints'], 'Source-native record identifiers must be unique per source')
    }
    artifact.complaints.forEach((complaint, index) => {
      if (!sourceIds.includes(complaint.sourceId)) {
        addIssue(['complaints', index, 'sourceId'], 'Complaint source must have a policy snapshot')
      }
      if (!complaint.synthetic || complaint.allowedRepresentation !== 'fixture') {
        addIssue(
          ['complaints', index],
          'Fixture artifacts accept only synthetic fixture complaints'
        )
      }
    })

    const clusterIds = artifact.clusters.map((cluster) => cluster.id)
    if (!unique(clusterIds)) addIssue(['clusters'], 'Fixture cluster IDs must be unique')
    const memberships = artifact.clusters.flatMap((cluster) => cluster.complaintIds)
    artifact.clusters.forEach((cluster, index) => {
      if (!unique(cluster.complaintIds)) {
        addIssue(['clusters', index, 'complaintIds'], 'Cluster memberships must be unique')
      }
      cluster.complaintIds.forEach((complaintId, complaintIndex) => {
        if (!complaintIdSet.has(complaintId)) {
          addIssue(
            ['clusters', index, 'complaintIds', complaintIndex],
            'Cluster membership must reference an artifact complaint'
          )
        }
      })
      const clusterComplaints = artifact.complaints.filter((complaint) =>
        cluster.complaintIds.includes(complaint.id)
      )
      if (cluster.uniqueObservationCount !== new Set(cluster.complaintIds).size) {
        addIssue(
          ['clusters', index, 'uniqueObservationCount'],
          'Cluster observation count must equal its unique complaint memberships'
        )
      }
      if (cluster.sourceCount !== new Set(clusterComplaints.map((entry) => entry.sourceId)).size) {
        addIssue(
          ['clusters', index, 'sourceCount'],
          'Cluster source count must equal its represented complaint sources'
        )
      }
    })
    if (!unique(memberships) || !sameSet(memberships, complaintIds)) {
      addIssue(['clusters'], 'Every fixture complaint must belong to exactly one complaint cluster')
    }
    if (
      !unique(artifact.opportunity.complaintIds) ||
      !sameSet(artifact.opportunity.complaintIds, complaintIds)
    ) {
      addIssue(
        ['opportunity', 'complaintIds'],
        'Opportunity complaint IDs must equal the artifact complaint snapshot'
      )
    }
    if (!artifact.opportunity.synthetic) {
      addIssue(['opportunity', 'synthetic'], 'Fixture opportunities must be synthetic')
    }
  })

export const planPackageFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(240)
    .refine(isPortablePlanPath, 'Plan package paths must be portable relative POSIX paths'),
  content: z.string().max(262_144)
})

export const planPackageSchema = z
  .object({
    opportunitySlug: opportunitySlugSchema,
    generatedAt: z.string().datetime(),
    files: z.array(planPackageFileSchema).min(1).max(64)
  })
  .superRefine((planPackage, context) => {
    const portablePaths = new Set<string>()
    planPackage.files.forEach((file, index) => {
      const portablePath = file.path.normalize('NFC').toLowerCase()
      if (portablePaths.has(portablePath)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Plan package paths must be unique on case-insensitive filesystems'
        })
      }
      portablePaths.add(portablePath)
      if (hasUnsupportedPostgresText(file.content)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'content'],
          message: 'Plan content contains a character unsupported by PostgreSQL JSON storage'
        })
      }
    })
    if (new TextEncoder().encode(JSON.stringify(planPackage)).byteLength > 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Inline fixture plan packages must be at most 1 MB when serialized'
      })
    }
  })

export const reportSourceCoverageSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    displayName: z.string().min(1).max(160),
    sourceType: z.enum(['fixture', 'api', 'export', 'licensed-feed', 'manual']),
    policyState: sourcePolicyStateSchema,
    enabled: z.boolean(),
    displayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
    coverageNotes: z.array(z.string()),
    reviewedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    observationCount: z.number().int().nonnegative(),
    synthetic: z.boolean()
  })
  .strict()

export const opportunityReportObservationSchema = z
  .object({
    evidenceId: appseaIdentifierSchema,
    sourceRecordId: z.string().min(1).max(240),
    canonicalLocator: canonicalLocatorSchema.nullable().default(null),
    sourceId: appseaIdentifierSchema,
    query: z.string().max(500),
    product: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
    analysis: complaintAnalysisSchema.nullable().default(null),
    excerpt: z.string().max(20_000).nullable(),
    redacted: z.boolean(),
    allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    synthetic: z.boolean()
  })
  .strict()

export const opportunityReportSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    reportType: z.literal('opportunity'),
    synthetic: z.boolean(),
    testOnly: z.boolean().default(false),
    transport: productionAnalysisTransportSchema.nullable().default(null),
    artifactId: appseaIdentifierSchema,
    generatedAt: z.string().datetime(),
    opportunity: z
      .object({
        id: appseaIdentifierSchema,
        slug: opportunitySlugSchema,
        name: z.string().min(1),
        thesis: z.string().min(1),
        audience: z.string().min(1),
        firstWedge: z.string().min(1)
      })
      .strict(),
    evidence: z
      .object({
        complaintCount: z.number().int().nonnegative(),
        clusterCount: z.number().int().nonnegative(),
        observations: z.array(opportunityReportObservationSchema).max(5_000),
        clusters: z.array(
          z
            .object({
              id: appseaIdentifierSchema,
              title: z.string().min(1),
              summary: z.string().min(1),
              complaintIds: z.array(z.string().min(1)).min(1),
              confidence: z.number().min(0).max(1)
            })
            .strict()
        )
      })
      .strict(),
    inference: z
      .object({
        scoreSnapshot: scoreSnapshotSchema,
        contraryEvidence: z.array(z.string()),
        confidence: z.enum(['low', 'medium', 'high']),
        rationale: z.array(z.string().min(1)),
        qualitySnapshot: researchQualitySnapshotSchema.optional()
      })
      .strict(),
    recommendation: z
      .object({
        decision: z.enum(['validate', 'explore', 'defer']),
        firstWedge: z.string().min(1),
        nextSteps: z.array(z.string().min(1)).min(1).max(20)
      })
      .strict(),
    coverage: z
      .object({
        gaps: z.array(z.string()),
        sources: z.array(reportSourceCoverageSchema)
      })
      .strict(),
    /** Optional offline quality evidence; older reports omit this field. */
    qualitySnapshot: researchQualitySnapshotSchema.optional(),
    warnings: z.array(z.string())
  })
  .strict()

export const fixturePersistenceInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(8).max(200),
    requestedAt: z.string().datetime(),
    artifact: fixtureResearchArtifactSchema,
    planPackage: planPackageSchema
  })
  .superRefine((input, context) => {
    const addIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: 'custom', path, message })
    }
    const validateIdentifier = (value: string, path: Array<string | number>): void => {
      if (!appseaIdentifierSchema.safeParse(value).success) {
        addIssue(path, 'Value must be a persistence-safe AppSea identifier')
      }
    }
    const hasUniqueValues = (values: string[]): boolean => new Set(values).size === values.length
    const sameStringSet = (left: string[], right: string[]): boolean => {
      const leftSet = new Set(left)
      const rightSet = new Set(right)
      return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
    }

    if (input.planPackage.opportunitySlug !== input.artifact.opportunity.slug) {
      addIssue(
        ['planPackage', 'opportunitySlug'],
        'Plan package must describe the persisted opportunity'
      )
    }
    validateIdentifier(input.artifact.id, ['artifact', 'id'])
    validateIdentifier(input.artifact.opportunity.id, ['artifact', 'opportunity', 'id'])

    const sourceIds = input.artifact.sourcePolicies.map((policy) => policy.sourceId)
    if (!hasUniqueValues(sourceIds)) {
      addIssue(['artifact', 'sourcePolicies'], 'Fixture source policy IDs must be unique')
    }
    input.artifact.sourcePolicies.forEach((policy, index) => {
      validateIdentifier(policy.sourceId, ['artifact', 'sourcePolicies', index, 'sourceId'])
      if (
        policy.sourceType !== 'fixture' ||
        policy.displayMode !== 'fixture' ||
        !policy.enabled ||
        policy.commercialUse !== 'allowed' ||
        !policy.permittedPurposes.includes('testing') ||
        policy.permittedPurposes.some(
          (purpose) => !['development', 'testing', 'demonstration'].includes(purpose)
        )
      ) {
        addIssue(
          ['artifact', 'sourcePolicies', index],
          'Fixture persistence accepts only enabled, allowed testing fixture policies'
        )
      }
    })

    const complaintIds = input.artifact.complaints.map((complaint) => complaint.id)
    if (!hasUniqueValues(complaintIds)) {
      addIssue(['artifact', 'complaints'], 'Fixture complaint IDs must be unique')
    }
    const nativeRecordKeys = input.artifact.complaints.map(
      (complaint) => `${complaint.sourceId}\0${complaint.sourceRecordId}`
    )
    if (!hasUniqueValues(nativeRecordKeys)) {
      addIssue(
        ['artifact', 'complaints'],
        'Fixture source-native record identifiers must be unique per source'
      )
    }
    input.artifact.complaints.forEach((complaint, index) => {
      validateIdentifier(complaint.id, ['artifact', 'complaints', index, 'id'])
      if (complaint.sourceRecordId.length > 240) {
        addIssue(
          ['artifact', 'complaints', index, 'sourceRecordId'],
          'Source record IDs must be at most 240 characters'
        )
      }
      if (complaint.text.length > 20_000) {
        addIssue(
          ['artifact', 'complaints', index, 'text'],
          'Persisted fixture complaint text must be at most 20,000 characters'
        )
      }
      if (complaint.language.length > 16) {
        addIssue(
          ['artifact', 'complaints', index, 'language'],
          'Persisted language tags must be at most 16 characters'
        )
      }
      if (!complaint.synthetic || complaint.allowedRepresentation !== 'fixture') {
        addIssue(
          ['artifact', 'complaints', index],
          'Fixture persistence accepts only synthetic fixture complaints'
        )
      }
    })

    const clusterIds = input.artifact.clusters.map((cluster) => cluster.id)
    if (!hasUniqueValues(clusterIds)) {
      addIssue(['artifact', 'clusters'], 'Fixture cluster IDs must be unique')
    }
    input.artifact.clusters.forEach((cluster, index) => {
      validateIdentifier(cluster.id, ['artifact', 'clusters', index, 'id'])
      if (!hasUniqueValues(cluster.complaintIds)) {
        addIssue(
          ['artifact', 'clusters', index, 'complaintIds'],
          'Cluster complaint memberships must be unique'
        )
      }
    })

    if (!input.artifact.opportunity.synthetic) {
      addIssue(
        ['artifact', 'opportunity', 'synthetic'],
        'Fixture persistence accepts only synthetic opportunities'
      )
    }
    const clusteredComplaintIds = input.artifact.clusters.flatMap((cluster) => cluster.complaintIds)
    if (
      !hasUniqueValues(input.artifact.opportunity.complaintIds) ||
      !sameStringSet(input.artifact.opportunity.complaintIds, clusteredComplaintIds)
    ) {
      addIssue(
        ['artifact', 'opportunity', 'complaintIds'],
        'Opportunity complaint IDs must equal the unique cluster membership set'
      )
    }
    if (
      !sameStringSet(
        input.artifact.opportunity.planFiles,
        input.planPackage.files.map((file) => file.path)
      )
    ) {
      addIssue(
        ['artifact', 'opportunity', 'planFiles'],
        'Opportunity plan files must equal the supplied plan package paths'
      )
    }
    const score = input.artifact.opportunity.scoreSnapshot.score
    if (Math.abs(score * 10 - Math.round(score * 10)) > Number.EPSILON * 10) {
      addIssue(
        ['artifact', 'opportunity', 'scoreSnapshot', 'score'],
        'Persisted fixture scores must use one decimal place'
      )
    }
  })

export const fixturePersistenceResultSchema = z.object({
  workspaceId: appseaIdentifierSchema,
  campaignId: appseaIdentifierSchema,
  runId: appseaIdentifierSchema,
  artifactId: appseaIdentifierSchema,
  opportunityId: appseaIdentifierSchema,
  scoreSnapshotId: appseaIdentifierSchema,
  planPackageId: appseaIdentifierSchema,
  sourceItemCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  complaintCount: z.number().int().nonnegative(),
  clusterCount: z.number().int().nonnegative(),
  competitorCount: z.number().int().nonnegative(),
  state: z.literal('completed'),
  completedAt: z.string().datetime(),
  replayed: z.boolean()
})

export const researchJobBudgetSchema = z
  .object({
    currency: z.literal('USD'),
    maxSourceItems: z.number().int().min(0).max(5_000),
    maxCostMicros: z.number().int().min(0).max(1_000_000_000_000),
    maxActivityAttempts: z.number().int().min(1).max(10)
  })
  .strict()

export const researchCampaignStateSchema = z.enum([
  'draft',
  'validated',
  'queued',
  'running',
  'paused',
  'completed',
  'partial',
  'failed',
  'canceled',
  'archived'
])

export const researchCampaignRefreshPolicySchema = z.enum(['manual', 'daily', 'weekly', 'monthly'])

export const researchCampaignConfigurationSchema = z
  .object({
    schemaVersion: z.literal('campaign-v1'),
    goal: z.string().min(1).max(2_000),
    query: z.string().max(500),
    seeds: z.array(z.string().min(1).max(240)).min(1).max(100),
    sourceIds: z.array(appseaIdentifierSchema).min(1).max(16),
    languages: z.array(z.string().min(2).max(16)).max(16),
    geographies: z.array(z.string().min(1).max(120)).max(32),
    dateRange: z
      .object({
        from: z.string().datetime().nullable(),
        to: z.string().datetime().nullable()
      })
      .strict(),
    exclusions: z.array(z.string().min(1).max(240)).max(100),
    maxEvidenceCount: z.number().int().min(1).max(5_000),
    refreshPolicy: researchCampaignRefreshPolicySchema,
    sensitiveTopicPolicy: z.enum(['exclude', 'review']),
    requestedDisplayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only'])
  })
  .strict()
  .superRefine((configuration, context) => {
    if (new Set(configuration.sourceIds).size !== configuration.sourceIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceIds'],
        message: 'Campaign source IDs must be unique'
      })
    }
    if (
      configuration.dateRange.from !== null &&
      configuration.dateRange.to !== null &&
      Date.parse(configuration.dateRange.from) >= Date.parse(configuration.dateRange.to)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dateRange'],
        message: 'Campaign date range must end after it starts'
      })
    }
  })

const legacyResearchCampaignConfigurationSchema = z.record(z.string(), z.unknown())
const legacyResearchCampaignBudgetSchema = z.record(z.string(), z.unknown())

export const researchCampaignCreateInputSchema = z
  .object({
    campaignId: appseaIdentifierSchema,
    name: z.string().min(1).max(160),
    purpose: z.string().min(1).max(120),
    configuration: researchCampaignConfigurationSchema,
    budget: researchJobBudgetSchema
  })
  .strict()

/** Replacement input for editing a draft campaign. The campaign ID is path-bound. */
export const researchCampaignUpdateInputSchema = z
  .object({
    name: z.string().min(1).max(160),
    purpose: z.string().min(1).max(120),
    configuration: researchCampaignConfigurationSchema,
    budget: researchJobBudgetSchema
  })
  .strict()

export const researchCampaignRefreshScheduleStateSchema = z.enum([
  'manual',
  'scheduled',
  'dispatching',
  'failed'
])

export const researchCampaignRefreshFailureCodeSchema = z.enum([
  'APPSEA_REFRESH_POLICY_DENIED',
  'APPSEA_REFRESH_SOURCE_UNSUPPORTED',
  'APPSEA_REFRESH_INPUT_INVALID',
  'APPSEA_REFRESH_ADMISSION_RATE_LIMITED',
  'APPSEA_REFRESH_ADMISSION_CONCURRENCY_LIMITED',
  'APPSEA_REFRESH_TEMPORAL_UNAVAILABLE',
  'APPSEA_REFRESH_CLAIM_LOST',
  'APPSEA_REFRESH_FAILED'
])

export const researchCampaignRefreshScheduleReadModelSchema = z
  .object({
    state: researchCampaignRefreshScheduleStateSchema,
    refreshPolicy: researchCampaignRefreshPolicySchema,
    nextDueAt: z.string().datetime().nullable(),
    lastRunId: appseaIdentifierSchema.nullable(),
    lastWorkflowId: z
      .string()
      .min(3)
      .max(240)
      .regex(/^[a-z][a-z0-9_:-]*$/)
      .nullable(),
    lastStartedAt: z.string().datetime().nullable(),
    failureCode: researchCampaignRefreshFailureCodeSchema.nullable(),
    failureSummary: z.string().max(240).nullable()
  })
  .strict()

export const researchCampaignSourceReadModelSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    displayName: z.string().min(1).max(240),
    sourceType: z.enum(['fixture', 'api', 'export', 'licensed-feed', 'manual']),
    lifecycleState: z.string().min(1).max(32),
    policyVersion: z.string().min(1).max(80).nullable(),
    policyState: sourcePolicyStateSchema.nullable(),
    permittedPurposes: z.array(z.string().min(1).max(120)).max(100),
    displayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']).nullable(),
    enabled: z.boolean(),
    synthetic: z.boolean(),
    coverageNotes: z.array(z.string().max(500)).max(100),
    reviewedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable()
  })
  .strict()

export const researchCampaignReadModelSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    name: z.string().min(1).max(160),
    purpose: z.string().min(1).max(120),
    state: researchCampaignStateSchema,
    configuration: z.union([
      researchCampaignConfigurationSchema,
      legacyResearchCampaignConfigurationSchema
    ]),
    budget: z.union([researchJobBudgetSchema, legacyResearchCampaignBudgetSchema]),
    synthetic: z.boolean(),
    sources: z.array(researchCampaignSourceReadModelSchema).max(16),
    refreshSchedule: researchCampaignRefreshScheduleReadModelSchema.nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()

/** User input for launching one source collection from a persisted campaign. */
export const researchCampaignRunInputSchema = z
  .object({
    runId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    requestedAt: z.string().datetime(),
    analysisSeedReviewId: appseaIdentifierSchema.optional()
  })
  .strict()

/**
 * A production source collection is intentionally additive to the fixture
 * research artifact. It records a completed, provenance-preserving collection
 * stage without pretending that clustering, scoring, reporting, or a plan
 * package has already run.
 */
export const productionCollectionRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    query: z.string().max(500),
    limit: z.number().int().min(1).max(5_000),
    purpose: z.string().min(1).max(120),
    requestedDisplayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only']),
    budget: researchJobBudgetSchema,
    requestedAt: z.string().datetime(),
    /** Identifier-only link to a previously staged owner-authorized import. */
    manualImportBatchId: appseaIdentifierSchema.optional(),
    /** Identifier-only link for an explicitly reviewed re-collection. */
    recollectionTombstoneId: appseaIdentifierSchema.optional()
  })
  .strict()
  .superRefine((request, context) => {
    if (request.recollectionTombstoneId && request.limit !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'A tombstone-bound re-collection must fetch exactly one source record'
      })
    }
    if (request.manualImportBatchId && request.sourceId !== 'manual-owner-import') {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Manual import batches are valid only for the owner-import source'
      })
    }
    if (request.sourceId === 'manual-owner-import' && !request.manualImportBatchId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Owner-import collection requires a staged manual import batch'
      })
    }
    if (request.manualImportBatchId && request.recollectionTombstoneId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'A manual import cannot be combined with tombstone re-collection'
      })
    }
  })

export const productionCollectionPersistenceInputSchema = z
  .object({
    request: productionCollectionRequestSchema,
    /** Server-observed collection time; requestedAt remains caller metadata. */
    observedAt: z.string().datetime(),
    /** Settled source cost for this request, recorded in micro-USD. */
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000).default(0),
    policy: sourcePolicySchema,
    complaints: z.array(complaintSchema).max(5_000),
    deletions: z.array(sourceDeletionEventSchema).max(5_000),
    warnings: z.array(z.string().max(500)).max(500)
  })
  .superRefine((input, context) => {
    if (input.policy.sourceId !== input.request.sourceId) {
      context.addIssue({
        code: 'custom',
        path: ['policy', 'sourceId'],
        message: 'Collection policy must match the requested source'
      })
    }
    if (input.policy.displayMode !== input.request.requestedDisplayMode) {
      context.addIssue({
        code: 'custom',
        path: ['policy', 'displayMode'],
        message: 'Collection policy display mode must match the requested representation'
      })
    }
    if (!input.policy.permittedPurposes.includes(input.request.purpose)) {
      context.addIssue({
        code: 'custom',
        path: ['request', 'purpose'],
        message: 'Collection purpose is not present in the policy snapshot'
      })
    }
    const nativeKeys = new Set<string>()
    input.complaints.forEach((complaint, index) => {
      if (complaint.sourceId !== input.request.sourceId) {
        context.addIssue({
          code: 'custom',
          path: ['complaints', index, 'sourceId'],
          message: 'Collected complaint source does not match the request'
        })
      }
      if (
        complaint.synthetic ||
        !complaint.redacted ||
        complaint.allowedRepresentation !== input.request.requestedDisplayMode
      ) {
        context.addIssue({
          code: 'custom',
          path: ['complaints', index],
          message:
            'Production collection accepts only redacted, non-synthetic policy representations'
        })
      }
      if (complaint.text.length > 20_000) {
        context.addIssue({
          code: 'custom',
          path: ['complaints', index, 'text'],
          message: 'Production complaint text must be at most 20,000 characters'
        })
      }
      const key = `${complaint.sourceId}\0${complaint.sourceRecordId}`
      if (nativeKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['complaints', index, 'sourceRecordId'],
          message: 'Source-native record identifiers must be unique per collection'
        })
      }
      nativeKeys.add(key)
    })
    input.deletions.forEach((deletion, index) => {
      if (deletion.sourceId !== input.request.sourceId) {
        context.addIssue({
          code: 'custom',
          path: ['deletions', index, 'sourceId'],
          message: 'Deletion source does not match the request'
        })
      }
    })
  })

/**
 * Input to the non-fixture analysis composition stage. This contract is
 * deliberately separate from the collection read model so query and policy
 * provenance cannot be reconstructed by guessing at a later stage. When
 * present, `analyses` are the reviewed derived snapshots from the collection
 * boundary, including any human corrections.
 */
export const productionAnalysisInputSchema = z
  .object({
    collectionArtifactId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    transport: productionAnalysisTransportSchema,
    testOnly: z.boolean(),
    request: productionCollectionRequestSchema,
    policySnapshot: productionPolicySnapshotSchema,
    complaints: z.array(productionAnalysisComplaintSchema).max(5_000),
    analyses: z.array(complaintAnalysisSchema).max(5_000).optional(),
    deletions: z.array(sourceDeletionEventSchema).max(5_000),
    coverageGaps: z.array(z.string().max(500)).max(500),
    warnings: z.array(z.string().max(500)).max(500),
    opportunitySeed: productionOpportunitySeedReviewSchema,
    analysisAt: z.string().datetime()
  })
  .strict()
  .superRefine((input, context) => {
    const addIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: 'custom', path, message })
    }
    if (input.request.runId !== input.runId) {
      addIssue(['runId'], 'Analysis run ID must match the collection request')
    }
    if (input.analysisRunId === input.runId) {
      addIssue(['analysisRunId'], 'Analysis run must be distinct from the collection run')
    }
    if (input.policySnapshot.sourceId !== input.request.sourceId) {
      addIssue(
        ['policySnapshot', 'sourceId'],
        'Analysis policy snapshot must match the collection request'
      )
    }
    if (input.policySnapshot.policyVersion !== input.request.policyVersion) {
      addIssue(
        ['policySnapshot', 'policyVersion'],
        'Analysis policy version must match the collection request'
      )
    }
    if (
      input.policySnapshot.policy.sourceType === 'fixture' ||
      input.policySnapshot.policy.displayMode === 'fixture'
    ) {
      addIssue(
        ['policySnapshot', 'policy'],
        'Production analysis cannot use a fixture source policy'
      )
    }
    if (
      input.policySnapshot.policy.commercialUse !== 'allowed' &&
      input.policySnapshot.policy.commercialUse !== 'restricted'
    ) {
      addIssue(
        ['policySnapshot', 'policy', 'commercialUse'],
        'Production analysis requires allowed or restricted commercial use'
      )
    }
    if (
      !input.policySnapshot.policy.enabled ||
      input.policySnapshot.policy.policyState !== 'approved'
    ) {
      addIssue(
        ['policySnapshot', 'policy'],
        'Production analysis requires an enabled approved policy snapshot'
      )
    }
    if (input.policySnapshot.policy.displayMode !== input.request.requestedDisplayMode) {
      addIssue(
        ['policySnapshot', 'policy', 'displayMode'],
        'Analysis policy display mode must match the collection request'
      )
    }
    if (!input.policySnapshot.policy.permittedPurposes.includes(input.request.purpose)) {
      addIssue(['request', 'purpose'], 'Analysis purpose is absent from the policy snapshot')
    }
    if (input.transport === 'offline-sample' && !input.testOnly) {
      addIssue(['testOnly'], 'Offline analysis transport must be explicitly test-only')
    }
    const complaintIds = new Set<string>()
    const nativeKeys = new Set<string>()
    const evidenceIds = new Set<string>()
    const sourceItemIds = new Set<string>()
    input.complaints.forEach((complaint, index) => {
      if (complaintIds.has(complaint.id)) {
        addIssue(['complaints', index, 'id'], 'Analysis complaint IDs must be unique')
      }
      complaintIds.add(complaint.id)
      if (evidenceIds.has(complaint.evidenceId)) {
        addIssue(['complaints', index, 'evidenceId'], 'Analysis evidence IDs must be unique')
      }
      evidenceIds.add(complaint.evidenceId)
      if (sourceItemIds.has(complaint.sourceItemId)) {
        addIssue(['complaints', index, 'sourceItemId'], 'Analysis source item IDs must be unique')
      }
      sourceItemIds.add(complaint.sourceItemId)
      const nativeKey = `${complaint.sourceId}\0${complaint.sourceRecordId}`
      if (nativeKeys.has(nativeKey)) {
        addIssue(
          ['complaints', index, 'sourceRecordId'],
          'Analysis source-native record identifiers must be unique'
        )
      }
      nativeKeys.add(nativeKey)
      if (
        complaint.sourceId !== input.request.sourceId ||
        complaint.synthetic ||
        !complaint.redacted ||
        complaint.allowedRepresentation !== input.request.requestedDisplayMode
      ) {
        addIssue(
          ['complaints', index],
          'Production analysis accepts only redacted, non-synthetic policy representations'
        )
      }
    })
    if (input.analyses !== undefined) {
      const complaintIds = new Set(input.complaints.map((complaint) => complaint.id))
      const analysisIds = input.analyses.map((analysis) => analysis.complaintId)
      if (
        input.analyses.length !== complaintIds.size ||
        new Set(analysisIds).size !== analysisIds.length ||
        !analysisIds.every((complaintId) => complaintIds.has(complaintId))
      ) {
        addIssue(
          ['analyses'],
          'Reviewed analysis snapshots must cover each retained complaint exactly once'
        )
      }
      input.analyses.forEach((analysis, index) => {
        if (!['confirmed', 'corrected'].includes(analysis.reviewState)) {
          addIssue(
            ['analyses', index, 'reviewState'],
            'Production analysis snapshots must be confirmed or corrected'
          )
        }
      })
    }
    input.deletions.forEach((deletion, index) => {
      if (deletion.sourceId !== input.request.sourceId) {
        addIssue(['deletions', index, 'sourceId'], 'Deletion source must match the request')
      }
    })
  })

export const productionResearchArtifactSchema = researchArtifactSchema
  .extend({
    mode: z.literal('production'),
    analysisVersion: z.literal('production-analysis-v1'),
    runId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    collectionArtifactId: appseaIdentifierSchema,
    transport: productionAnalysisTransportSchema,
    testOnly: z.boolean(),
    policySnapshot: productionPolicySnapshotSchema,
    opportunitySeedReview: productionOpportunitySeedReviewSchema,
    complaints: z.array(productionAnalysisComplaintSchema).min(1).max(5_000)
  })
  .superRefine((artifact, context) => {
    const addIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: 'custom', path, message })
    }
    const complaintIds = new Set(artifact.complaints.map((complaint) => complaint.id))
    const analysisIds = artifact.analyses.map((analysis) => analysis.complaintId)
    if (
      analysisIds.length !== complaintIds.size ||
      new Set(analysisIds).size !== analysisIds.length ||
      !analysisIds.every((complaintId) => complaintIds.has(complaintId))
    ) {
      addIssue(['analyses'], 'Production analyses must cover each retained complaint exactly once')
    }
    const memberships = artifact.clusters.flatMap((cluster) => cluster.complaintIds)
    if (artifact.analysisRunId === artifact.runId) {
      addIssue(['analysisRunId'], 'Analysis run must be distinct from the collection run')
    }
    if (artifact.opportunity.synthetic) {
      addIssue(['opportunity', 'synthetic'], 'Production opportunities must not be synthetic')
    }
    if (
      memberships.length !== complaintIds.size ||
      new Set(memberships).size !== memberships.length ||
      !memberships.every((complaintId) => complaintIds.has(complaintId))
    ) {
      addIssue(['clusters'], 'Production clusters must cover each retained complaint exactly once')
    }
    if (
      artifact.opportunity.complaintIds.length !== complaintIds.size ||
      !artifact.opportunity.complaintIds.every((complaintId) => complaintIds.has(complaintId))
    ) {
      addIssue(
        ['opportunity', 'complaintIds'],
        'Production opportunity complaint IDs must match the analyzed complaints'
      )
    }
    artifact.sourcePolicies.forEach((policy, index) => {
      if (
        policy.sourceType === 'fixture' ||
        policy.displayMode === 'fixture' ||
        (policy.commercialUse !== 'allowed' && policy.commercialUse !== 'restricted') ||
        !policy.enabled ||
        policy.policyState !== 'approved'
      ) {
        addIssue(
          ['sourcePolicies', index],
          'Production artifacts require enabled approved non-fixture policies with allowed or restricted commercial use'
        )
      }
    })
    if (artifact.sourcePolicies.length !== 1) {
      addIssue(['sourcePolicies'], 'Production artifacts currently support one policy snapshot')
    } else if (artifact.sourcePolicies[0]?.sourceId !== artifact.policySnapshot.sourceId) {
      addIssue(
        ['policySnapshot', 'sourceId'],
        'Artifact policy snapshot must match the source-policy array'
      )
    }
    if (artifact.opportunity.id !== artifact.opportunitySeedReview.seed.id) {
      addIssue(
        ['opportunitySeedReview', 'seed', 'id'],
        'Artifact opportunity must match the reviewed opportunity seed'
      )
    }
    artifact.complaints.forEach((complaint, index) => {
      if (
        complaint.synthetic ||
        !complaint.redacted ||
        complaint.allowedRepresentation === 'fixture'
      ) {
        addIssue(
          ['complaints', index],
          'Production artifacts require redacted, non-synthetic complaints'
        )
      }
    })
  })

export const productionAnalysisAvailabilitySchema = z.enum([
  'active',
  'invalidated',
  'workspace_deleted',
  'expired',
  'pending'
])

export const productionAnalysisRunStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'canceled'
])

export const productionAnalysisFailureCodeSchema = z.enum([
  'analysis_input_invalid',
  'analysis_policy_denied',
  'analysis_budget_exceeded',
  'analysis_activity_failed',
  'analysis_reconciliation_required'
])

export const productionAnalysisActivityAttemptStateSchema = z.enum([
  'started',
  'completed',
  'failed'
])

export const productionAnalysisActivityAttemptReadModelSchema = z
  .object({
    activityAttempt: z.number().int().positive().max(10),
    state: productionAnalysisActivityAttemptStateSchema,
    startedAt: z.string().datetime(),
    lastHeartbeatAt: z.string().datetime(),
    heartbeatCount: z.number().int().positive().max(10_000),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().max(86_400_000).nullable(),
    failureCode: productionAnalysisFailureCodeSchema.nullable()
  })
  .strict()

export const productionAnalysisActivityAttemptHistorySchema =
  productionAnalysisActivityAttemptReadModelSchema.array().max(10)

export const productionAnalysisPersistenceInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    requestedAt: z.string().datetime(),
    workflowInputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    requestedBy: workflowActorSchema.optional(),
    artifact: productionResearchArtifactSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.artifact.runId !== input.collectionRunId) {
      context.addIssue({
        code: 'custom',
        path: ['artifact', 'runId'],
        message: 'Analysis artifact must reference the supplied collection run'
      })
    }
    if (input.artifact.analysisRunId !== input.analysisRunId) {
      context.addIssue({
        code: 'custom',
        path: ['artifact', 'analysisRunId'],
        message: 'Analysis artifact must reference the supplied analysis run'
      })
    }
    if (input.artifact.testOnly) {
      context.addIssue({
        code: 'custom',
        path: ['artifact', 'testOnly'],
        message: 'Test-only analysis artifacts cannot cross the production persistence boundary'
      })
    }
  })

export const productionAnalysisSnapshotSchema = z
  .object({
    mode: z.literal('production-analysis'),
    analysisRunId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    artifactId: appseaIdentifierSchema,
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    analysisVersion: z.literal('production-analysis-v1'),
    policySnapshots: z
      .array(
        z
          .object({
            sourceId: appseaIdentifierSchema,
            policyVersion: z.string().min(1).max(80),
            contentHash: z
              .string()
              .length(64)
              .regex(/^[a-f0-9]{64}$/),
            reviewId: appseaIdentifierSchema
          })
          .strict()
      )
      .min(1)
      .max(16),
    seedReviewId: appseaIdentifierSchema,
    seedContentHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    opportunityId: appseaIdentifierSchema,
    scoreSnapshotId: appseaIdentifierSchema,
    reportId: appseaIdentifierSchema,
    planPackageId: appseaIdentifierSchema,
    complaintCount: z.number().int().nonnegative(),
    clusterCount: z.number().int().nonnegative(),
    competitorCount: z.number().int().nonnegative(),
    coverageGaps: z.array(z.string().max(500)).max(500),
    warnings: z.array(z.string().max(500)).max(500),
    capturedAt: z.string().datetime()
  })
  .strict()

export const productionAnalysisResultSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    artifactId: appseaIdentifierSchema,
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    opportunityId: appseaIdentifierSchema,
    scoreSnapshotId: appseaIdentifierSchema,
    reportId: appseaIdentifierSchema,
    planPackageId: appseaIdentifierSchema,
    artifactObjectRef: objectReferenceSchema,
    reportObjectRef: objectReferenceSchema,
    planObjectRef: objectReferenceSchema,
    state: z.literal('completed'),
    availabilityState: productionAnalysisAvailabilitySchema,
    completedAt: z.string().datetime(),
    replayed: z.boolean()
  })
  .strict()
  .superRefine((result, context) => {
    const expectedKinds = [
      {
        path: 'artifactObjectRef',
        reference: result.artifactObjectRef,
        kind: 'workflow-artifact' as const
      },
      { path: 'reportObjectRef', reference: result.reportObjectRef, kind: 'report-json' as const },
      { path: 'planObjectRef', reference: result.planObjectRef, kind: 'plan-package' as const }
    ]
    expectedKinds.forEach(({ path, reference, kind }) => {
      if (reference.kind !== kind) {
        context.addIssue({
          code: 'custom',
          path: [path, 'kind'],
          message: `Production analysis ${String(path)} must use the ${kind} object kind`
        })
      }
    })
    if (result.availabilityState === 'active') {
      const deleted = [result.artifactObjectRef, result.reportObjectRef, result.planObjectRef].some(
        (reference) => reference.deletionState !== 'active'
      )
      if (deleted) {
        context.addIssue({
          code: 'custom',
          path: ['availabilityState'],
          message: 'Active analysis results cannot reference deleted objects'
        })
      }
    }
  })

/**
 * Approval state for the object-backed report and plan linked to a completed
 * production analysis. The analysis payload itself is immutable; governance
 * transitions live on the report and plan projections and are read alongside
 * the output so private clients never have to infer state from defaults.
 */
export const productionAnalysisGovernanceSchema = z
  .object({
    reportApprovalState: z.enum(['draft', 'reviewed', 'approved', 'withdrawn']),
    planApprovalState: z.enum(['unreviewed', 'reviewed', 'approved', 'withdrawn'])
  })
  .strict()

export const productionAnalysisReadModelSchema = z
  .object({
    result: productionAnalysisResultSchema,
    artifact: productionResearchArtifactSchema,
    report: opportunityReportSchema,
    planPackage: planPackageSchema,
    governance: productionAnalysisGovernanceSchema
  })
  .strict()

export const productionAnalysisHandoffStateSchema = z.enum([
  'queued',
  'dispatching',
  'started',
  'failed'
])

export const productionAnalysisHandoffFailureCodeSchema = z.enum([
  'analysis_not_ready',
  'seed_not_approved',
  'handoff_dispatch_failed'
])

/** Private, identifier-only status for the durable post-collection bridge. */
export const productionAnalysisHandoffReadModelSchema = z
  .object({
    handoffId: appseaIdentifierSchema,
    collectionWorkflowId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    seedReviewId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    state: productionAnalysisHandoffStateSchema,
    attemptCount: z.number().int().nonnegative().max(100),
    workflowId: appseaIdentifierSchema.nullable(),
    failureCode: productionAnalysisHandoffFailureCodeSchema.nullable(),
    failureSummary: z.string().min(1).max(240).nullable(),
    requestedAt: z.string().datetime(),
    nextAttemptAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime()
  })
  .strict()

export const productionCollectionResultSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    artifactId: appseaIdentifierSchema,
    sourceId: appseaIdentifierSchema,
    policyVersion: z.string().min(1).max(80),
    sourceItemCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    complaintCount: z.number().int().nonnegative(),
    deletionCount: z.number().int().nonnegative(),
    /** Settled source cost for this request, recorded in micro-USD. */
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000).default(0),
    manualImportBatchId: appseaIdentifierSchema.nullable().optional(),
    recollectionTombstoneId: appseaIdentifierSchema.nullable().default(null),
    coverageGaps: z.array(z.string()),
    warnings: z.array(z.string()),
    state: z.literal('completed'),
    completedAt: z.string().datetime(),
    replayed: z.boolean()
  })
  .strict()

export const productionCollectionSnapshotSchema = z
  .object({
    mode: z.literal('production-collection'),
    artifactId: appseaIdentifierSchema,
    requestHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    sourceId: appseaIdentifierSchema,
    policyVersion: z.string().min(1).max(80),
    query: z.string().max(500),
    limit: z.number().int().min(1).max(5_000),
    purpose: z.string().min(1).max(120),
    requestedDisplayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only']),
    manualImportBatchId: appseaIdentifierSchema.nullable().optional(),
    sourceItemCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    complaintCount: z.number().int().nonnegative(),
    deletionCount: z.number().int().nonnegative(),
    /** Settled source cost for this request, recorded in micro-USD. */
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000).default(0),
    recollectionTombstoneId: appseaIdentifierSchema.nullable().default(null),
    coverageGaps: z.array(z.string()),
    warnings: z.array(z.string()),
    capturedAt: z.string().datetime()
  })
  .strict()

export const productionCollectionEvidenceReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    complaintId: appseaIdentifierSchema,
    reviewState: complaintReviewStateSchema,
    sourceItemId: appseaIdentifierSchema,
    sourceRecordId: z.string().min(1).max(240),
    canonicalLocator: canonicalLocatorSchema.nullable(),
    text: z.string().max(20_000).nullable(),
    language: z.string().min(2).max(16),
    product: z.string().min(1),
    company: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
    analysis: complaintAnalysisSchema,
    synthetic: z.literal(false),
    redacted: z.boolean(),
    redactedFields: z.array(evidenceRedactionFieldSchema).max(6).optional(),
    allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only']),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable()
  })
  .strict()

export const productionCollectionReadModelSchema = z
  .object({
    result: productionCollectionResultSchema,
    evidence: z.array(productionCollectionEvidenceReadModelSchema).max(5_000),
    sourceCoverage: z.array(reportSourceCoverageSchema).max(16),
    analysisHandoff: productionAnalysisHandoffReadModelSchema.nullable()
  })
  .strict()

/** Internal server-side handoff from persisted collection rows to analysis. */
export const productionCollectionAnalysisSourceSchema = z
  .object({
    request: productionCollectionRequestSchema,
    collectionArtifactId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    policySnapshot: productionPolicySnapshotSchema,
    complaints: z.array(productionAnalysisComplaintSchema).max(5_000),
    analyses: z.array(complaintAnalysisSchema).max(5_000).optional(),
    deletions: z.array(sourceDeletionEventSchema).max(5_000),
    coverageGaps: z.array(z.string().max(500)).max(500),
    warnings: z.array(z.string().max(500)).max(500)
  })
  .strict()

export const fixturePersistenceReadModelSchema = z.object({
  result: fixturePersistenceResultSchema,
  artifact: fixtureResearchArtifactSchema,
  planPackage: planPackageSchema
})

export const workflowJobStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'budget_rejected'
])

export const workflowJobCheckpointSchema = z.enum([
  'accepted',
  'initialized',
  'inspected',
  'budget_approved',
  'persisting',
  'persisted',
  'completed',
  'failed',
  'canceled',
  'budget_rejected'
])

/** Safe private status projection for an asynchronous production analysis. */
export const productionAnalysisStatusReadModelSchema = z
  .object({
    analysisRunId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema.nullable(),
    state: productionAnalysisRunStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    activityAttempts: z.number().int().nonnegative().max(10),
    activityAttemptHistory: productionAnalysisActivityAttemptHistorySchema.default([]),
    availabilityState: productionAnalysisAvailabilitySchema,
    opportunityId: appseaIdentifierSchema.nullable(),
    opportunitySlug: opportunitySlugSchema.nullable(),
    failureCode: productionAnalysisFailureCodeSchema.nullable(),
    failureSummary: z.string().min(1).max(500).nullable(),
    requestedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable()
  })
  .strict()

export const workflowFailureCodeSchema = z.enum([
  'source_item_budget_exceeded',
  'cost_budget_exceeded',
  'activity_failed',
  'workflow_canceled'
])

export const workflowIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z][a-z0-9_:-]*$/)

export const workflowTaskQueueSchema = z.literal('appsea-research-v1')

export const fixtureResearchWorkflowStartRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    workflowVersion: z.literal('fixture-research-v1'),
    fixtureAt: z.string().datetime(),
    budget: researchJobBudgetSchema,
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

export const productionCollectionWorkflowStartRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    workflowVersion: z.literal('production-collection-v1'),
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    query: z.string().max(500),
    limit: z.number().int().min(1).max(5_000),
    purpose: z.string().min(1).max(120),
    requestedDisplayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only']),
    budget: researchJobBudgetSchema,
    requestedAt: z.string().datetime(),
    /** Identifier-only link to a previously staged owner-authorized import. */
    manualImportBatchId: appseaIdentifierSchema.optional(),
    /** Identifier-only link for an explicitly reviewed re-collection. */
    recollectionTombstoneId: appseaIdentifierSchema.optional(),
    /** Optional reviewed seed that enables an automatic analysis handoff. */
    analysisSeedReviewId: appseaIdentifierSchema.optional(),
    requestedBy: workflowActorSchema.optional()
  })
  .strict()
  .superRefine((request, context) => {
    if (request.recollectionTombstoneId && request.limit !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'A tombstone-bound re-collection must fetch exactly one source record'
      })
    }
    if (request.manualImportBatchId && request.sourceId !== 'manual-owner-import') {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Manual import batches are valid only for the owner-import source'
      })
    }
    if (request.sourceId === 'manual-owner-import' && !request.manualImportBatchId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Owner-import collection requires a staged manual import batch'
      })
    }
    if (request.manualImportBatchId && request.recollectionTombstoneId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'A manual import cannot be combined with tombstone re-collection'
      })
    }
  })

/** User-facing request for a bounded, policy-gated source snapshot reconciliation. */
export const sourceSnapshotReconciliationStartRequestSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    idempotencyKey: z.string().min(16).max(200),
    pageSize: z.number().int().min(1).max(1_000),
    maxRecords: z.number().int().min(1).max(1_000),
    requestedAt: z.string().datetime()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.maxRecords < input.pageSize) {
      context.addIssue({
        code: 'custom',
        path: ['maxRecords'],
        message: 'maxRecords must be at least pageSize'
      })
    }
  })

/** Internal, identifier-only decision from the authenticated production ingress gate. */
export const productionWorkflowAdmissionDecisionSchema = z
  .object({
    decision: z.enum(['admitted', 'replayed', 'rate_limited', 'concurrency_limited']),
    retryAfterSeconds: z.number().int().nonnegative().max(86_400),
    reservationExpiresAt: z.string().datetime()
  })
  .strict()

/** Internal decision returned by the policy-bound source collection lease. */
export const sourceCollectionLeaseDecisionSchema = z.enum([
  'acquired',
  'replayed',
  'expired',
  'released',
  'revoked'
])

export const sourceCollectionLeaseResultSchema = z
  .object({
    decision: sourceCollectionLeaseDecisionSchema,
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  })
  .strict()

const productionCollectionWorkflowInputBaseSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyDigest: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    workflowVersion: z.literal('production-collection-v1'),
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    query: z.string().max(500),
    limit: z.number().int().min(1).max(5_000),
    purpose: z.string().min(1).max(120),
    requestedDisplayMode: z.enum(['excerpt', 'metadata-only', 'aggregate-only']),
    budget: researchJobBudgetSchema,
    requestedAt: z.string().datetime(),
    /** Identifier-only link to a previously staged owner-authorized import. */
    manualImportBatchId: appseaIdentifierSchema.optional(),
    recollectionTombstoneId: appseaIdentifierSchema.optional(),
    analysisSeedReviewId: appseaIdentifierSchema.optional(),
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

export const productionCollectionWorkflowInputSchema =
  productionCollectionWorkflowInputBaseSchema.superRefine((input, context) => {
    if (input.recollectionTombstoneId && input.limit !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'A tombstone-bound re-collection must fetch exactly one source record'
      })
    }
    if (input.manualImportBatchId && input.sourceId !== 'manual-owner-import') {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Manual import batches are valid only for the owner-import source'
      })
    }
    if (input.sourceId === 'manual-owner-import' && !input.manualImportBatchId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'Owner-import collection requires a staged manual import batch'
      })
    }
    if (input.manualImportBatchId && input.recollectionTombstoneId) {
      context.addIssue({
        code: 'custom',
        path: ['manualImportBatchId'],
        message: 'A manual import cannot be combined with tombstone re-collection'
      })
    }
  })

export const productionCollectionWorkflowHashMaterialSchema =
  productionCollectionWorkflowInputBaseSchema
    .omit({ inputHash: true })
    .superRefine((input, context) => {
      if (input.recollectionTombstoneId && input.limit !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['limit'],
          message: 'A tombstone-bound re-collection must fetch exactly one source record'
        })
      }
      if (input.manualImportBatchId && input.sourceId !== 'manual-owner-import') {
        context.addIssue({
          code: 'custom',
          path: ['manualImportBatchId'],
          message: 'Manual import batches are valid only for the owner-import source'
        })
      }
      if (input.sourceId === 'manual-owner-import' && !input.manualImportBatchId) {
        context.addIssue({
          code: 'custom',
          path: ['manualImportBatchId'],
          message: 'Owner-import collection requires a staged manual import batch'
        })
      }
      if (input.manualImportBatchId && input.recollectionTombstoneId) {
        context.addIssue({
          code: 'custom',
          path: ['manualImportBatchId'],
          message: 'A manual import cannot be combined with tombstone re-collection'
        })
      }
    })

export const productionCollectionWorkflowExecutionMetadataSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    workflowType: z.literal('productionCollectionWorkflow'),
    workflowVersion: z.literal('production-collection-v1'),
    taskQueue: workflowTaskQueueSchema
  })
  .strict()

export const productionCollectionWorkflowCompletedResultSchema = z
  .object({
    state: z.literal('completed'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    persistence: productionCollectionResultSchema,
    sourceItemsProcessed: z.number().int().nonnegative().max(5_000),
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    activityAttempts: z.number().int().positive().max(10)
  })
  .strict()

export const productionCollectionWorkflowBudgetRejectedResultSchema = z
  .object({
    state: z.literal('budget_rejected'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    failureCode: z.enum(['source_item_budget_exceeded', 'cost_budget_exceeded']),
    failureSummary: z.string().min(1).max(240),
    sourceItemsInspected: z.number().int().nonnegative().max(5_000),
    estimatedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000)
  })
  .strict()

export const productionCollectionWorkflowResultSchema = z.discriminatedUnion('state', [
  productionCollectionWorkflowCompletedResultSchema,
  productionCollectionWorkflowBudgetRejectedResultSchema
])

export const productionCollectionWorkflowStatusSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    state: workflowJobStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    activityAttempts: z.number().int().nonnegative().max(10),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    analysisSeedReviewId: appseaIdentifierSchema.nullable(),
    recollectionTombstoneId: appseaIdentifierSchema.nullable(),
    result: productionCollectionWorkflowResultSchema.nullable()
  })
  .strict()

/** Safe private read model for campaign collection history. */
export const researchCampaignRunReadModelSchema = z
  .object({
    campaignId: appseaIdentifierSchema,
    workflowId: workflowIdSchema,
    runId: appseaIdentifierSchema,
    sourceId: appseaIdentifierSchema,
    policyVersion: z.string().min(1).max(80),
    state: workflowJobStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    activityAttempts: z.number().int().nonnegative().max(10),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    analysisSeedReviewId: appseaIdentifierSchema.nullable(),
    recollectionTombstoneId: appseaIdentifierSchema.nullable(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    cancellationRequestedAt: z.string().datetime().nullable().default(null)
  })
  .strict()

/** Bounded cursor used by private campaign history pages. */
export const campaignHistoryCursorSchema = z
  .object({
    version: z.literal(1),
    requestedAt: z.string().datetime(),
    itemId: z
      .string()
      .min(3)
      .max(240)
      .regex(/^[a-z][a-z0-9_:-]*$/)
  })
  .strict()

/** Query boundary for authenticated campaign history reads. */
export const campaignHistoryPageQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
  })
  .strict()

export const researchCampaignRunHistoryPageSchema = z
  .object({
    data: z.array(researchCampaignRunReadModelSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable()
  })
  .strict()

/** Scalar metadata safely projected from the immutable audit ledger. */
export const auditEventMetadataSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])
  )
  .refine((value) => Object.keys(value).length <= 24, {
    message: 'Audit metadata has too many fields'
  })

export const auditEventActorTypeSchema = z.enum(['user', 'service', 'system'])

const auditEventActionSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_.:-]*$/)

/** Private audit history projection; raw source payloads are never included. */
export const auditEventReadModelSchema = z
  .object({
    auditEventId: appseaIdentifierSchema,
    actorType: auditEventActorTypeSchema,
    actorId: appseaIdentifierSchema,
    action: auditEventActionSchema,
    targetType: auditEventActionSchema,
    targetId: z.string().min(1).max(240),
    correlationId: z.string().min(1).max(240),
    metadata: auditEventMetadataSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

/** Opaque cursor payload for descending audit history. */
export const auditEventHistoryCursorSchema = z
  .object({
    version: z.literal(1),
    occurredAt: z.string().datetime(),
    itemId: appseaIdentifierSchema
  })
  .strict()

/** Bounded query for an authenticated workspace audit-history read. */
export const auditEventHistoryPageQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
  })
  .strict()

export const auditEventHistoryPageSchema = z
  .object({
    data: z.array(auditEventReadModelSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable()
  })
  .strict()

/** Durable parent state for a multi-source campaign collection request. */
export const researchCampaignOrchestrationStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'canceled'
])

/** Durable state for one policy-gated source child in an orchestration. */
export const researchCampaignOrchestrationSourceStateSchema = z.enum([
  'queued',
  'dispatching',
  'started',
  'completed',
  'failed',
  'canceled'
])

/** Fixed, secret-free failure reasons exposed by the private orchestration read model. */
export const researchCampaignOrchestrationFailureCodeSchema = z.enum([
  'source_policy_denied',
  'source_unsupported',
  'input_invalid',
  'admission_rate_limited',
  'admission_concurrency_limited',
  'temporal_unavailable',
  'dispatch_failed',
  'attempts_exhausted',
  'child_failed',
  'canceled'
])

export const researchCampaignOrchestrationSourceReadModelSchema = z
  .object({
    sourceId: appseaIdentifierSchema,
    childRunId: appseaIdentifierSchema,
    state: researchCampaignOrchestrationSourceStateSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/)
      .nullable(),
    workflowId: workflowIdSchema.nullable(),
    attemptCount: z.number().int().nonnegative().max(10),
    failureCode: researchCampaignOrchestrationFailureCodeSchema.nullable(),
    failureSummary: z.string().min(1).max(240).nullable(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable()
  })
  .superRefine((source, context) => {
    const terminal = ['completed', 'failed', 'canceled'].includes(source.state)
    if (terminal !== (source.finishedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Terminal orchestration sources require a finish timestamp'
      })
    }
    if (source.state === 'started' && (source.workflowId === null || source.startedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['workflowId'],
        message: 'Started orchestration sources require a workflow and start timestamp'
      })
    }
    if (source.startedAt !== null && source.startedAt < source.requestedAt) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'Orchestration source start cannot precede its request'
      })
    }
    if (source.finishedAt !== null && source.finishedAt < source.requestedAt) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Orchestration source finish cannot precede its request'
      })
    }
    if (source.state === 'completed' && source.workflowId === null) {
      context.addIssue({
        code: 'custom',
        path: ['workflowId'],
        message: 'Completed orchestration sources require a workflow identity'
      })
    }
    const terminalFailure = source.state === 'failed' || source.state === 'canceled'
    const hasFailure = source.failureCode !== null && source.failureSummary !== null
    if (terminalFailure !== hasFailure && source.state !== 'queued') {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed or canceled orchestration sources require fixed failure metadata'
      })
    }
    if ((source.failureCode === null) !== (source.failureSummary === null)) {
      context.addIssue({
        code: 'custom',
        path: ['failureSummary'],
        message: 'Orchestration source failure metadata must be provided together'
      })
    }
  })
  .strict()

/** Safe private read model for a queued multi-source campaign run. */
export const researchCampaignOrchestrationReadModelSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    orchestrationId: appseaIdentifierSchema,
    state: researchCampaignOrchestrationStateSchema,
    sourceCount: z.number().int().positive().max(16),
    completedSourceCount: z.number().int().nonnegative().max(16),
    failedSourceCount: z.number().int().nonnegative().max(16),
    analysisSeedReviewId: appseaIdentifierSchema.nullable(),
    failureCode: researchCampaignOrchestrationFailureCodeSchema.nullable(),
    failureSummary: z.string().min(1).max(240).nullable(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    /** Durable cancellation intent; terminal state follows child reconciliation. */
    cancellationRequestedAt: z.string().datetime().nullable().default(null),
    sources: z.array(researchCampaignOrchestrationSourceReadModelSchema).min(1).max(16)
  })
  .superRefine((orchestration, context) => {
    if (orchestration.sources.length !== orchestration.sourceCount) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Orchestration source count must match its child list'
      })
    }
    if (
      orchestration.completedSourceCount + orchestration.failedSourceCount >
      orchestration.sourceCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedSourceCount'],
        message: 'Orchestration terminal source counters cannot exceed source count'
      })
    }
    const terminal = ['completed', 'partial', 'failed', 'canceled'].includes(orchestration.state)
    if (terminal !== (orchestration.finishedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Terminal orchestrations require a finish timestamp'
      })
    }
    if (orchestration.startedAt !== null && orchestration.startedAt < orchestration.requestedAt) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'Orchestration start cannot precede its request'
      })
    }
    if (orchestration.finishedAt !== null && orchestration.finishedAt < orchestration.requestedAt) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Orchestration finish cannot precede its request'
      })
    }
    if (orchestration.state === 'completed') {
      if (
        orchestration.completedSourceCount !== orchestration.sourceCount ||
        orchestration.failedSourceCount !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['completedSourceCount'],
          message: 'Completed orchestrations require every source to complete'
        })
      }
    }
    if (orchestration.state === 'failed' && orchestration.failedSourceCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['failedSourceCount'],
        message: 'Failed orchestrations require at least one failed source'
      })
    }
    if (
      ['partial', 'failed', 'canceled'].includes(orchestration.state) !==
      (orchestration.failureCode !== null && orchestration.failureSummary !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Terminal non-success orchestrations require fixed failure metadata'
      })
    }
  })
  .strict()

export const researchCampaignOrchestrationHistoryPageSchema = z
  .object({
    data: z.array(researchCampaignOrchestrationReadModelSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable()
  })
  .strict()

/** Result of an authenticated multi-source orchestration cancellation request. */
export const researchCampaignOrchestrationCancelResultSchema = z
  .object({
    orchestrationId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    state: z.enum(['requested', 'already_terminal']),
    cancellationRequestedAt: z.string().datetime().nullable(),
    activeWorkflowCount: z.number().int().nonnegative().max(16)
  })
  .strict()

/** Result of an authenticated one-source production workflow cancellation request. */
export const productionCollectionWorkflowCancelResultSchema = z
  .object({
    workflowId: workflowIdSchema,
    campaignId: appseaIdentifierSchema,
    state: z.enum(['requested', 'already_terminal']),
    cancellationRequestedAt: z.string().datetime().nullable()
  })
  .strict()

export const productionCollectionWorkflowJobInitializeInputSchema = z
  .object({
    execution: productionCollectionWorkflowExecutionMetadataSchema,
    input: productionCollectionWorkflowInputSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const productionCollectionWorkflowCheckpointWriteSchema = z
  .object({
    execution: productionCollectionWorkflowExecutionMetadataSchema,
    workspaceId: appseaIdentifierSchema,
    checkpointKey: appseaIdentifierSchema,
    sequenceNo: z.number().int().positive().max(1_000),
    checkpoint: workflowJobCheckpointSchema,
    state: workflowJobStateSchema,
    activityAttempt: z.number().int().positive().max(10),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    occurredAt: z.string().datetime()
  })
  .strict()

export const persistProductionCollectionWorkflowActivityInputSchema = z
  .object({
    execution: productionCollectionWorkflowExecutionMetadataSchema,
    input: productionCollectionWorkflowInputSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const productionCollectionWorkflowPersistenceActivityResultSchema = z
  .object({
    persistence: productionCollectionResultSchema,
    sourceItemsProcessed: z.number().int().nonnegative().max(5_000),
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    activityAttempt: z.number().int().positive().max(10)
  })
  .strict()

export const productionCollectionWorkflowCompletionInputSchema = z
  .object({
    execution: productionCollectionWorkflowExecutionMetadataSchema,
    workspaceId: appseaIdentifierSchema,
    result: productionCollectionWorkflowPersistenceActivityResultSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const productionCollectionWorkflowTerminationInputSchema = z
  .object({
    execution: productionCollectionWorkflowExecutionMetadataSchema,
    input: productionCollectionWorkflowInputSchema,
    state: z.enum(['failed', 'canceled', 'budget_rejected']),
    checkpoint: z.enum(['failed', 'canceled', 'budget_rejected']),
    failureCode: workflowFailureCodeSchema,
    failureSummary: z.string().min(1).max(240),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    occurredAt: z.string().datetime()
  })
  .strict()

/**
 * Durable post-collection analysis workflow. Only identifiers and immutable
 * lineage references cross the Temporal boundary; the worker reconstructs the
 * policy-validated artifact inside an activity from workspace-bound rows.
 */
export const productionAnalysisWorkflowStartRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    workflowVersion: z.literal('production-analysis-v2'),
    requestedAt: z.string().datetime(),
    seedReviewId: appseaIdentifierSchema,
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

/**
 * Non-sensitive Temporal memo written on new production-analysis executions.
 * The memo lets an operator distinguish identifier-only v2 histories from
 * older executions without decoding workflow arguments or history payloads.
 */
export const productionAnalysisWorkflowHistoryMemoSchema = z
  .object({
    schemaVersion: z.literal('appsea-temporal-history-memo-v1'),
    workflowType: z.literal('productionAnalysisWorkflow'),
    workflowVersion: z.literal('production-analysis-v2'),
    historyClass: z.literal('identifier-only')
  })
  .strict()

const productionAnalysisHistoryDispositionSchema = z.enum(['retained', 'drained'])

/** A reviewed operator disposition for one legacy Temporal execution. */
export const productionAnalysisHistoryManifestEntrySchema = z
  .object({
    workflowId: workflowIdSchema,
    runId: z.string().uuid(),
    disposition: productionAnalysisHistoryDispositionSchema,
    reviewedAt: z.string().datetime(),
    approvalReference: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:/#-]+$/),
    retentionUntil: z.string().datetime().nullable()
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.disposition === 'retained' && entry.retentionUntil === null) {
      context.addIssue({
        code: 'custom',
        path: ['retentionUntil'],
        message: 'A retained legacy history requires an explicit retention deadline'
      })
    }
    if (entry.disposition === 'drained' && entry.retentionUntil !== null) {
      context.addIssue({
        code: 'custom',
        path: ['retentionUntil'],
        message: 'A drained legacy history cannot carry a future retention deadline'
      })
    }
  })

/**
 * An external, reviewed inventory used by the bounded history checker. It is
 * evidence of operator disposition only; it never authorizes deletion.
 */
export const productionAnalysisHistoryManifestSchema = z
  .object({
    schemaVersion: z.literal('appsea-temporal-legacy-history-v1'),
    reviewedAt: z.string().datetime(),
    approvalReference: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:/#-]+$/),
    entries: z.array(productionAnalysisHistoryManifestEntrySchema).max(1_000)
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = new Set<string>()
    for (const entry of manifest.entries) {
      const key = `${entry.workflowId}\u0000${entry.runId}`
      if (keys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Legacy history manifest entries must be unique by workflow and run'
        })
        break
      }
      keys.add(key)
    }
  })

/**
 * Private, human-initiated bridge from a completed collection to the durable
 * analysis workflow. The server reads the collection, approved policy
 * lineage, and approved seed envelope; callers provide only the seed-review
 * identifier. Seed content never crosses this start boundary from a caller.
 */
export const productionAnalysisReviewStartRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    idempotencyKey: z.string().min(16).max(200),
    requestedAt: z.string().datetime(),
    seedReviewId: appseaIdentifierSchema
  })
  .strict()

export const productionAnalysisWorkflowInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    collectionRunId: appseaIdentifierSchema,
    analysisRunId: appseaIdentifierSchema,
    idempotencyDigest: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    workflowVersion: z.literal('production-analysis-v2'),
    requestedAt: z.string().datetime(),
    seedReviewId: appseaIdentifierSchema,
    requestedBy: workflowActorSchema
  })
  .strict()

export const productionAnalysisWorkflowExecutionMetadataSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    workflowType: z.literal('productionAnalysisWorkflow'),
    workflowVersion: z.literal('production-analysis-v2'),
    taskQueue: workflowTaskQueueSchema
  })
  .strict()

export const productionAnalysisWorkflowCompletedResultSchema = z
  .object({
    state: z.literal('completed'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    persistence: productionAnalysisResultSchema,
    activityAttempts: z.number().int().positive().max(10)
  })
  .strict()

export const productionAnalysisWorkflowFailedResultSchema = z
  .object({
    state: z.literal('failed'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    failureCode: productionAnalysisFailureCodeSchema,
    failureSummary: z.string().min(1).max(500)
  })
  .strict()

export const productionAnalysisWorkflowResultSchema = z.discriminatedUnion('state', [
  productionAnalysisWorkflowCompletedResultSchema,
  productionAnalysisWorkflowFailedResultSchema
])

export const productionAnalysisWorkflowStatusSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    state: workflowJobStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    activityAttempts: z.number().int().nonnegative().max(10),
    result: productionAnalysisWorkflowResultSchema.nullable()
  })
  .strict()

export const persistProductionAnalysisWorkflowActivityInputSchema = z
  .object({
    execution: productionAnalysisWorkflowExecutionMetadataSchema,
    input: productionAnalysisWorkflowInputSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

/**
 * The analysis activity returns its durable persistence result together with
 * the Temporal activity attempt that produced it. The attempt is operational
 * metadata, not part of the idempotency input hash.
 */
export const productionAnalysisWorkflowPersistenceActivityResultSchema = z
  .object({
    persistence: productionAnalysisResultSchema,
    activityAttempt: z.number().int().positive().max(10)
  })
  .strict()

export const fixtureResearchWorkflowInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    campaignId: appseaIdentifierSchema,
    runId: appseaIdentifierSchema,
    idempotencyDigest: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    workflowVersion: z.literal('fixture-research-v1'),
    fixtureAt: z.string().datetime(),
    budget: researchJobBudgetSchema,
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

export const fixtureResearchWorkflowHashMaterialSchema = fixtureResearchWorkflowInputSchema.omit({
  inputHash: true
})

export const workflowExecutionMetadataSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    workflowType: z.literal('fixtureResearchWorkflow'),
    workflowVersion: z.literal('fixture-research-v1'),
    taskQueue: workflowTaskQueueSchema
  })
  .strict()

export const fixtureResearchInspectionSchema = z
  .object({
    sourceItemCount: z.number().int().nonnegative().max(5_000),
    estimatedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000)
  })
  .strict()

export const workflowJobInitializeInputSchema = z
  .object({
    execution: workflowExecutionMetadataSchema,
    input: fixtureResearchWorkflowInputSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const workflowJobCheckpointWriteSchema = z
  .object({
    execution: workflowExecutionMetadataSchema,
    workspaceId: appseaIdentifierSchema,
    checkpointKey: appseaIdentifierSchema,
    sequenceNo: z.number().int().positive().max(1_000),
    checkpoint: workflowJobCheckpointSchema,
    state: workflowJobStateSchema,
    activityAttempt: z.number().int().positive().max(10),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    occurredAt: z.string().datetime()
  })
  .strict()

export const persistFixtureResearchActivityInputSchema = z
  .object({
    execution: workflowExecutionMetadataSchema,
    input: fixtureResearchWorkflowInputSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const fixtureResearchPersistenceActivityResultSchema = z
  .object({
    persistence: fixturePersistenceResultSchema,
    sourceItemsProcessed: z.number().int().nonnegative().max(5_000),
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    activityAttempt: z.number().int().positive().max(10)
  })
  .strict()

export const workflowJobCompletionInputSchema = z
  .object({
    execution: workflowExecutionMetadataSchema,
    workspaceId: appseaIdentifierSchema,
    result: fixtureResearchPersistenceActivityResultSchema,
    occurredAt: z.string().datetime()
  })
  .strict()

export const workflowJobTerminationInputSchema = z
  .object({
    execution: workflowExecutionMetadataSchema,
    input: fixtureResearchWorkflowInputSchema,
    state: z.enum(['failed', 'canceled', 'budget_rejected']),
    checkpoint: z.enum(['failed', 'canceled', 'budget_rejected']),
    failureCode: workflowFailureCodeSchema,
    failureSummary: z.string().min(1).max(240),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    occurredAt: z.string().datetime()
  })
  .strict()

export const fixtureResearchWorkflowCompletedResultSchema = z
  .object({
    state: z.literal('completed'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    persistence: fixturePersistenceResultSchema,
    sourceItemsProcessed: z.number().int().nonnegative().max(5_000),
    costMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    activityAttempts: z.number().int().positive().max(10)
  })
  .strict()

export const fixtureResearchWorkflowBudgetRejectedResultSchema = z
  .object({
    state: z.literal('budget_rejected'),
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    failureCode: z.enum(['source_item_budget_exceeded', 'cost_budget_exceeded']),
    failureSummary: z.string().min(1).max(240),
    sourceItemsInspected: z.number().int().nonnegative().max(5_000),
    estimatedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000)
  })
  .strict()

export const fixtureResearchWorkflowResultSchema = z.discriminatedUnion('state', [
  fixtureResearchWorkflowCompletedResultSchema,
  fixtureResearchWorkflowBudgetRejectedResultSchema
])

export const fixtureResearchWorkflowStatusSchema = z
  .object({
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    state: workflowJobStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    activityAttempts: z.number().int().nonnegative().max(10),
    consumedSourceItems: z.number().int().nonnegative().max(5_000),
    consumedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    result: fixtureResearchWorkflowResultSchema.nullable()
  })
  .strict()

export const workflowJobReadModelSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    workflowId: workflowIdSchema,
    temporalFirstExecutionRunId: z.string().uuid(),
    workflowType: z.literal('fixtureResearchWorkflow'),
    workflowVersion: z.literal('fixture-research-v1'),
    taskQueue: workflowTaskQueueSchema,
    campaignId: appseaIdentifierSchema,
    requestedResearchRunId: appseaIdentifierSchema,
    requestedBy: workflowActorSchema,
    idempotencyDigest: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    state: workflowJobStateSchema,
    checkpoint: workflowJobCheckpointSchema,
    budget: researchJobBudgetSchema,
    consumedSourceItems: z.number().int().nonnegative(),
    consumedCostMicros: z.number().int().nonnegative(),
    activityAttempts: z.number().int().nonnegative(),
    persistedRunId: appseaIdentifierSchema.nullable(),
    opportunityId: appseaIdentifierSchema.nullable(),
    scoreSnapshotId: appseaIdentifierSchema.nullable(),
    planPackageId: appseaIdentifierSchema.nullable(),
    failureCode: workflowFailureCodeSchema.nullable(),
    failureSummary: z.string().max(240).nullable(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable()
  })
  .strict()

export const maintenanceJobIdSchema = appseaIdentifierSchema

export const maintenanceSchedulerNameSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9_-]+$/)

export const maintenanceSchedulerOwnerIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)

export const maintenanceSchedulerLeaseTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)

/**
 * Private identity carried from a scheduler lease into a service transaction.
 * This is deliberately not an API or telemetry payload: the lease token is
 * only useful to the database fence and must never be rendered or persisted.
 */
export const maintenanceSchedulerFenceSchema = z
  .object({
    schedulerName: maintenanceSchedulerNameSchema,
    ownerId: maintenanceSchedulerOwnerIdSchema,
    leaseToken: maintenanceSchedulerLeaseTokenSchema
  })
  .strict()

export const maintenanceSchedulerLeaseResultSchema = z
  .object({
    acquired: z.boolean(),
    leaseUntil: z.string().datetime().nullable(),
    leaseToken: maintenanceSchedulerLeaseTokenSchema.nullable()
  })
  .refine((value) => !value.acquired || value.leaseUntil !== null, {
    message: 'acquired leases must include an expiry'
  })
  .refine((value) => !value.acquired || value.leaseToken !== null, {
    message: 'acquired leases must include a token'
  })
  .strict()

export const maintenanceSchedulerRenewResultSchema = z
  .object({
    renewed: z.boolean(),
    leaseUntil: z.string().datetime().nullable()
  })
  .refine((value) => value.renewed === (value.leaseUntil !== null), {
    message: 'renewed leases must include an expiry'
  })
  .strict()

export const maintenanceSchedulerReleaseResultSchema = z.object({ released: z.boolean() }).strict()

export const maintenanceSchedulerRunIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^maintenance:[a-z0-9_:-]+$/)

export const maintenanceSchedulerRunStateSchema = z.enum(['contended', 'succeeded', 'failed'])

const maintenanceSchedulerCounterKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_]*$/)

export const maintenanceSchedulerCountersSchema = z
  .record(maintenanceSchedulerCounterKeySchema, z.number().int().nonnegative().max(10_000_000))
  .superRefine((counters, context) => {
    if (Object.keys(counters).length > 64) {
      context.addIssue({
        code: 'custom',
        message: 'Maintenance scheduler metrics may contain at most 64 counters'
      })
    }
  })

export const maintenanceSchedulerFailureCodeSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_:-]+$/)

export const maintenanceSchedulerRunMetricSchema = z
  .object({
    runId: maintenanceSchedulerRunIdSchema,
    schedulerName: maintenanceSchedulerNameSchema,
    ownerId: maintenanceSchedulerOwnerIdSchema,
    state: maintenanceSchedulerRunStateSchema,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative().max(86_400_000),
    failureCode: maintenanceSchedulerFailureCodeSchema.nullable(),
    counters: maintenanceSchedulerCountersSchema
  })
  .superRefine((metric, context) => {
    if (Date.parse(metric.finishedAt) < Date.parse(metric.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Maintenance scheduler run cannot finish before it starts'
      })
    }
    if (metric.state === 'failed' && metric.failureCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed maintenance scheduler runs require a fixed failure code'
      })
    }
    if (metric.state !== 'failed' && metric.failureCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Only failed maintenance scheduler runs may carry a failure code'
      })
    }
  })
  .strict()

export const maintenanceSchedulerRunPurgeInputSchema = z
  .object({
    before: z.string().datetime(),
    limit: z.number().int().min(1).max(10_000)
  })
  .strict()

export const maintenanceSchedulerRunReadModelSchema = maintenanceSchedulerRunMetricSchema

/**
 * Operational alerts are intentionally smaller than general worker events.
 * Only the redacted scalar envelope may cross the durable outbox boundary;
 * source text, credentials, arbitrary objects, and exception strings cannot
 * be persisted as alert payloads.
 */
const operationalAlertScalarSchema = z.union([
  z.string().max(240),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.boolean()
])

const operationalAlertAllowedKeys = new Set([
  'schemaVersion',
  'service',
  'observedAt',
  'event',
  'taskQueue',
  'schedulerName',
  'jobId',
  'workflowId',
  'state',
  'attempt',
  'workspacesScanned',
  'sourceItems',
  'snapshotPagesScanned',
  'snapshotSourceRecords',
  'snapshotDeletionsQueued',
  'snapshotCoverageGaps',
  'costMicros',
  'sessionsDeleted',
  'rateLimitsDeleted',
  'passwordResetTokensDeleted',
  'workspaceInvitationsDeleted',
  'mfaChallengesDeleted',
  'mfaEventsDeleted',
  'mfaPendingEnrollmentsDeleted',
  'passwordResetDeliveriesClaimed',
  'passwordResetDeliveriesSent',
  'passwordResetDeliveriesFailed',
  'workspaceInvitationDeliveriesClaimed',
  'workspaceInvitationDeliveriesSent',
  'workspaceInvitationDeliveriesFailed',
  'quotaReservationsExpired',
  'quotaReservationsPurged',
  'sourceQuotaReconciliationOpenCases',
  'sourceQuotaReconciliationOldestAgeSeconds',
  'sourceQuotaReconciliationTruncated',
  'productionAnalysisRecomputeJobs',
  'productionAnalysisRecomputeFailed',
  'productionAnalysisRecomputeBlocked',
  'productionAnalysisRecomputeStale',
  'productionAnalysisRecomputeOldestAgeSeconds',
  'productionAnalysisRecomputeTruncated',
  'workspaceCostAlertRows',
  'workspaceCostAlertEntries',
  'workspaceCostAlertTargetRows',
  'workspaceCostAlertUnsupportedRows',
  'workspaceCostAlertWorkspacesOverActual',
  'workspaceCostAlertWorkspacesOverEstimated',
  'workspaceCostAlertTruncated',
  'productionWorkflowAdmissionsPurged',
  'productionAnalysisAdmissionsPurged',
  'sourceCollectionLeasesPurged',
  'productionAnalysisObjectsPurged',
  'sourceSnapshotReconciliationsProcessed',
  'sourceSnapshotReconciliationsCompleted',
  'sourceSnapshotReconciliationsIncomplete',
  'sourceSnapshotReconciliationsFailed',
  'sourceSnapshotReconciliationsRetried',
  'sourceSnapshotCoverageGaps',
  'campaignRefreshClaims',
  'campaignRefreshDispatched',
  'campaignRefreshFailed',
  'campaignRefreshPolicyDenied',
  'campaignOrchestrationClaims',
  'campaignOrchestrationDispatched',
  'campaignOrchestrationFailed',
  'campaignOrchestrationPolicyDenied',
  'campaignOrchestrationReconciled',
  'productionWorkflowCancellationTargets',
  'productionWorkflowCancellationAttempted',
  'productionWorkflowCancellationDispatched',
  'productionWorkflowCancellationFailed',
  'retentionTombstonesQueued',
  'deletionTombstonesProcessed',
  'deletionObjectsAffected',
  'deletionOpportunitiesInvalidated',
  'recomputationJobsQueued',
  'maintenancePasses',
  'maintenanceFailures',
  'operationalAlertDeliveryClaimed',
  'operationalAlertDeliverySent',
  'operationalAlertDeliveryFailed',
  'operationalAlertDeliveryExhausted',
  'operationalAlertDeliveryPurged',
  'failureCode'
])

export const operationalAlertPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    service: z.literal('appsea-worker'),
    observedAt: z.string().datetime(),
    event: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z][a-z0-9_:-]+$/),
    taskQueue: z
      .string()
      .min(3)
      .max(160)
      .regex(/^[a-z][a-z0-9_-]+$/),
    schedulerName: maintenanceSchedulerNameSchema.optional(),
    jobId: appseaIdentifierSchema.optional(),
    workflowId: z
      .string()
      .min(3)
      .max(240)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
      .optional(),
    state: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_:-]*$/)
      .optional(),
    attempt: z.number().int().nonnegative().max(1_000_000).optional(),
    failureCode: maintenanceSchedulerFailureCodeSchema.optional()
  })
  .catchall(operationalAlertScalarSchema)
  .superRefine((payload, context) => {
    const keys = Object.keys(payload)
    if (keys.length > 80) {
      context.addIssue({
        code: 'custom',
        message: 'Operational alert payloads may contain at most 80 fields'
      })
    }
    for (const key of keys) {
      if (!operationalAlertAllowedKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Operational alert payload contains an unapproved field'
        })
      }
    }
  })

export const operationalAlertDeliveryIdSchema = z
  .string()
  .length(38)
  .regex(/^alert:[a-f0-9]{32}$/)

export const operationalAlertPayloadHashSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/)

export const operationalAlertOutboxStateSchema = z.enum(['pending', 'sending', 'sent', 'exhausted'])

export const operationalAlertOutboxLimits = {
  maxAttempts: 5,
  maxClaimBatch: 100,
  minClaimTtlSeconds: 30,
  maxClaimTtlSeconds: 3_600,
  maxFailureCodeLength: 80
} as const

export const operationalAlertOutboxEnqueueInputSchema = z
  .object({
    deliveryId: operationalAlertDeliveryIdSchema,
    payload: operationalAlertPayloadSchema,
    payloadHash: operationalAlertPayloadHashSchema,
    availableAt: z.string().datetime()
  })
  .strict()

export const operationalAlertOutboxClaimInputSchema = z
  .object({
    ownerId: maintenanceSchedulerOwnerIdSchema,
    claimId: z.string().uuid(),
    limit: z.number().int().min(1).max(operationalAlertOutboxLimits.maxClaimBatch),
    claimTtlSeconds: z
      .number()
      .int()
      .min(operationalAlertOutboxLimits.minClaimTtlSeconds)
      .max(operationalAlertOutboxLimits.maxClaimTtlSeconds)
  })
  .strict()

export const operationalAlertOutboxClaimSchema = z
  .object({
    deliveryId: operationalAlertDeliveryIdSchema,
    payload: operationalAlertPayloadSchema,
    attemptCount: z.number().int().min(1).max(operationalAlertOutboxLimits.maxAttempts),
    claimId: z.string().uuid(),
    claimedBy: maintenanceSchedulerOwnerIdSchema,
    claimExpiresAt: z.string().datetime()
  })
  .strict()

export const operationalAlertOutboxCompleteInputSchema = z
  .object({
    deliveryId: operationalAlertDeliveryIdSchema,
    ownerId: maintenanceSchedulerOwnerIdSchema,
    claimId: z.string().uuid(),
    sentAt: z.string().datetime()
  })
  .strict()

export const operationalAlertOutboxFailureInputSchema = z
  .object({
    deliveryId: operationalAlertDeliveryIdSchema,
    ownerId: maintenanceSchedulerOwnerIdSchema,
    claimId: z.string().uuid(),
    failureCode: maintenanceSchedulerFailureCodeSchema,
    retryAt: z.string().datetime()
  })
  .strict()

export const operationalAlertOutboxPurgeInputSchema = z
  .object({
    before: z.string().datetime(),
    limit: z.number().int().min(1).max(10_000)
  })
  .strict()

export const sourceMaintenanceInputSchema = z
  .object({
    jobId: maintenanceJobIdSchema,
    occurredAt: z.string().datetime(),
    quotaBatchSize: z.number().int().min(1).max(10_000),
    deletionBatchSize: z.number().int().min(1).max(1_000),
    retentionBatchSize: z.number().int().min(1).max(1_000),
    /** Maximum number of due snapshot jobs to resume across this pass. */
    snapshotReconciliationBatchSize: z.number().int().min(0).max(100),
    /** Maximum number of due private campaign refreshes to dispatch. */
    campaignRefreshBatchSize: z.number().int().min(0).max(100).default(0),
    /** Maximum number of queued multi-source campaign children to dispatch. */
    campaignOrchestrationBatchSize: z.number().int().min(0).max(100).default(0),
    /** Maximum number of one-source workflow cancellation intents to retry. */
    productionWorkflowCancellationBatchSize: z.number().int().min(0).max(100).default(1),
    quotaRetentionDays: z.number().int().min(1).max(3_650),
    workspaceId: appseaIdentifierSchema.nullable()
  })
  .strict()

export const sourceMaintenanceResultSchema = z
  .object({
    jobId: maintenanceJobIdSchema,
    quotaWorkspacesScanned: z.number().int().nonnegative().max(10_000),
    deletionWorkspacesScanned: z.number().int().nonnegative().max(10_000),
    quotaReservationsExpired: z.number().int().nonnegative().max(10_000),
    quotaReservationsPurged: z.number().int().nonnegative().max(10_000),
    productionWorkflowAdmissionsPurged: z.number().int().nonnegative().max(10_000),
    productionAnalysisAdmissionsPurged: z.number().int().nonnegative().max(10_000),
    sourceCollectionLeasesPurged: z.number().int().nonnegative().max(10_000),
    productionAnalysisObjectsPurged: z.number().int().nonnegative().max(10_000),
    sourceSnapshotReconciliationsProcessed: z.number().int().nonnegative().max(100),
    sourceSnapshotReconciliationsCompleted: z.number().int().nonnegative().max(100),
    sourceSnapshotReconciliationsIncomplete: z.number().int().nonnegative().max(100),
    sourceSnapshotReconciliationsFailed: z.number().int().nonnegative().max(100),
    sourceSnapshotReconciliationsRetried: z.number().int().nonnegative().max(100),
    sourceSnapshotCoverageGaps: z.number().int().nonnegative().max(5_000),
    campaignRefreshClaims: z.number().int().nonnegative().max(100),
    campaignRefreshDispatched: z.number().int().nonnegative().max(100),
    campaignRefreshFailed: z.number().int().nonnegative().max(100),
    campaignRefreshPolicyDenied: z.number().int().nonnegative().max(100),
    campaignOrchestrationClaims: z.number().int().nonnegative().max(100),
    campaignOrchestrationDispatched: z.number().int().nonnegative().max(100),
    campaignOrchestrationFailed: z.number().int().nonnegative().max(100),
    campaignOrchestrationPolicyDenied: z.number().int().nonnegative().max(100),
    campaignOrchestrationReconciled: z.number().int().nonnegative().max(100),
    productionWorkflowCancellationTargets: z.number().int().nonnegative().max(100).default(0),
    productionWorkflowCancellationAttempted: z.number().int().nonnegative().max(100).default(0),
    productionWorkflowCancellationDispatched: z.number().int().nonnegative().max(100).default(0),
    productionWorkflowCancellationFailed: z.number().int().nonnegative().max(100).default(0),
    retentionTombstonesQueued: z.number().int().nonnegative().max(1_000),
    deletionTombstonesProcessed: z.number().int().nonnegative().max(1_000),
    deletionObjectsAffected: z.number().int().nonnegative().max(10_000_000),
    deletionOpportunitiesInvalidated: z.number().int().nonnegative().max(10_000_000),
    recomputationJobsQueued: z.number().int().nonnegative().max(10_000_000)
  })
  .strict()

/** Durable, policy-gated full-snapshot reconciliation for sources without tombstone feeds. */
export const sourceSnapshotReconciliationStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'incomplete',
  'failed'
])

export const sourceSnapshotReconciliationFailureCodeSchema = z.enum([
  'policy_denied',
  'source_request_failed',
  'snapshot_incomplete',
  'reconciliation_failed'
])

export const sourceSnapshotReconciliationInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    reconciliationId: appseaIdentifierSchema,
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    idempotencyKey: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    pageSize: z.number().int().min(1).max(1_000),
    maxRecords: z.number().int().min(1).max(1_000),
    requestedAt: z.string().datetime()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.maxRecords < input.pageSize) {
      context.addIssue({
        code: 'custom',
        path: ['maxRecords'],
        message: 'maxRecords must be at least pageSize'
      })
    }
  })

export const sourceSnapshotReconciliationResultSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    reconciliationId: appseaIdentifierSchema,
    sourceId: appseaIdentifierSchema,
    policyVersion: z.string().min(1).max(80),
    state: z.enum(['completed', 'incomplete', 'failed']),
    attemptCount: z.number().int().nonnegative().max(100),
    pagesScanned: z.number().int().nonnegative().max(1_000),
    sourceRecordCount: z.number().int().nonnegative().max(1_000),
    deletionCount: z.number().int().nonnegative().max(1_000_000),
    coverageGaps: z.array(z.string().min(1).max(500)).max(50),
    warnings: z.array(z.string().min(1).max(500)).max(50),
    failureCode: sourceSnapshotReconciliationFailureCodeSchema.nullable(),
    failureSummary: z.string().min(1).max(240).nullable(),
    observedAt: z.string().datetime().nullable(),
    requestedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable()
  })
  .strict()

export const sourceSnapshotReconciliationReadModelSchema = z
  .object({
    ...sourceSnapshotReconciliationResultSchema.shape,
    inputHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    pageSize: z.number().int().min(1).max(1_000),
    maxRecords: z.number().int().min(1).max(1_000),
    state: sourceSnapshotReconciliationStateSchema,
    nextOffset: z.number().int().nonnegative().max(1_000),
    nextAttemptAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()

export const sourceSnapshotReconciliationPageSchema = z
  .object({
    offset: z.number().int().nonnegative().max(1_000),
    pageSize: z.number().int().min(1).max(1_000),
    sourceRecordCount: z.number().int().nonnegative().max(1_000),
    sourceRecordIds: z.array(z.string().min(1).max(240)).max(1_000),
    shortPage: z.boolean(),
    completeSnapshot: z.boolean(),
    warnings: z.array(z.string().min(1).max(500)).max(50)
  })
  .strict()
  .superRefine((page, context) => {
    if (page.sourceRecordCount < page.sourceRecordIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRecordIds'],
        message: 'sourceRecordIds cannot exceed sourceRecordCount'
      })
    }
    if (page.shortPage !== page.sourceRecordCount < page.pageSize) {
      context.addIssue({
        code: 'custom',
        path: ['shortPage'],
        message: 'shortPage must match the returned source record count'
      })
    }
    if (page.completeSnapshot && (!page.shortPage || page.warnings.length > 0)) {
      context.addIssue({
        code: 'custom',
        path: ['completeSnapshot'],
        message: 'A complete snapshot page must be short and warning-free'
      })
    }
  })

export const authRetentionInputSchema = z
  .object({
    jobId: maintenanceJobIdSchema,
    retentionDays: z.number().int().min(1).max(3_650),
    batchSize: z.number().int().min(1).max(10_000)
  })
  .strict()

export const authRetentionResultSchema = z
  .object({
    jobId: maintenanceJobIdSchema,
    sessionsDeleted: z.number().int().nonnegative().max(10_000),
    rateLimitsDeleted: z.number().int().nonnegative().max(10_000),
    passwordResetTokensDeleted: z.number().int().nonnegative().max(10_000),
    workspaceInvitationsDeleted: z.number().int().nonnegative().max(10_000),
    mfaChallengesDeleted: z.number().int().nonnegative().max(10_000),
    mfaEventsDeleted: z.number().int().nonnegative().max(10_000),
    mfaPendingEnrollmentsDeleted: z.number().int().nonnegative().max(10_000)
  })
  .strict()

export const authRecoveryBatchInputSchema = z
  .object({
    batchSize: z.number().int().min(1).max(100)
  })
  .strict()

export const workspaceInvitationDeliveryBatchInputSchema = z
  .object({
    batchSize: z.number().int().min(1).max(100)
  })
  .strict()

// Authentication and private-workspace contracts. Passwords and session tokens
// are accepted only at the authentication boundary; they are never persisted
// or included in read models.
export const authEmailSchema = z.string().trim().toLowerCase().email().max(320)

export const authPasswordSchema = z.string().min(12).max(256)

export const authSignUpInputSchema = z
  .object({
    email: authEmailSchema,
    password: authPasswordSchema,
    displayName: z.string().trim().min(1).max(160),
    workspaceName: z.string().trim().min(1).max(160),
    workspaceSlug: opportunitySlugSchema.optional()
  })
  .strict()

export const authSignInInputSchema = z
  .object({
    email: authEmailSchema,
    password: authPasswordSchema
  })
  .strict()

// External identities are linked only after an authenticated password/MFA
// step-up. The provider subject is never exposed in private read models and
// email matching is not an account-linking rule.
export const authExternalIdentityProviderSchema = z.literal('oidc')

const authExternalIdentityIssuerSchema = z
  .string()
  .trim()
  .url()
  .max(512)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value)
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
      if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issuer URL is not permitted' })
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issuer URL is not permitted' })
    }
  })

export const authExternalIdentityClaimsSchema = z
  .object({
    issuer: authExternalIdentityIssuerSchema,
    subject: z.string().min(1).max(512),
    email: authEmailSchema,
    emailVerified: z.literal(true)
  })
  .strict()

export const authExternalIdentityReadModelSchema = z
  .object({
    identityId: appseaIdentifierSchema,
    provider: authExternalIdentityProviderSchema,
    issuerHost: z.string().min(1).max(255),
    email: authEmailSchema,
    linkedAt: z.string().datetime(),
    lastAuthenticatedAt: z.string().datetime().nullable()
  })
  .strict()

// MFA codes are accepted only at the authentication boundary. Recovery codes
// are displayed once during enrollment and are never persisted in plaintext.
export const authMfaTotpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/)
export const authMfaRecoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/)
export const authMfaCodeSchema = z.union([authMfaTotpCodeSchema, authMfaRecoveryCodeSchema])

export const authMfaChallengeTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)

export const authMfaEnrollmentConfirmInputSchema = z
  .object({ code: authMfaTotpCodeSchema })
  .strict()

export const authMfaDisableInputSchema = z.object({ code: authMfaCodeSchema }).strict()

// A high-risk token action may require a fresh MFA proof in addition to the
// session's password step-up. The code is consumed only at the auth boundary;
// it is never persisted or returned in a read model.
export const authMfaStepUpInputSchema = z.object({ code: authMfaCodeSchema }).strict()

export const authMfaStepUpResultSchema = z
  .object({
    verified: z.literal(true)
  })
  .strict()

export const authMfaSignInInputSchema = z
  .object({
    challengeToken: authMfaChallengeTokenSchema,
    code: authMfaCodeSchema
  })
  .strict()

export const authMfaStatusReadModelSchema = z
  .object({
    enabled: z.boolean(),
    enrolledAt: z.string().datetime().nullable(),
    recoveryCodesRemaining: z.number().int().nonnegative().max(20)
  })
  .strict()

// Deployment diagnostics expose counts only. Key material and encrypted
// secret fields never cross the operator-status contract.
export const authMfaKeyRotationStatusSchema = z
  .object({
    currentKeyVersion: z.number().int().min(1).max(32_767),
    previousKeyVersion: z.number().int().min(1).max(32_767).nullable(),
    totalAccounts: z.number().int().nonnegative(),
    currentKeyAccounts: z.number().int().nonnegative(),
    previousKeyAccounts: z.number().int().nonnegative(),
    unknownKeyAccounts: z.number().int().nonnegative(),
    enabledAccounts: z.number().int().nonnegative(),
    pendingAccounts: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.currentKeyAccounts + value.previousKeyAccounts + value.unknownKeyAccounts !==
      value.totalAccounts
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalAccounts'],
        message: 'Key-version counts must add up to total accounts'
      })
    }
    if (value.enabledAccounts + value.pendingAccounts !== value.totalAccounts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalAccounts'],
        message: 'MFA status counts must add up to total accounts'
      })
    }
  })

/**
 * A bounded operator batch for rewrapping MFA ciphertext that still uses the
 * configured previous key. The batch is intentionally small enough to retry
 * safely and never carries key material or account identifiers.
 */
export const authMfaKeyRotationRewrapInputSchema = z
  .object({
    batchSize: z.number().int().min(1).max(1_000)
  })
  .strict()

export const authMfaKeyRotationRewrapResultSchema = z
  .object({
    currentKeyVersion: z.number().int().min(1).max(32_767),
    previousKeyVersion: z.number().int().min(1).max(32_767),
    batchSize: z.number().int().min(1).max(1_000),
    rewrappedAccounts: z.number().int().nonnegative().max(1_000),
    remainingPreviousKeyAccounts: z.number().int().nonnegative(),
    completed: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rewrappedAccounts > value.batchSize) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rewrappedAccounts'],
        message: 'Rewrapped account count cannot exceed the requested batch size'
      })
    }
    if (value.completed && value.remainingPreviousKeyAccounts !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completed'],
        message: 'A completed rotation batch cannot leave previous-key accounts'
      })
    }
  })

export const authMfaEnrollmentReadModelSchema = z
  .object({
    secret: z.string().regex(/^[A-Z2-7]{32}$/),
    otpauthUri: z.string().regex(/^otpauth:\/\/totp\//),
    recoveryCodes: z.array(authMfaRecoveryCodeSchema).length(10),
    expiresAt: z.string().datetime()
  })
  .strict()

export const authMfaRequiredResultSchema = z
  .object({
    mfaRequired: z.literal(true),
    challengeToken: authMfaChallengeTokenSchema,
    expiresAt: z.string().datetime()
  })
  .strict()

export const authReauthenticationInputSchema = z
  .object({
    password: authPasswordSchema
  })
  .strict()

// Account closure is deliberately explicit and separate from reauthentication.
// The phrase prevents an accidental destructive click while the recent
// password step-up proves that the caller still controls the account.
export const authAccountDeletionInputSchema = z
  .object({
    confirmation: z.literal('DELETE MY ACCOUNT')
  })
  .strict()

// Workspace archival stops new research while retaining immutable lineage.
// Destructive workspace/object/backup purge remains a separate reviewed
// retention operation and is never implied by this contract.
export const workspaceArchiveInputSchema = z
  .object({
    confirmation: z.literal('ARCHIVE WORKSPACE')
  })
  .strict()

export const workspacePurgeRequestInputSchema = z
  .object({
    confirmation: z.literal('REQUEST WORKSPACE PURGE')
  })
  .strict()

export const workspacePurgeExternalRequirementSchema = z.enum([
  'cloud_object_store_purge',
  'export_retention_purge',
  'backup_deletion_verification'
])

// Preparing a manifest is a metadata-only, owner-scoped handoff. It does not
// authorize deletion; the exact phrase keeps the high-impact intent visible
// in the web boundary and in audit receipts.
export const workspacePurgeManifestInputSchema = z
  .object({
    confirmation: z.literal('PREPARE WORKSPACE PURGE MANIFEST')
  })
  .strict()

export const workspacePurgeManifestIdSchema = z
  .string()
  .regex(/^workspace-purge-manifest:[a-f0-9]{32}$/, 'Invalid workspace purge manifest id')

export const workspacePurgeManifestObjectSchema = z
  .object({
    uri: z
      .string()
      .min(32)
      .max(512)
      .regex(
        /^appsea-object:\/\/[a-z][a-z0-9_:-]*\/(?:evidence|report-json|report-markdown|plan-package|workflow-artifact|export)\/[a-f0-9]{64}$/,
        'Invalid workspace purge object URI'
      ),
    kind: objectStorageKindSchema
  })
  .strict()

export const workspacePurgeManifestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    manifestId: workspacePurgeManifestIdSchema,
    generatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    manifestHash: contentHashSchema,
    objectCount: z.number().int().nonnegative().max(10_000),
    objects: z.array(workspacePurgeManifestObjectSchema).max(10_000),
    externalRequirements: z
      .array(workspacePurgeExternalRequirementSchema)
      .length(3)
      .refine(
        (requirements) =>
          JSON.stringify(requirements) ===
          JSON.stringify([
            'cloud_object_store_purge',
            'export_retention_purge',
            'backup_deletion_verification'
          ]),
        'Purge manifest requirements must remain complete and ordered'
      )
  })
  .strict()
  .superRefine((value, context) => {
    if (value.objectCount !== value.objects.length) {
      context.addIssue({
        code: 'custom',
        path: ['objectCount'],
        message: 'Purge manifest object count must match its object list'
      })
    }
    if (value.expiresAt <= value.generatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Purge manifest expiry must be after generation'
      })
    }
    const seen = new Set<string>()
    for (const [index, object] of value.objects.entries()) {
      if (seen.has(object.uri)) {
        context.addIssue({
          code: 'custom',
          path: ['objects', index, 'uri'],
          message: 'Purge manifest objects must be unique'
        })
      }
      seen.add(object.uri)
      const expectedPrefix = `appsea-object://${value.workspaceId}/`
      if (!object.uri.startsWith(expectedPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['objects', index, 'uri'],
          message: 'Purge manifest objects must belong to the workspace'
        })
      }
      if (!object.uri.includes(`/${object.kind}/`)) {
        context.addIssue({
          code: 'custom',
          path: ['objects', index, 'kind'],
          message: 'Purge manifest object kind must match its URI'
        })
      }
    }
  })

export const workspacePurgeRequestIdSchema = z
  .string()
  .regex(/^workspace-purge:[a-f0-9]{32}$/, 'Invalid workspace purge request id')

export const workspacePurgeRequestCancelInputSchema = z
  .object({
    requestId: workspacePurgeRequestIdSchema,
    confirmation: z.literal('CANCEL WORKSPACE PURGE')
  })
  .strict()

const workspaceArchivedResultSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    state: z.literal('archived'),
    archivedAt: z.string().datetime(),
    activeWorkCount: z.literal(0),
    replayed: z.boolean()
  })
  .strict()

const workspaceArchiveBlockedResultSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    state: z.literal('blocked'),
    archivedAt: z.null(),
    activeWorkCount: z.number().int().min(1).max(2_147_483_647),
    replayed: z.literal(false)
  })
  .strict()

export const workspaceArchiveResultSchema = z.discriminatedUnion('state', [
  workspaceArchivedResultSchema,
  workspaceArchiveBlockedResultSchema
])

// A purge-readiness inventory is deliberately read-only. It separates the
// database conditions AppSea can observe from cloud object-store, export, and
// backup controls that still require an operated provider boundary. It never
// implies that a workspace has been deleted.
export const workspacePurgeReadinessBlockerSchema = z.enum([
  'workspace_not_archived',
  'active_work',
  'raw_source_objects',
  'analysis_objects',
  'report_objects',
  'plan_objects'
])

export const workspacePurgeReadinessSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    state: z.enum(['blocked', 'database_ready']),
    archivedAt: z.string().datetime().nullable(),
    activeWorkCount: z.number().int().nonnegative().max(2_147_483_647),
    rawSourceObjectReferenceCount: z.number().int().nonnegative().max(2_147_483_647),
    analysisObjectReferenceCount: z.number().int().nonnegative().max(2_147_483_647),
    reportObjectReferenceCount: z.number().int().nonnegative().max(2_147_483_647),
    planObjectReferenceCount: z.number().int().nonnegative().max(2_147_483_647),
    blockers: z.array(workspacePurgeReadinessBlockerSchema).max(6),
    externalRequirements: z.array(workspacePurgeExternalRequirementSchema).length(3),
    checkedAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    const expectedBlockers = [
      ...(value.archivedAt === null ? (['workspace_not_archived'] as const) : []),
      ...(value.activeWorkCount > 0 ? (['active_work'] as const) : []),
      ...(value.rawSourceObjectReferenceCount > 0 ? (['raw_source_objects'] as const) : []),
      ...(value.analysisObjectReferenceCount > 0 ? (['analysis_objects'] as const) : []),
      ...(value.reportObjectReferenceCount > 0 ? (['report_objects'] as const) : []),
      ...(value.planObjectReferenceCount > 0 ? (['plan_objects'] as const) : [])
    ]
    if (JSON.stringify(value.blockers) !== JSON.stringify(expectedBlockers)) {
      context.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: 'Purge blockers must match the observed workspace state'
      })
    }
    const expectedState = expectedBlockers.length === 0 ? 'database_ready' : 'blocked'
    if (value.state !== expectedState) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Purge readiness state must match the observed blockers'
      })
    }
  })

export const workspacePurgeRequestStateSchema = z.enum(['awaiting_external_controls', 'canceled'])

export const workspacePurgeRequestSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    requestId: workspacePurgeRequestIdSchema,
    state: workspacePurgeRequestStateSchema,
    requestedAt: z.string().datetime(),
    canceledAt: z.string().datetime().nullable(),
    readiness: workspacePurgeReadinessSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'canceled' && value.canceledAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['canceledAt'],
        message: 'Canceled purge requests must record a cancellation time'
      })
    }
    if (value.state === 'awaiting_external_controls' && value.canceledAt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['canceledAt'],
        message: 'Active purge requests cannot record a cancellation time'
      })
    }
    if (value.readiness.state !== 'database_ready') {
      context.addIssue({
        code: 'custom',
        path: ['readiness'],
        message: 'A purge request must snapshot a database-ready workspace'
      })
    }
  })

export const authSessionTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)

export const agentAccessTokenSchema = z
  .string()
  .min(40)
  .max(256)
  .regex(/^appsea_mcp_[A-Za-z0-9_-]+$/)

export const agentAccessTokenScopeSchema = z.enum([
  'opportunities:read',
  'evidence:read',
  'reports:read',
  'plans:read',
  'sources:read'
])

export const agentAccessTokenCreateInputSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    scopes: z.array(agentAccessTokenScopeSchema).min(1).max(5),
    expiresInDays: z.number().int().min(1).max(90)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.scopes).size !== value.scopes.length) {
      context.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'Agent access token scopes must be unique'
      })
    }
  })

export const agentAccessTokenCreateResultSchema = z
  .object({
    tokenId: appseaIdentifierSchema,
    label: z.string().min(1).max(120),
    scopes: z.array(agentAccessTokenScopeSchema).min(1).max(5),
    expiresAt: z.string().datetime(),
    token: agentAccessTokenSchema
  })
  .strict()

export const agentAccessTokenReadModelSchema = z
  .object({
    tokenId: appseaIdentifierSchema,
    label: z.string().min(1).max(120),
    scopes: z.array(agentAccessTokenScopeSchema).min(1).max(5),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    lastUsedAt: z.string().datetime().nullable()
  })
  .strict()

export const agentAccessTokenAuthenticationSchema = z
  .object({
    tokenId: appseaIdentifierSchema,
    workspaceId: appseaIdentifierSchema,
    userId: appseaIdentifierSchema,
    scopes: z.array(agentAccessTokenScopeSchema).min(1).max(5)
  })
  .strict()

export const agentAccessAdmissionReasonSchema = z.enum([
  'admitted',
  'rate_limited',
  'concurrency_limited',
  'not_authorized'
])

export const agentAccessAdmissionResultSchema = z
  .object({
    admitted: z.boolean(),
    reason: agentAccessAdmissionReasonSchema,
    retryAfterSeconds: z.number().int().min(0).max(60),
    admissionId: appseaIdentifierSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.admitted && (value.reason !== 'admitted' || value.admissionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['admissionId'],
        message: 'An admitted request requires an admission identifier'
      })
    }
    if (value.admitted && value.retryAfterSeconds !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['retryAfterSeconds'],
        message: 'An admitted request cannot ask the caller to retry'
      })
    }
    if (!value.admitted && (value.reason === 'admitted' || value.admissionId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A denied request cannot carry an admission identifier'
      })
    }
    if (!value.admitted && value.reason !== 'not_authorized' && value.retryAfterSeconds < 1) {
      context.addIssue({
        code: 'custom',
        path: ['retryAfterSeconds'],
        message: 'A rate or concurrency denial requires a retry interval'
      })
    }
  })

export const mcpJsonRpcIdSchema = z.union([
  z.string().min(1).max(200),
  z.number().int().safe(),
  z.null()
])

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: mcpJsonRpcIdSchema.optional(),
    method: z.string().min(1).max(100),
    params: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

export const mcpToolCallInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    arguments: z.record(z.string(), z.unknown()).default({})
  })
  .strict()

export const mcpToolTextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().max(200_000)
  })
  .strict()

// Password-reset tokens are accepted only at the reset boundary. They are
// never stored or returned in read models; the database keeps only a hash.
export const authPasswordResetTokenSchema = authSessionTokenSchema

export const authPasswordResetRequestInputSchema = z
  .object({
    email: authEmailSchema
  })
  .strict()

export const authPasswordResetInputSchema = z
  .object({
    token: authPasswordResetTokenSchema,
    password: authPasswordSchema
  })
  .strict()

export const authPasswordResetAcceptedReadModelSchema = z
  .object({
    accepted: z.literal(true)
  })
  .strict()

export const workspaceRoleSchema = z.enum(['owner', 'editor', 'viewer'])

// Invitations never grant ownership. Owners can promote an accepted member
// later through the existing step-up-protected membership administration path.
export const workspaceInvitationRoleSchema = z.enum(['editor', 'viewer'])

export const workspaceInvitationCreateInputSchema = z
  .object({
    email: authEmailSchema,
    role: workspaceInvitationRoleSchema
  })
  .strict()

export const workspaceInvitationTokenSchema = authSessionTokenSchema

export const workspaceInvitationAcceptInputSchema = z
  .object({
    token: workspaceInvitationTokenSchema
  })
  .strict()

export const workspaceInvitationAcceptedReadModelSchema = z
  .object({
    accepted: z.literal(true),
    workspaceId: appseaIdentifierSchema,
    role: workspaceInvitationRoleSchema
  })
  .strict()

export const workspaceInvitationReadModelSchema = z
  .object({
    invitationId: appseaIdentifierSchema,
    email: authEmailSchema,
    role: workspaceInvitationRoleSchema,
    state: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  })
  .strict()

export const workspaceMemberRoleUpdateInputSchema = z
  .object({
    role: workspaceRoleSchema
  })
  .strict()

export const authUserReadModelSchema = z
  .object({
    userId: appseaIdentifierSchema,
    email: authEmailSchema,
    displayName: z.string().min(1).max(160),
    createdAt: z.string().datetime()
  })
  .strict()

export const workspaceMembershipReadModelSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    slug: opportunitySlugSchema,
    displayName: z.string().min(1).max(160),
    visibility: z.enum(['private', 'public']),
    fixtureOnly: z.boolean(),
    role: workspaceRoleSchema
  })
  .strict()

export const workspaceMemberReadModelSchema = z
  .object({
    userId: appseaIdentifierSchema,
    email: authEmailSchema,
    displayName: z.string().min(1).max(160),
    role: workspaceRoleSchema,
    createdAt: z.string().datetime()
  })
  .strict()

export const authSessionReadModelSchema = z
  .object({
    sessionId: appseaIdentifierSchema,
    user: authUserReadModelSchema,
    workspaces: z.array(workspaceMembershipReadModelSchema),
    expiresAt: z.string().datetime()
  })
  .strict()

export const authSessionSummaryReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    current: z.boolean()
  })
  .strict()

export const authSessionListReadModelSchema = z
  .object({
    sessions: z.array(authSessionSummaryReadModelSchema).max(1_000)
  })
  .strict()

export const authAccountDeletionResultSchema = z
  .object({
    closed: z.boolean(),
    blockingWorkspaceIds: z.array(appseaIdentifierSchema).max(100)
  })
  .strict()

const costMicrosTextSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,17})$/)
const costSummaryCountSchema = z.number().int().nonnegative().max(1_000_000)
const costTypeSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_:-]*$/)
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)

export const workspaceCostSummaryQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && new Date(query.from).getTime() >= new Date(query.to).getTime()) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from must be before to'
      })
    }
  })

export const workspaceCostTypeSummarySchema = z
  .object({
    costType: costTypeSchema,
    entryCount: costSummaryCountSchema,
    totalCostMicros: costMicrosTextSchema,
    estimatedCostMicros: costMicrosTextSchema,
    actualCostMicros: costMicrosTextSchema
  })
  .strict()

export const workspaceCurrencyCostSummarySchema = z
  .object({
    currency: currencyCodeSchema,
    entryCount: costSummaryCountSchema,
    totalCostMicros: costMicrosTextSchema,
    estimatedCostMicros: costMicrosTextSchema,
    actualCostMicros: costMicrosTextSchema,
    byCostType: z.array(workspaceCostTypeSummarySchema).max(64)
  })
  .strict()

export const workspaceCostSummaryReadModelSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    asOf: z.string().datetime(),
    entryCount: costSummaryCountSchema,
    currencies: z.array(workspaceCurrencyCostSummarySchema).max(16)
  })
  .strict()

/** Bounds for read-only deployment cost-threshold inspection. */
export const workspaceCostAlertLimits = {
  maxWorkspaces: 10_000,
  maxCurrenciesPerWorkspace: 16,
  maxObservedRows: 160_000,
  maxObservedEntries: 1_000_000_000,
  maxPeriodSeconds: 31_536_000,
  defaultMaxWorkspaces: 1_000,
  defaultMaxCurrenciesPerWorkspace: 16,
  defaultPeriodSeconds: 2_592_000
} as const

export const workspaceCostAlertObservationSchema = z
  .object({
    currency: currencyCodeSchema,
    entryCount: costSummaryCountSchema,
    totalCostMicros: costMicrosTextSchema,
    estimatedCostMicros: costMicrosTextSchema,
    actualCostMicros: costMicrosTextSchema
  })
  .strict()

export const workspaceCostAlertInputSchema = z
  .object({
    observedAt: z.string().datetime(),
    maxWorkspaces: z.number().int().min(1).max(workspaceCostAlertLimits.maxWorkspaces),
    maxCurrenciesPerWorkspace: z
      .number()
      .int()
      .min(1)
      .max(workspaceCostAlertLimits.maxCurrenciesPerWorkspace),
    periodSeconds: z.number().int().min(1).max(workspaceCostAlertLimits.maxPeriodSeconds),
    thresholdCurrency: currencyCodeSchema,
    actualThresholdMicros: costMicrosTextSchema,
    estimatedThresholdMicros: costMicrosTextSchema
  })
  .strict()

export const workspaceCostAlertResultSchema = z
  .object({
    observedAt: z.string().datetime(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    periodSeconds: z.number().int().min(1).max(workspaceCostAlertLimits.maxPeriodSeconds),
    thresholdCurrency: currencyCodeSchema,
    actualThresholdMicros: costMicrosTextSchema,
    estimatedThresholdMicros: costMicrosTextSchema,
    workspacesScanned: z.number().int().nonnegative().max(workspaceCostAlertLimits.maxWorkspaces),
    rowsObserved: z.number().int().nonnegative().max(workspaceCostAlertLimits.maxObservedRows),
    entriesObserved: z
      .number()
      .int()
      .nonnegative()
      .max(workspaceCostAlertLimits.maxObservedEntries),
    targetCurrencyRows: z
      .number()
      .int()
      .nonnegative()
      .max(workspaceCostAlertLimits.maxObservedRows),
    unsupportedCurrencyRows: z
      .number()
      .int()
      .nonnegative()
      .max(workspaceCostAlertLimits.maxObservedRows),
    actualTargetCostMicros: costMicrosTextSchema,
    estimatedTargetCostMicros: costMicrosTextSchema,
    workspacesOverActualThreshold: z
      .number()
      .int()
      .nonnegative()
      .max(workspaceCostAlertLimits.maxWorkspaces),
    workspacesOverEstimatedThreshold: z
      .number()
      .int()
      .nonnegative()
      .max(workspaceCostAlertLimits.maxWorkspaces),
    alerted: z.boolean(),
    truncated: z.boolean(),
    state: z.enum(['clear', 'alert', 'incomplete'])
  })
  .superRefine((value, context) => {
    if (value.targetCurrencyRows + value.unsupportedCurrencyRows > value.rowsObserved) {
      context.addIssue({
        code: 'custom',
        path: ['rowsObserved'],
        message: 'Currency row counters cannot exceed observed rows'
      })
    }
    if (value.workspacesOverActualThreshold > value.workspacesScanned) {
      context.addIssue({
        code: 'custom',
        path: ['workspacesOverActualThreshold'],
        message: 'Actual cost alerts cannot exceed scanned workspaces'
      })
    }
    if (value.workspacesOverEstimatedThreshold > value.workspacesScanned) {
      context.addIssue({
        code: 'custom',
        path: ['workspacesOverEstimatedThreshold'],
        message: 'Estimated cost alerts cannot exceed scanned workspaces'
      })
    }
    const alerted =
      value.workspacesOverActualThreshold > 0 || value.workspacesOverEstimatedThreshold > 0
    if (value.alerted !== alerted) {
      context.addIssue({
        code: 'custom',
        path: ['alerted'],
        message: 'Cost alert state must match threshold breaches'
      })
    }
    if (value.state === 'alert' && !value.alerted) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Alert state requires a threshold breach'
      })
    }
    if (value.alerted && value.state !== 'alert') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Threshold breaches require alert state'
      })
    }
    if (
      value.state === 'clear' &&
      (value.alerted || value.truncated || value.unsupportedCurrencyRows > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Clear state requires complete comparable currency coverage'
      })
    }
    if (value.state === 'incomplete' && !value.truncated && value.unsupportedCurrencyRows === 0) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Incomplete state requires truncation or unsupported currencies'
      })
    }
  })
  .strict()

const sourceQuotaReservationIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z][a-z0-9_:-]*$/)
const sourceQuotaReconciliationStateSchema = z.enum(['open', 'resolved'])
const sourceQuotaReconciliationResolutionCodeSchema = z.enum(['linked_result', 'voided_no_result'])
const sourceQuotaReconciliationActorIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)

/** Bounds for the read-only scheduler alert inspection. */
export const sourceQuotaReconciliationAlertLimits = {
  maxWorkspaces: 10_000,
  maxCasesPerWorkspace: 100,
  maxOpenCases: 1_000_000,
  maxAlertAfterSeconds: 31_536_000,
  maxAgeSeconds: 315_360_000,
  defaultMaxWorkspaces: 1_000,
  defaultMaxCasesPerWorkspace: 100,
  defaultAlertAfterSeconds: 900
} as const

export const sourceQuotaReconciliationListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()

export const sourceQuotaReconciliationCaseSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    reservationId: sourceQuotaReservationIdSchema,
    sourceId: appseaIdentifierSchema,
    policyVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    runId: appseaIdentifierSchema,
    requestedRecords: z.number().int().min(1).max(5_000),
    requestedCostMicros: z.number().int().nonnegative().max(1_000_000_000_000),
    actualRecords: z.number().int().nonnegative().max(5_000).nullable(),
    actualCostMicros: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
    state: sourceQuotaReconciliationStateSchema,
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    resolutionCode: sourceQuotaReconciliationResolutionCodeSchema.nullable(),
    linkedRunId: appseaIdentifierSchema.nullable(),
    resolutionActorId: sourceQuotaReconciliationActorIdSchema.nullable(),
    resolvedAt: z.string().datetime().nullable()
  })
  .superRefine((value, context) => {
    if (value.state === 'open') {
      if (value.resolutionCode !== null) {
        context.addIssue({
          code: 'custom',
          path: ['resolutionCode'],
          message: 'Open cases are unresolved'
        })
      }
      if (value.linkedRunId !== null) {
        context.addIssue({
          code: 'custom',
          path: ['linkedRunId'],
          message: 'Open cases cannot link a result'
        })
      }
      if (value.resolutionActorId !== null || value.resolvedAt !== null) {
        context.addIssue({
          code: 'custom',
          path: ['resolvedAt'],
          message: 'Open cases cannot have resolution metadata'
        })
      }
    } else {
      if (
        value.resolutionCode === null ||
        value.resolutionActorId === null ||
        value.resolvedAt === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['resolutionCode'],
          message: 'Resolved cases require resolution metadata'
        })
      }
      if (value.resolutionCode === 'linked_result' && value.linkedRunId === null) {
        context.addIssue({
          code: 'custom',
          path: ['linkedRunId'],
          message: 'Linked cases require a completed run'
        })
      }
      if (value.resolutionCode === 'voided_no_result' && value.linkedRunId !== null) {
        context.addIssue({
          code: 'custom',
          path: ['linkedRunId'],
          message: 'Voided cases cannot link a run'
        })
      }
    }
  })
  .strict()

export const sourceQuotaReconciliationResolveInputSchema = z
  .object({
    workspaceId: appseaIdentifierSchema,
    reservationId: sourceQuotaReservationIdSchema,
    resolutionCode: sourceQuotaReconciliationResolutionCodeSchema,
    linkedRunId: appseaIdentifierSchema.nullable(),
    actorId: sourceQuotaReconciliationActorIdSchema
  })
  .superRefine((value, context) => {
    if (value.resolutionCode === 'linked_result' && value.linkedRunId === null) {
      context.addIssue({
        code: 'custom',
        path: ['linkedRunId'],
        message: 'A linked result is required'
      })
    }
    if (value.resolutionCode === 'voided_no_result' && value.linkedRunId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['linkedRunId'],
        message: 'A voided case cannot link a result'
      })
    }
  })
  .strict()

export const sourceQuotaReconciliationAlertInputSchema = z
  .object({
    observedAt: z.string().datetime(),
    maxWorkspaces: z.number().int().min(1).max(sourceQuotaReconciliationAlertLimits.maxWorkspaces),
    maxCasesPerWorkspace: z
      .number()
      .int()
      .min(1)
      .max(sourceQuotaReconciliationAlertLimits.maxCasesPerWorkspace),
    alertAfterSeconds: z
      .number()
      .int()
      .min(1)
      .max(sourceQuotaReconciliationAlertLimits.maxAlertAfterSeconds)
  })
  .strict()

export const sourceQuotaReconciliationAlertResultSchema = z
  .object({
    observedAt: z.string().datetime(),
    alertAfterSeconds: z
      .number()
      .int()
      .min(1)
      .max(sourceQuotaReconciliationAlertLimits.maxAlertAfterSeconds),
    workspacesScanned: z
      .number()
      .int()
      .nonnegative()
      .max(sourceQuotaReconciliationAlertLimits.maxWorkspaces),
    openCases: z
      .number()
      .int()
      .nonnegative()
      .max(sourceQuotaReconciliationAlertLimits.maxOpenCases),
    oldestOpenCaseAgeSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(sourceQuotaReconciliationAlertLimits.maxAgeSeconds)
      .nullable(),
    alerted: z.boolean(),
    truncated: z.boolean(),
    state: z.enum(['clear', 'alert', 'incomplete'])
  })
  .superRefine((value, context) => {
    if (value.state === 'alert' && !value.alerted) {
      context.addIssue({
        code: 'custom',
        path: ['alerted'],
        message: 'Alert state requires an alerted result'
      })
    }
    if (value.alerted && value.state !== 'alert') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Alerted results require alert state'
      })
    }
    if (
      value.state === 'clear' &&
      (value.alerted ||
        value.truncated ||
        (value.oldestOpenCaseAgeSeconds !== null &&
          value.oldestOpenCaseAgeSeconds >= value.alertAfterSeconds))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Clear state requires a complete non-alerted result'
      })
    }
    if (value.state === 'incomplete' && !value.truncated) {
      context.addIssue({
        code: 'custom',
        path: ['truncated'],
        message: 'Incomplete state requires truncated coverage'
      })
    }
    if (value.alerted && value.oldestOpenCaseAgeSeconds === null) {
      context.addIssue({
        code: 'custom',
        path: ['oldestOpenCaseAgeSeconds'],
        message: 'Alerted results require an open case age'
      })
    }
    if (value.openCases === 0 && value.oldestOpenCaseAgeSeconds !== null) {
      context.addIssue({
        code: 'custom',
        path: ['oldestOpenCaseAgeSeconds'],
        message: 'An empty scan cannot have an oldest case age'
      })
    }
    if (value.openCases > 0 && value.oldestOpenCaseAgeSeconds === null) {
      context.addIssue({
        code: 'custom',
        path: ['oldestOpenCaseAgeSeconds'],
        message: 'Open cases require an oldest case age'
      })
    }
    if (
      value.oldestOpenCaseAgeSeconds !== null &&
      value.oldestOpenCaseAgeSeconds < value.alertAfterSeconds
    ) {
      if (value.alerted) {
        context.addIssue({
          code: 'custom',
          path: ['alerted'],
          message: 'Alerted results require an age at or above the threshold'
        })
      }
    }
  })
  .strict()

/** Bounds for read-only production-analysis recomputation alert inspection. */
export const productionAnalysisRecomputeAlertLimits = {
  maxWorkspaces: 10_000,
  maxJobsPerWorkspace: 100,
  maxObservedJobs: 1_000_000,
  maxAlertAfterSeconds: 31_536_000,
  maxAgeSeconds: 315_360_000,
  defaultMaxWorkspaces: 1_000,
  defaultMaxJobsPerWorkspace: 100,
  defaultAlertAfterSeconds: 900
} as const

const productionAnalysisRecomputeAlertStateSchema = z.enum([
  'queued',
  'dispatching',
  'started',
  'blocked',
  'failed'
])

export const productionAnalysisRecomputeAlertObservationSchema = z
  .object({
    state: productionAnalysisRecomputeAlertStateSchema,
    attemptCount: z.number().int().nonnegative().max(100),
    requestedAt: z.string().datetime(),
    nextAttemptAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Recomputation updates cannot predate the request'
      })
    }
  })
  .strict()

export const productionAnalysisRecomputeAlertInputSchema = z
  .object({
    observedAt: z.string().datetime(),
    maxWorkspaces: z
      .number()
      .int()
      .min(1)
      .max(productionAnalysisRecomputeAlertLimits.maxWorkspaces),
    maxJobsPerWorkspace: z
      .number()
      .int()
      .min(1)
      .max(productionAnalysisRecomputeAlertLimits.maxJobsPerWorkspace),
    alertAfterSeconds: z
      .number()
      .int()
      .min(1)
      .max(productionAnalysisRecomputeAlertLimits.maxAlertAfterSeconds)
  })
  .strict()

export const productionAnalysisRecomputeAlertResultSchema = z
  .object({
    observedAt: z.string().datetime(),
    alertAfterSeconds: z
      .number()
      .int()
      .min(1)
      .max(productionAnalysisRecomputeAlertLimits.maxAlertAfterSeconds),
    workspacesScanned: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxWorkspaces),
    jobsObserved: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxObservedJobs),
    failedJobs: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxObservedJobs),
    blockedJobs: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxObservedJobs),
    staleJobs: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxObservedJobs),
    oldestOpenJobAgeSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(productionAnalysisRecomputeAlertLimits.maxAgeSeconds)
      .nullable(),
    alerted: z.boolean(),
    truncated: z.boolean(),
    state: z.enum(['clear', 'alert', 'incomplete'])
  })
  .superRefine((value, context) => {
    if (value.failedJobs + value.blockedJobs + value.staleJobs > value.jobsObserved) {
      context.addIssue({
        code: 'custom',
        path: ['jobsObserved'],
        message: 'Alert counters cannot exceed observed jobs'
      })
    }
    if (value.jobsObserved === 0 && value.oldestOpenJobAgeSeconds !== null) {
      context.addIssue({
        code: 'custom',
        path: ['oldestOpenJobAgeSeconds'],
        message: 'An empty scan cannot have an oldest job age'
      })
    }
    if (value.jobsObserved > 0 && value.oldestOpenJobAgeSeconds === null) {
      context.addIssue({
        code: 'custom',
        path: ['oldestOpenJobAgeSeconds'],
        message: 'Observed jobs require an oldest job age'
      })
    }
    const ageReachesThreshold =
      value.oldestOpenJobAgeSeconds !== null &&
      value.oldestOpenJobAgeSeconds >= value.alertAfterSeconds
    if (value.alerted !== (value.failedJobs > 0 || value.blockedJobs > 0 || ageReachesThreshold)) {
      context.addIssue({
        code: 'custom',
        path: ['alerted'],
        message: 'Alert state must match failed, blocked, or aged jobs'
      })
    }
    if (value.state === 'alert' && !value.alerted) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Alert state requires an alerted result'
      })
    }
    if (value.alerted && value.state !== 'alert') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Alerted results require alert state'
      })
    }
    if (value.state === 'clear' && (value.alerted || value.truncated)) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Clear state requires a complete non-alerted result'
      })
    }
    if (value.state === 'incomplete' && !value.truncated) {
      context.addIssue({
        code: 'custom',
        path: ['truncated'],
        message: 'Incomplete state requires truncated coverage'
      })
    }
  })
  .strict()

export const authSignInSuccessResultSchema = z
  .object({
    mfaRequired: z.literal(false),
    token: authSessionTokenSchema,
    session: authSessionReadModelSchema
  })
  .strict()

export const authSignInResultSchema = z.discriminatedUnion('mfaRequired', [
  authSignInSuccessResultSchema,
  authMfaRequiredResultSchema
])

export const workspaceOpportunityReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    slug: opportunitySlugSchema,
    name: z.string().min(1),
    oneLine: z.string().min(1),
    complaintCount: z.number().int().nonnegative(),
    synthetic: z.boolean(),
    score: z.number().min(0).max(100),
    rawScore: z.number().min(0).max(100).optional(),
    riskAdjustedScore: z.number().min(0).max(100).optional(),
    rankingScore: z.number().min(0).max(100).optional(),
    evidenceConfidence: z.number().min(0).max(1).optional(),
    scoreVersion: z.string().min(1),
    scoreCalculatedAt: z.string().datetime(),
    state: z.enum([
      'signal',
      'candidate',
      'researched',
      'planned',
      'approved',
      'monitoring',
      'archived'
    ]),
    currentReportId: appseaIdentifierSchema.nullable(),
    currentPlanPackageId: appseaIdentifierSchema.nullable()
  })
  .strict()

export const workspaceEvidenceReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    sourceItemId: z.string().min(1),
    canonicalLocator: canonicalLocatorSchema.nullable().default(null),
    text: z.string().min(1).max(20_000),
    language: z.string().min(2).max(16),
    product: z.string().min(1),
    company: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
    analysis: complaintAnalysisSchema,
    synthetic: z.boolean(),
    redacted: z.boolean(),
    redactedFields: z.array(evidenceRedactionFieldSchema).max(6).optional(),
    allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable()
  })
  .strict()

export const workspaceComplaintReviewActionSchema = z.enum(['confirmed', 'corrected', 'rejected'])

export const workspaceComplaintReviewInputSchema = z
  .object({
    action: workspaceComplaintReviewActionSchema,
    correctionId: appseaIdentifierSchema.optional(),
    analysisCorrection: complaintAnalysisCorrectionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'corrected') {
      if (!value.correctionId) {
        context.addIssue({
          code: 'custom',
          path: ['correctionId'],
          message: 'A correction ID is required for a corrected analysis'
        })
      }
      if (!value.analysisCorrection) {
        context.addIssue({
          code: 'custom',
          path: ['analysisCorrection'],
          message: 'Derived analysis fields are required for a correction'
        })
      }
    } else if (value.correctionId || value.analysisCorrection) {
      context.addIssue({
        code: 'custom',
        path: ['analysisCorrection'],
        message: 'Analysis corrections require the corrected action'
      })
    }
  })

export const workspaceComplaintReviewReadModelSchema = z
  .object({
    complaintId: appseaIdentifierSchema,
    reviewState: complaintReviewStateSchema,
    analysis: complaintAnalysisSchema.optional(),
    invalidatedAnalysisCount: z.number().int().nonnegative().optional(),
    invalidatedOpportunityCount: z.number().int().nonnegative().optional()
  })
  .strict()

export const workspaceReportReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    version: z.string().min(1),
    structuredReport: opportunityReportSchema,
    generatedAt: z.string().datetime(),
    approvalState: z.enum(['draft', 'reviewed', 'approved', 'withdrawn'])
  })
  .strict()

export const workspaceReportApprovalActionSchema = z.enum(['reviewed', 'approved', 'withdrawn'])

export const workspaceReportApprovalInputSchema = z
  .object({
    action: workspaceReportApprovalActionSchema
  })
  .strict()

export const workspaceReportExportReadModelSchema = z
  .object({
    report: workspaceReportReadModelSchema,
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const workspacePlanReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    version: z.string().min(1),
    files: z.array(planPackageFileSchema),
    generatedAt: z.string().datetime(),
    readinessState: z.enum(['draft', 'ready', 'withdrawn']),
    approvalState: z.enum(['unreviewed', 'reviewed', 'approved', 'withdrawn']),
    synthetic: z.boolean()
  })
  .strict()

export const workspacePlanApprovalActionSchema = z.enum(['reviewed', 'approved', 'withdrawn'])

export const workspacePlanApprovalInputSchema = z
  .object({
    action: workspacePlanApprovalActionSchema
  })
  .strict()

export const workspacePlanExportReadModelSchema = z
  .object({
    plan: workspacePlanReadModelSchema,
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const workspaceOpportunityDetailReadModelSchema = z
  .object({
    opportunity: opportunitySchema,
    summary: workspaceOpportunityReadModelSchema,
    evidence: z.array(workspaceEvidenceReadModelSchema),
    competitiveResearch: competitiveResearchReadModelSchema,
    coverageGaps: z.array(z.string()),
    sourceCoverage: z.array(reportSourceCoverageSchema),
    report: workspaceReportReadModelSchema.nullable(),
    plan: workspacePlanReadModelSchema.nullable()
  })
  .strict()

/** Stable marker used by private read projections after a field is redacted. */
export const evidenceRedactionMarker = '[Content redacted by workspace privacy policy]'

export type EvidenceRedactionField = z.infer<typeof evidenceRedactionFieldSchema>
export type EvidenceRedactionReason = z.infer<typeof evidenceRedactionReasonSchema>
export type EvidenceRedactionMask = {
  evidenceId: string
  fields: EvidenceRedactionField[]
}

function redactedEntityReference(reference: ComplaintEntityReference): ComplaintEntityReference {
  return {
    ...reference,
    surfaceText: evidenceRedactionMarker,
    canonicalName: null,
    resolution: 'unresolved',
    evidence: 'not-inferred'
  }
}

function redactAnalysisEntityFields(
  entities: ComplaintEntityResolution,
  fields: ReadonlySet<EvidenceRedactionField>
): ComplaintEntityResolution {
  const redact = (reference: ComplaintEntityReference): ComplaintEntityReference => {
    if (
      fields.has('text') ||
      fields.has('product') ||
      fields.has('company') ||
      fields.has('feature') ||
      fields.has('category')
    ) {
      return redactedEntityReference(reference)
    }
    return reference
  }
  const product = redact(entities.product)
  const company = redact(entities.company)
  const feature = redact(entities.feature)
  const substitutes = entities.substitutes.map(redact)
  const competitors = entities.competitors.map(redact)
  const unresolvedTypes = new Set(entities.unresolvedTypes)
  if (product.canonicalName === null) unresolvedTypes.add('product')
  if (company.canonicalName === null) unresolvedTypes.add('company')
  if (feature.canonicalName === null) unresolvedTypes.add('feature')
  if (!substitutes.some((entry) => entry.canonicalName !== null)) unresolvedTypes.add('substitute')
  if (!competitors.some((entry) => entry.canonicalName !== null)) unresolvedTypes.add('competitor')
  return {
    product,
    company,
    feature,
    substitutes,
    competitors,
    unresolvedTypes: [...unresolvedTypes]
  }
}

/** Mask only a read projection; the immutable analysis snapshot is not rewritten. */
export function redactComplaintAnalysis(
  analysis: ComplaintAnalysis,
  fields: ReadonlySet<EvidenceRedactionField>
): ComplaintAnalysis {
  const redactText = fields.has('text')
  const redactNarrative =
    redactText ||
    fields.has('product') ||
    fields.has('company') ||
    fields.has('feature') ||
    fields.has('category')
  return complaintAnalysisSchema.parse({
    ...analysis,
    ...(redactNarrative
      ? {
          problemStatement: evidenceRedactionMarker,
          expectedOutcome: evidenceRedactionMarker,
          observedOutcome: evidenceRedactionMarker,
          consequence: evidenceRedactionMarker,
          affectedWorkflow: evidenceRedactionMarker,
          workaround: evidenceRedactionMarker,
          featureMentions: [evidenceRedactionMarker],
          userSegmentHints: [evidenceRedactionMarker]
        }
      : {}),
    entities: redactAnalysisEntityFields(analysis.entities, fields)
  })
}

function redactedFieldsWith(
  existing: readonly EvidenceRedactionField[] | undefined,
  fields: ReadonlySet<EvidenceRedactionField>
): EvidenceRedactionField[] {
  return [...new Set([...(existing ?? []), ...fields])].sort()
}

function hasNarrativeRedaction(masks: readonly EvidenceRedactionMask[]): boolean {
  return masks.some((mask) => mask.fields.some((field) => field !== 'canonicalLocator'))
}

/** Mask opportunity narratives when a linked evidence field is private. */
export function redactOpportunity(
  opportunity: Opportunity,
  masks: readonly EvidenceRedactionMask[]
): Opportunity {
  if (!hasNarrativeRedaction(masks)) return opportunitySchema.parse(opportunity)
  return opportunitySchema.parse({
    ...opportunity,
    name: evidenceRedactionMarker,
    oneLine: evidenceRedactionMarker,
    thesis: evidenceRedactionMarker,
    audience: evidenceRedactionMarker,
    firstWedge: evidenceRedactionMarker,
    tags: [evidenceRedactionMarker],
    contraryEvidence: [evidenceRedactionMarker],
    competitors: []
  })
}

/** Mask the bounded private opportunity summary without changing its score. */
export function redactOpportunityReadModel(
  summary: WorkspaceOpportunityReadModel,
  masks: readonly EvidenceRedactionMask[]
): WorkspaceOpportunityReadModel {
  if (!hasNarrativeRedaction(masks)) return workspaceOpportunityReadModelSchema.parse(summary)
  return workspaceOpportunityReadModelSchema.parse({
    ...summary,
    name: evidenceRedactionMarker,
    oneLine: evidenceRedactionMarker
  })
}

/** Apply a persisted field mask to an evidence-shaped complaint read model. */
export function redactComplaint(complaint: Complaint, mask: EvidenceRedactionMask): Complaint {
  const fields = new Set(mask.fields)
  const projected = complaintSchema.parse({
    ...complaint,
    ...(fields.has('text') ||
    fields.has('product') ||
    fields.has('company') ||
    fields.has('feature') ||
    fields.has('category')
      ? { query: evidenceRedactionMarker }
      : {}),
    ...(fields.has('text') ? { text: evidenceRedactionMarker } : {}),
    ...(fields.has('product') ? { product: evidenceRedactionMarker } : {}),
    ...(fields.has('company') ? { company: evidenceRedactionMarker } : {}),
    ...(fields.has('feature') ? { feature: evidenceRedactionMarker } : {}),
    ...(fields.has('category') ? { category: evidenceRedactionMarker } : {}),
    ...(fields.has('canonicalLocator') ? { canonicalLocator: null } : {}),
    redacted: true,
    redactedFields: redactedFieldsWith(complaint.redactedFields, fields)
  })
  // Validate the base complaint shape while retaining production-only lineage
  // fields (evidenceId, sourceItemId, evidenceHash) on extended projections.
  return { ...complaint, ...projected }
}

/** Apply evidence masks to a production artifact before a private read. */
export function redactProductionResearchArtifact(
  artifact: ProductionResearchArtifact,
  masks: readonly EvidenceRedactionMask[]
): ProductionResearchArtifact {
  const byEvidenceId = new Map(masks.map((mask) => [mask.evidenceId, new Set(mask.fields)]))
  if (byEvidenceId.size === 0) return productionResearchArtifactSchema.parse(artifact)
  const byComplaintId = new Map(
    artifact.complaints.map((complaint) => [complaint.evidenceId, complaint.id])
  )
  const masksByComplaintId = new Map<string, Set<EvidenceRedactionField>>()
  for (const [evidenceId, fields] of byEvidenceId) {
    const complaintId = byComplaintId.get(evidenceId)
    if (complaintId) masksByComplaintId.set(complaintId, fields)
  }
  return productionResearchArtifactSchema.parse({
    ...artifact,
    opportunity: redactOpportunity(artifact.opportunity, masks),
    complaints: artifact.complaints.map((complaint) => {
      const fields = byEvidenceId.get(complaint.evidenceId)
      return fields
        ? redactComplaint(complaint, { evidenceId: complaint.evidenceId, fields: [...fields] })
        : complaint
    }),
    analyses: artifact.analyses.map((analysis) => {
      const fields = masksByComplaintId.get(analysis.complaintId)
      return fields ? redactComplaintAnalysis(analysis, fields) : analysis
    }),
    clusters: hasNarrativeRedaction(masks)
      ? artifact.clusters.map((cluster) => ({
          ...cluster,
          title: evidenceRedactionMarker,
          summary: evidenceRedactionMarker
        }))
      : artifact.clusters
  })
}

/** Apply evidence masks to persisted report observations without mutating the object. */
export function redactOpportunityReport(
  report: OpportunityReport,
  masks: readonly EvidenceRedactionMask[]
): OpportunityReport {
  const byEvidenceId = new Map(masks.map((mask) => [mask.evidenceId, new Set(mask.fields)]))
  if (byEvidenceId.size === 0) return opportunityReportSchema.parse(report)
  const narrativeRedacted = hasNarrativeRedaction(masks)
  return opportunityReportSchema.parse({
    ...report,
    opportunity: narrativeRedacted
      ? {
          ...report.opportunity,
          name: evidenceRedactionMarker,
          thesis: evidenceRedactionMarker,
          audience: evidenceRedactionMarker,
          firstWedge: evidenceRedactionMarker
        }
      : report.opportunity,
    evidence: {
      ...report.evidence,
      observations: report.evidence.observations.map((observation) => {
        const fields = byEvidenceId.get(observation.evidenceId)
        if (!fields) return observation
        return {
          ...observation,
          ...(narrativeRedacted ? { query: evidenceRedactionMarker } : {}),
          ...(fields.has('text') ? { excerpt: evidenceRedactionMarker } : {}),
          ...(fields.has('product') ? { product: evidenceRedactionMarker } : {}),
          ...(fields.has('feature') ? { feature: evidenceRedactionMarker } : {}),
          ...(fields.has('category') ? { category: evidenceRedactionMarker } : {}),
          ...(fields.has('canonicalLocator') ? { canonicalLocator: null } : {}),
          analysis: observation.analysis
            ? redactComplaintAnalysis(observation.analysis, fields)
            : null,
          redacted: true
        }
      }),
      clusters: report.evidence.clusters.map((cluster) =>
        narrativeRedacted
          ? {
              ...cluster,
              title: evidenceRedactionMarker,
              summary: evidenceRedactionMarker
            }
          : cluster
      )
    },
    inference: narrativeRedacted
      ? {
          ...report.inference,
          contraryEvidence: [evidenceRedactionMarker],
          rationale: [evidenceRedactionMarker]
        }
      : report.inference,
    recommendation: narrativeRedacted
      ? {
          ...report.recommendation,
          firstWedge: evidenceRedactionMarker,
          nextSteps: [evidenceRedactionMarker]
        }
      : report.recommendation
  })
}

/**
 * Plan files are generated from the opportunity narrative and evidence-backed
 * report. Once a linked evidence mask removes narrative fields, the opaque
 * file body cannot be safely field-filtered without parsing every template;
 * preserve the manifest while masking the private file contents.
 */
export function redactPlanPackage(
  planPackage: PlanPackage,
  masks: readonly EvidenceRedactionMask[]
): PlanPackage {
  if (!hasNarrativeRedaction(masks)) return planPackageSchema.parse(planPackage)
  return planPackageSchema.parse({
    ...planPackage,
    files: planPackage.files.map((file) => ({
      ...file,
      content: evidenceRedactionMarker
    }))
  })
}

export type SourcePolicy = z.infer<typeof sourcePolicySchema>
export type SourceQuota = z.infer<typeof sourceQuotaSchema>
export type SourceDeletionPolicy = z.infer<typeof sourceDeletionPolicySchema>
export type SourcePolicyState = z.infer<typeof sourcePolicyStateSchema>
export type SourcePolicyReviewerRole = z.infer<typeof sourcePolicyReviewerRoleSchema>
export type SourcePolicyApprovalInput = z.infer<typeof sourcePolicyApprovalInputSchema>
export type WorkspaceSourceReadModel = z.infer<typeof workspaceSourceReadModelSchema>
export type SourceDeletionEvent = z.infer<typeof sourceDeletionEventSchema>
export type EvidenceRedactionInput = z.infer<typeof evidenceRedactionInputSchema>
export type WorkspaceEvidenceRedactionInput = z.infer<typeof workspaceEvidenceRedactionInputSchema>
export type EvidenceRedactionResult = z.infer<typeof evidenceRedactionResultSchema>
export type Complaint = z.infer<typeof complaintSchema>
export type ComplaintReviewState = z.infer<typeof complaintReviewStateSchema>
export type ComplaintClassification = z.infer<typeof complaintClassificationSchema>
export type ComplaintType = z.infer<typeof complaintTypeSchema>
export type ComplaintEntityReference = z.infer<typeof complaintEntityReferenceSchema>
export type ComplaintEntityResolution = z.infer<typeof complaintEntityResolutionSchema>
export type ComplaintAnalysis = z.infer<typeof complaintAnalysisSchema>
export type ComplaintAnalysisCorrection = z.infer<typeof complaintAnalysisCorrectionSchema>
export type ComplaintCluster = z.infer<typeof complaintClusterSchema>
export type ResearchQualityBenchmarkCase = z.infer<typeof researchQualityBenchmarkCaseSchema>
export type ResearchQualityRankingCase = z.infer<typeof researchQualityRankingCaseSchema>
export type ResearchQualityBenchmark = z.infer<typeof researchQualityBenchmarkSchema>
export type ResearchQualitySnapshot = z.infer<typeof researchQualitySnapshotSchema>
export type CompetitorFeatureMatrixStatus = z.infer<typeof competitorFeatureMatrixStatusSchema>
export type CompetitorFeatureMatrixEvidenceBasis = z.infer<
  typeof competitorFeatureMatrixEvidenceBasisSchema
>
export type CompetitorFeatureMatrixEntry = z.infer<typeof competitorFeatureMatrixEntrySchema>
export type Competitor = z.infer<typeof competitorSchema>
export type ScoreFactors = z.infer<typeof scoreFactorsSchema>
export type BalancedScoreInput = z.infer<typeof balancedScoreInputSchema>
export type ScoreComponentExplanation = z.infer<typeof scoreComponentExplanationSchema>
export type ScoreWeightDimension = z.infer<typeof scoreWeightDimensionSchema>
export type ScoreSnapshotV1 = z.infer<typeof scoreSnapshotV1Schema>
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>
export type Opportunity = z.infer<typeof opportunitySchema>
export type ResearchCampaignState = z.infer<typeof researchCampaignStateSchema>
export type ResearchCampaignRefreshPolicy = z.infer<typeof researchCampaignRefreshPolicySchema>
export type ResearchCampaignConfiguration = z.infer<typeof researchCampaignConfigurationSchema>
export type ResearchCampaignCreateInput = z.infer<typeof researchCampaignCreateInputSchema>
export type ResearchCampaignUpdateInput = z.infer<typeof researchCampaignUpdateInputSchema>
export type ResearchCampaignRefreshScheduleState = z.infer<
  typeof researchCampaignRefreshScheduleStateSchema
>
export type ResearchCampaignRefreshFailureCode = z.infer<
  typeof researchCampaignRefreshFailureCodeSchema
>
export type ResearchCampaignRefreshScheduleReadModel = z.infer<
  typeof researchCampaignRefreshScheduleReadModelSchema
>
export type ResearchCampaignRunInput = z.infer<typeof researchCampaignRunInputSchema>
export type CampaignHistoryCursor = z.infer<typeof campaignHistoryCursorSchema>
export type CampaignHistoryPageQuery = z.infer<typeof campaignHistoryPageQuerySchema>
export type ResearchCampaignRunHistoryPage = z.infer<typeof researchCampaignRunHistoryPageSchema>
export type AuditEventMetadata = z.infer<typeof auditEventMetadataSchema>
export type AuditEventActorType = z.infer<typeof auditEventActorTypeSchema>
export type AuditEventReadModel = z.infer<typeof auditEventReadModelSchema>
export type AuditEventHistoryCursor = z.infer<typeof auditEventHistoryCursorSchema>
export type AuditEventHistoryPageQuery = z.infer<typeof auditEventHistoryPageQuerySchema>
export type AuditEventHistoryPage = z.infer<typeof auditEventHistoryPageSchema>
export type ResearchCampaignOrchestrationState = z.infer<
  typeof researchCampaignOrchestrationStateSchema
>
export type ResearchCampaignOrchestrationSourceState = z.infer<
  typeof researchCampaignOrchestrationSourceStateSchema
>
export type ResearchCampaignOrchestrationFailureCode = z.infer<
  typeof researchCampaignOrchestrationFailureCodeSchema
>
export type ResearchCampaignOrchestrationSourceReadModel = z.infer<
  typeof researchCampaignOrchestrationSourceReadModelSchema
>
export type ResearchCampaignOrchestrationReadModel = z.infer<
  typeof researchCampaignOrchestrationReadModelSchema
>
export type ResearchCampaignOrchestrationHistoryPage = z.infer<
  typeof researchCampaignOrchestrationHistoryPageSchema
>
export type ResearchCampaignOrchestrationCancelResult = z.infer<
  typeof researchCampaignOrchestrationCancelResultSchema
>
export type ProductionCollectionWorkflowCancelResult = z.infer<
  typeof productionCollectionWorkflowCancelResultSchema
>
export type ResearchCampaignSourceReadModel = z.infer<typeof researchCampaignSourceReadModelSchema>
export type ResearchCampaignReadModel = z.infer<typeof researchCampaignReadModelSchema>
export type ResearchArtifact = z.infer<typeof researchArtifactSchema>
export type FixtureResearchArtifact = z.infer<typeof fixtureResearchArtifactSchema>
/** Portable-path representation retained for reading legacy seed reviews. */
export type ProductionOpportunitySeed = z.infer<typeof productionOpportunitySeedStorageSchema>
export type WorkspaceOpportunitySeedReviewState = z.infer<
  typeof workspaceOpportunitySeedReviewStateSchema
>
export type WorkspaceOpportunitySeedCreateInput = z.infer<
  typeof workspaceOpportunitySeedCreateInputSchema
>
export type WorkspaceOpportunitySeedApprovalInput = z.infer<
  typeof workspaceOpportunitySeedApprovalInputSchema
>
export type WorkspaceOpportunitySeedReadModel = z.infer<
  typeof workspaceOpportunitySeedReadModelSchema
>
export type ProductionAnalysisInput = z.infer<typeof productionAnalysisInputSchema>
export type ProductionResearchArtifact = z.infer<typeof productionResearchArtifactSchema>
export type ProductionAnalysisTransport = z.infer<typeof productionAnalysisTransportSchema>
export type ProductionAnalysisComplaint = z.infer<typeof productionAnalysisComplaintSchema>
export type ProductionPolicySnapshot = z.infer<typeof productionPolicySnapshotSchema>
export type ProductionOpportunitySeedReview = z.infer<typeof productionOpportunitySeedReviewSchema>
export type CompetitiveResearchStatus = z.infer<typeof competitiveResearchStatusSchema>
export type CompetitiveResearchSeedReadModel = z.infer<
  typeof competitiveResearchSeedReadModelSchema
>
export type CompetitiveResearchObservation = z.infer<typeof competitiveResearchObservationSchema>
export type CompetitiveResearchObservationCreateInput = z.infer<
  typeof competitiveResearchObservationCreateInputSchema
>
export type CompetitiveResearchObservationReviewInput = z.infer<
  typeof competitiveResearchObservationReviewInputSchema
>
export type CompetitiveResearchReadModel = z.infer<typeof competitiveResearchReadModelSchema>
export type ProductionAnalysisPersistenceInput = z.infer<
  typeof productionAnalysisPersistenceInputSchema
>
export type ProductionAnalysisSnapshot = z.infer<typeof productionAnalysisSnapshotSchema>
export type ProductionAnalysisResult = z.infer<typeof productionAnalysisResultSchema>
export type ProductionAnalysisGovernance = z.infer<typeof productionAnalysisGovernanceSchema>
export type ProductionAnalysisReadModel = z.infer<typeof productionAnalysisReadModelSchema>
export type ProductionAnalysisRunState = z.infer<typeof productionAnalysisRunStateSchema>
export type ProductionAnalysisFailureCode = z.infer<typeof productionAnalysisFailureCodeSchema>
export type ProductionAnalysisActivityAttemptState = z.infer<
  typeof productionAnalysisActivityAttemptStateSchema
>
export type ProductionAnalysisActivityAttemptReadModel = z.infer<
  typeof productionAnalysisActivityAttemptReadModelSchema
>
export type ProductionAnalysisActivityAttemptHistory = z.infer<
  typeof productionAnalysisActivityAttemptHistorySchema
>
export type ProductionAnalysisStatusReadModel = z.infer<
  typeof productionAnalysisStatusReadModelSchema
>
export type ProductionAnalysisHandoffState = z.infer<typeof productionAnalysisHandoffStateSchema>
export type ProductionAnalysisHandoffFailureCode = z.infer<
  typeof productionAnalysisHandoffFailureCodeSchema
>
export type ProductionAnalysisHandoffReadModel = z.infer<
  typeof productionAnalysisHandoffReadModelSchema
>
export type ObjectStorageKind = z.infer<typeof objectStorageKindSchema>
export type ObjectReference = z.infer<typeof objectReferenceSchema>
export type TaskGraph = z.infer<typeof taskGraphSchema>
export type PlanPackage = z.infer<typeof planPackageSchema>
export type FixturePersistenceInput = z.infer<typeof fixturePersistenceInputSchema>
export type FixturePersistenceResult = z.infer<typeof fixturePersistenceResultSchema>
export type FixturePersistenceReadModel = z.infer<typeof fixturePersistenceReadModelSchema>
export type ProductionCollectionRequest = z.infer<typeof productionCollectionRequestSchema>
export type ManualImportFormat = z.infer<typeof manualImportFormatSchema>
export type ManualImportRecord = z.infer<typeof manualImportRecordSchema>
export type ManualImportBatchState = z.infer<typeof manualImportBatchStateSchema>
export type ManualImportBatchCreateInput = z.infer<typeof manualImportBatchCreateInputSchema>
export type ManualImportBatchReadModel = z.infer<typeof manualImportBatchReadModelSchema>
export type ManualImportDeletionResult = z.infer<typeof manualImportDeletionResultSchema>
export type ProductionCollectionPersistenceInput = z.infer<
  typeof productionCollectionPersistenceInputSchema
>
export type ProductionCollectionResult = z.infer<typeof productionCollectionResultSchema>
export type ProductionCollectionSnapshot = z.infer<typeof productionCollectionSnapshotSchema>
export type ProductionCollectionEvidenceReadModel = z.infer<
  typeof productionCollectionEvidenceReadModelSchema
>
export type ProductionCollectionAnalysisSource = z.infer<
  typeof productionCollectionAnalysisSourceSchema
>
export type ProductionCollectionReadModel = z.infer<typeof productionCollectionReadModelSchema>
export type WorkflowJobState = z.infer<typeof workflowJobStateSchema>
export type WorkflowJobCheckpoint = z.infer<typeof workflowJobCheckpointSchema>
export type WorkflowFailureCode = z.infer<typeof workflowFailureCodeSchema>
export type ResearchJobBudget = z.infer<typeof researchJobBudgetSchema>
export type WorkflowActor = z.infer<typeof workflowActorSchema>
export type FixtureResearchWorkflowStartRequest = z.infer<
  typeof fixtureResearchWorkflowStartRequestSchema
>
export type FixtureResearchWorkflowInput = z.infer<typeof fixtureResearchWorkflowInputSchema>
export type FixtureResearchWorkflowHashMaterial = z.infer<
  typeof fixtureResearchWorkflowHashMaterialSchema
>
export type ProductionCollectionWorkflowStartRequest = z.infer<
  typeof productionCollectionWorkflowStartRequestSchema
>
export type SourceSnapshotReconciliationStartRequest = z.infer<
  typeof sourceSnapshotReconciliationStartRequestSchema
>
export type ProductionWorkflowAdmissionDecision = z.infer<
  typeof productionWorkflowAdmissionDecisionSchema
>
export type SourceCollectionLeaseDecision = z.infer<typeof sourceCollectionLeaseDecisionSchema>
export type SourceCollectionLeaseResult = z.infer<typeof sourceCollectionLeaseResultSchema>
export type SourceSnapshotReconciliationState = z.infer<
  typeof sourceSnapshotReconciliationStateSchema
>
export type SourceSnapshotReconciliationFailureCode = z.infer<
  typeof sourceSnapshotReconciliationFailureCodeSchema
>
export type SourceSnapshotReconciliationInput = z.infer<
  typeof sourceSnapshotReconciliationInputSchema
>
export type SourceSnapshotReconciliationResult = z.infer<
  typeof sourceSnapshotReconciliationResultSchema
>
export type SourceSnapshotReconciliationReadModel = z.infer<
  typeof sourceSnapshotReconciliationReadModelSchema
>
export type SourceSnapshotReconciliationPage = z.infer<
  typeof sourceSnapshotReconciliationPageSchema
>
export type ProductionCollectionWorkflowInput = z.infer<
  typeof productionCollectionWorkflowInputSchema
>
export type ProductionCollectionWorkflowHashMaterial = z.infer<
  typeof productionCollectionWorkflowHashMaterialSchema
>
export type ProductionCollectionWorkflowExecutionMetadata = z.infer<
  typeof productionCollectionWorkflowExecutionMetadataSchema
>
export type ProductionCollectionWorkflowResult = z.infer<
  typeof productionCollectionWorkflowResultSchema
>
export type ProductionCollectionWorkflowStatus = z.infer<
  typeof productionCollectionWorkflowStatusSchema
>
export type ResearchCampaignRunReadModel = z.infer<typeof researchCampaignRunReadModelSchema>
export type ProductionCollectionWorkflowJobInitializeInput = z.infer<
  typeof productionCollectionWorkflowJobInitializeInputSchema
>
export type ProductionCollectionWorkflowCheckpointWrite = z.infer<
  typeof productionCollectionWorkflowCheckpointWriteSchema
>
export type PersistProductionCollectionWorkflowActivityInput = z.infer<
  typeof persistProductionCollectionWorkflowActivityInputSchema
>
export type ProductionCollectionWorkflowPersistenceActivityResult = z.infer<
  typeof productionCollectionWorkflowPersistenceActivityResultSchema
>
export type ProductionCollectionWorkflowCompletionInput = z.infer<
  typeof productionCollectionWorkflowCompletionInputSchema
>
export type ProductionCollectionWorkflowTerminationInput = z.infer<
  typeof productionCollectionWorkflowTerminationInputSchema
>
export type ProductionAnalysisWorkflowStartRequest = z.infer<
  typeof productionAnalysisWorkflowStartRequestSchema
>
export type ProductionAnalysisReviewStartRequest = z.infer<
  typeof productionAnalysisReviewStartRequestSchema
>
export type ProductionAnalysisWorkflowInput = z.infer<typeof productionAnalysisWorkflowInputSchema>
export type ProductionAnalysisWorkflowHistoryMemo = z.infer<
  typeof productionAnalysisWorkflowHistoryMemoSchema
>
export type ProductionAnalysisHistoryManifestEntry = z.infer<
  typeof productionAnalysisHistoryManifestEntrySchema
>
export type ProductionAnalysisHistoryManifest = z.infer<
  typeof productionAnalysisHistoryManifestSchema
>
export type ProductionAnalysisWorkflowExecutionMetadata = z.infer<
  typeof productionAnalysisWorkflowExecutionMetadataSchema
>
export type ProductionAnalysisWorkflowResult = z.infer<
  typeof productionAnalysisWorkflowResultSchema
>
export type ProductionAnalysisWorkflowStatus = z.infer<
  typeof productionAnalysisWorkflowStatusSchema
>
export type PersistProductionAnalysisWorkflowActivityInput = z.infer<
  typeof persistProductionAnalysisWorkflowActivityInputSchema
>
export type ProductionAnalysisWorkflowPersistenceActivityResult = z.infer<
  typeof productionAnalysisWorkflowPersistenceActivityResultSchema
>
export type WorkflowExecutionMetadata = z.infer<typeof workflowExecutionMetadataSchema>
export type FixtureResearchInspection = z.infer<typeof fixtureResearchInspectionSchema>
export type WorkflowJobInitializeInput = z.infer<typeof workflowJobInitializeInputSchema>
export type WorkflowJobCheckpointWrite = z.infer<typeof workflowJobCheckpointWriteSchema>
export type PersistFixtureResearchActivityInput = z.infer<
  typeof persistFixtureResearchActivityInputSchema
>
export type FixtureResearchPersistenceActivityResult = z.infer<
  typeof fixtureResearchPersistenceActivityResultSchema
>
export type WorkflowJobCompletionInput = z.infer<typeof workflowJobCompletionInputSchema>
export type WorkflowJobTerminationInput = z.infer<typeof workflowJobTerminationInputSchema>
export type FixtureResearchWorkflowResult = z.infer<typeof fixtureResearchWorkflowResultSchema>
export type FixtureResearchWorkflowStatus = z.infer<typeof fixtureResearchWorkflowStatusSchema>
export type WorkflowJobReadModel = z.infer<typeof workflowJobReadModelSchema>
export type MaintenanceJobId = z.infer<typeof maintenanceJobIdSchema>
export type MaintenanceSchedulerName = z.infer<typeof maintenanceSchedulerNameSchema>
export type MaintenanceSchedulerOwnerId = z.infer<typeof maintenanceSchedulerOwnerIdSchema>
export type MaintenanceSchedulerLeaseToken = z.infer<typeof maintenanceSchedulerLeaseTokenSchema>
export type MaintenanceSchedulerFence = z.infer<typeof maintenanceSchedulerFenceSchema>
export type MaintenanceSchedulerLeaseResult = z.infer<typeof maintenanceSchedulerLeaseResultSchema>
export type MaintenanceSchedulerRenewResult = z.infer<typeof maintenanceSchedulerRenewResultSchema>
export type MaintenanceSchedulerReleaseResult = z.infer<
  typeof maintenanceSchedulerReleaseResultSchema
>
export type MaintenanceSchedulerRunId = z.infer<typeof maintenanceSchedulerRunIdSchema>
export type MaintenanceSchedulerRunState = z.infer<typeof maintenanceSchedulerRunStateSchema>
export type MaintenanceSchedulerCounters = z.infer<typeof maintenanceSchedulerCountersSchema>
export type MaintenanceSchedulerFailureCode = z.infer<typeof maintenanceSchedulerFailureCodeSchema>
export type MaintenanceSchedulerRunMetric = z.infer<typeof maintenanceSchedulerRunMetricSchema>
export type MaintenanceSchedulerRunPurgeInput = z.infer<
  typeof maintenanceSchedulerRunPurgeInputSchema
>
export type MaintenanceSchedulerRunReadModel = z.infer<
  typeof maintenanceSchedulerRunReadModelSchema
>
export type OperationalAlertPayload = z.infer<typeof operationalAlertPayloadSchema>
export type OperationalAlertDeliveryId = z.infer<typeof operationalAlertDeliveryIdSchema>
export type OperationalAlertPayloadHash = z.infer<typeof operationalAlertPayloadHashSchema>
export type OperationalAlertOutboxState = z.infer<typeof operationalAlertOutboxStateSchema>
export type OperationalAlertOutboxEnqueueInput = z.infer<
  typeof operationalAlertOutboxEnqueueInputSchema
>
export type OperationalAlertOutboxClaimInput = z.infer<
  typeof operationalAlertOutboxClaimInputSchema
>
export type OperationalAlertOutboxClaim = z.infer<typeof operationalAlertOutboxClaimSchema>
export type OperationalAlertOutboxCompleteInput = z.infer<
  typeof operationalAlertOutboxCompleteInputSchema
>
export type OperationalAlertOutboxFailureInput = z.infer<
  typeof operationalAlertOutboxFailureInputSchema
>
export type OperationalAlertOutboxPurgeInput = z.infer<
  typeof operationalAlertOutboxPurgeInputSchema
>
export type SourceMaintenanceInput = z.input<typeof sourceMaintenanceInputSchema>
export type SourceMaintenanceResult = z.infer<typeof sourceMaintenanceResultSchema>
export type AuthRetentionInput = z.infer<typeof authRetentionInputSchema>
export type AuthRetentionResult = z.infer<typeof authRetentionResultSchema>
export type AuthRecoveryBatchInput = z.infer<typeof authRecoveryBatchInputSchema>
export type WorkspaceInvitationDeliveryBatchInput = z.infer<
  typeof workspaceInvitationDeliveryBatchInputSchema
>
export type AuthSignUpInput = z.infer<typeof authSignUpInputSchema>
export type AuthSignInInput = z.infer<typeof authSignInInputSchema>
export type AuthExternalIdentityProvider = z.infer<typeof authExternalIdentityProviderSchema>
export type AuthExternalIdentityClaims = z.infer<typeof authExternalIdentityClaimsSchema>
export type AuthExternalIdentityReadModel = z.infer<typeof authExternalIdentityReadModelSchema>
export type AuthMfaEnrollmentConfirmInput = z.infer<typeof authMfaEnrollmentConfirmInputSchema>
export type AuthMfaDisableInput = z.infer<typeof authMfaDisableInputSchema>
export type AuthMfaStepUpInput = z.infer<typeof authMfaStepUpInputSchema>
export type AuthMfaStepUpResult = z.infer<typeof authMfaStepUpResultSchema>
export type AuthMfaSignInInput = z.infer<typeof authMfaSignInInputSchema>
export type AuthMfaStatusReadModel = z.infer<typeof authMfaStatusReadModelSchema>
export type AuthMfaKeyRotationStatus = z.infer<typeof authMfaKeyRotationStatusSchema>
export type AuthMfaKeyRotationRewrapInput = z.infer<typeof authMfaKeyRotationRewrapInputSchema>
export type AuthMfaKeyRotationRewrapResult = z.infer<typeof authMfaKeyRotationRewrapResultSchema>
export type AuthMfaEnrollmentReadModel = z.infer<typeof authMfaEnrollmentReadModelSchema>
export type AuthReauthenticationInput = z.infer<typeof authReauthenticationInputSchema>
export type AuthAccountDeletionInput = z.infer<typeof authAccountDeletionInputSchema>
export type WorkspaceArchiveInput = z.infer<typeof workspaceArchiveInputSchema>
export type WorkspacePurgeRequestInput = z.infer<typeof workspacePurgeRequestInputSchema>
export type WorkspacePurgeRequestId = z.infer<typeof workspacePurgeRequestIdSchema>
export type WorkspacePurgeManifestInput = z.infer<typeof workspacePurgeManifestInputSchema>
export type WorkspacePurgeManifestId = z.infer<typeof workspacePurgeManifestIdSchema>
export type WorkspacePurgeManifestObject = z.infer<typeof workspacePurgeManifestObjectSchema>
export type WorkspacePurgeManifest = z.infer<typeof workspacePurgeManifestSchema>
export type WorkspacePurgeRequestCancelInput = z.infer<
  typeof workspacePurgeRequestCancelInputSchema
>
export type WorkspacePurgeReadinessBlocker = z.infer<typeof workspacePurgeReadinessBlockerSchema>
export type WorkspacePurgeExternalRequirement = z.infer<
  typeof workspacePurgeExternalRequirementSchema
>
export type WorkspacePurgeReadiness = z.infer<typeof workspacePurgeReadinessSchema>
export type WorkspacePurgeRequestState = z.infer<typeof workspacePurgeRequestStateSchema>
export type WorkspacePurgeRequest = z.infer<typeof workspacePurgeRequestSchema>
export type AuthPasswordResetToken = z.infer<typeof authPasswordResetTokenSchema>
export type AgentAccessToken = z.infer<typeof agentAccessTokenSchema>
export type AgentAccessTokenScope = z.infer<typeof agentAccessTokenScopeSchema>
export type AgentAccessTokenCreateInput = z.infer<typeof agentAccessTokenCreateInputSchema>
export type AgentAccessTokenCreateResult = z.infer<typeof agentAccessTokenCreateResultSchema>
export type AgentAccessTokenReadModel = z.infer<typeof agentAccessTokenReadModelSchema>
export type AgentAccessTokenAuthentication = z.infer<typeof agentAccessTokenAuthenticationSchema>
export type AgentAccessAdmissionReason = z.infer<typeof agentAccessAdmissionReasonSchema>
export type AgentAccessAdmissionResult = z.infer<typeof agentAccessAdmissionResultSchema>
export type McpJsonRpcId = z.infer<typeof mcpJsonRpcIdSchema>
export type McpJsonRpcRequest = z.infer<typeof mcpJsonRpcRequestSchema>
export type McpToolCallInput = z.infer<typeof mcpToolCallInputSchema>
export type McpToolTextContent = z.infer<typeof mcpToolTextContentSchema>
export type AuthPasswordResetRequestInput = z.infer<typeof authPasswordResetRequestInputSchema>
export type AuthPasswordResetInput = z.infer<typeof authPasswordResetInputSchema>
export type AuthPasswordResetAcceptedReadModel = z.infer<
  typeof authPasswordResetAcceptedReadModelSchema
>
export type AuthSessionReadModel = z.infer<typeof authSessionReadModelSchema>
export type AuthSessionSummaryReadModel = z.infer<typeof authSessionSummaryReadModelSchema>
export type AuthSessionListReadModel = z.infer<typeof authSessionListReadModelSchema>
export type AuthAccountDeletionResult = z.infer<typeof authAccountDeletionResultSchema>
export type WorkspaceArchiveResult = z.infer<typeof workspaceArchiveResultSchema>
export type WorkspaceCostSummaryQuery = z.infer<typeof workspaceCostSummaryQuerySchema>
export type WorkspaceCostTypeSummary = z.infer<typeof workspaceCostTypeSummarySchema>
export type WorkspaceCurrencyCostSummary = z.infer<typeof workspaceCurrencyCostSummarySchema>
export type WorkspaceCostSummaryReadModel = z.infer<typeof workspaceCostSummaryReadModelSchema>
export type WorkspaceCostAlertObservation = z.infer<typeof workspaceCostAlertObservationSchema>
export type WorkspaceCostAlertInput = z.infer<typeof workspaceCostAlertInputSchema>
export type WorkspaceCostAlertResult = z.infer<typeof workspaceCostAlertResultSchema>
export type SourceQuotaReconciliationListQuery = z.infer<
  typeof sourceQuotaReconciliationListQuerySchema
>
export type SourceQuotaReconciliationCase = z.infer<typeof sourceQuotaReconciliationCaseSchema>
export type SourceQuotaReconciliationResolveInput = z.infer<
  typeof sourceQuotaReconciliationResolveInputSchema
>
export type SourceQuotaReconciliationAlertInput = z.infer<
  typeof sourceQuotaReconciliationAlertInputSchema
>
export type SourceQuotaReconciliationAlertResult = z.infer<
  typeof sourceQuotaReconciliationAlertResultSchema
>
export type ProductionAnalysisRecomputeAlertObservation = z.infer<
  typeof productionAnalysisRecomputeAlertObservationSchema
>
export type ProductionAnalysisRecomputeAlertInput = z.infer<
  typeof productionAnalysisRecomputeAlertInputSchema
>
export type ProductionAnalysisRecomputeAlertResult = z.infer<
  typeof productionAnalysisRecomputeAlertResultSchema
>
export type AuthSignInResult = z.infer<typeof authSignInResultSchema>
export type AuthSignInSuccessResult = z.infer<typeof authSignInSuccessResultSchema>
export type AuthMfaRequiredResult = z.infer<typeof authMfaRequiredResultSchema>
export type AuthUserReadModel = z.infer<typeof authUserReadModelSchema>
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>
export type WorkspaceInvitationRole = z.infer<typeof workspaceInvitationRoleSchema>
export type WorkspaceInvitationCreateInput = z.infer<typeof workspaceInvitationCreateInputSchema>
export type WorkspaceInvitationToken = z.infer<typeof workspaceInvitationTokenSchema>
export type WorkspaceInvitationAcceptInput = z.infer<typeof workspaceInvitationAcceptInputSchema>
export type WorkspaceInvitationAcceptedReadModel = z.infer<
  typeof workspaceInvitationAcceptedReadModelSchema
>
export type WorkspaceInvitationReadModel = z.infer<typeof workspaceInvitationReadModelSchema>
export type WorkspaceMemberRoleUpdateInput = z.infer<typeof workspaceMemberRoleUpdateInputSchema>
export type WorkspaceMembershipReadModel = z.infer<typeof workspaceMembershipReadModelSchema>
export type WorkspaceMemberReadModel = z.infer<typeof workspaceMemberReadModelSchema>
export type WorkspaceOpportunityReadModel = z.infer<typeof workspaceOpportunityReadModelSchema>
export type WorkspaceEvidenceReadModel = z.infer<typeof workspaceEvidenceReadModelSchema>
export type WorkspaceComplaintReviewInput = z.infer<typeof workspaceComplaintReviewInputSchema>
export type WorkspaceComplaintReviewReadModel = z.infer<
  typeof workspaceComplaintReviewReadModelSchema
>
export type ReportSourceCoverage = z.infer<typeof reportSourceCoverageSchema>
export type OpportunityReport = z.infer<typeof opportunityReportSchema>
export type WorkspaceReportReadModel = z.infer<typeof workspaceReportReadModelSchema>
export type WorkspaceReportApprovalInput = z.infer<typeof workspaceReportApprovalInputSchema>
export type WorkspaceReportExportReadModel = z.infer<typeof workspaceReportExportReadModelSchema>
export type WorkspacePlanReadModel = z.infer<typeof workspacePlanReadModelSchema>
export type WorkspacePlanApprovalInput = z.infer<typeof workspacePlanApprovalInputSchema>
export type WorkspacePlanExportReadModel = z.infer<typeof workspacePlanExportReadModelSchema>
export type WorkspaceOpportunityDetailReadModel = z.infer<
  typeof workspaceOpportunityDetailReadModelSchema
>
