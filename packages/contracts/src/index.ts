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
  policyDocumentRef: z.string().url().nullable().default(null),
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
  allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture'])
})

export const complaintReviewStateSchema = z.enum([
  'unreviewed',
  'confirmed',
  'corrected',
  'rejected'
])

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

export const competitorSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['direct', 'adjacent', 'platform', 'workaround', 'do-nothing']),
  positioning: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  relatedComplaintCategories: z.array(z.string())
})

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

export const scoreSnapshotSchema = z.object({
  score: z.number().min(0).max(100),
  version: z.string().min(1),
  calculatedAt: z.string().datetime(),
  factors: scoreFactorsSchema,
  weights: scoreFactorsSchema
})

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

export const appseaIdentifierSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_:-]*$/)

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

/**
 * A production analysis seed is reviewed input, not a model output. The
 * analysis stage may calculate the deterministic score from these factors,
 * but it must not invent willingness-to-pay, feasibility, competitor, or
 * contrary-evidence values from complaint text.
 */
export const productionOpportunitySeedSchema = z
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
    if (new TextEncoder().encode(JSON.stringify(seed)).byteLength > 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Opportunity seed reviews must be at most 1 MB when serialized'
      })
    }
  })

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
    seed: productionOpportunitySeedSchema,
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
  clusters: z.array(complaintClusterSchema).min(1).max(2_000),
  opportunity: opportunitySchema,
  coverageGaps: z.array(z.string()).max(500),
  warnings: z.array(z.string()).max(500)
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
    sourceId: appseaIdentifierSchema,
    query: z.string().max(500),
    product: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
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
        rationale: z.array(z.string().min(1))
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
    requestedAt: z.string().datetime()
  })
  .strict()

export const productionCollectionPersistenceInputSchema = z
  .object({
    request: productionCollectionRequestSchema,
    /** Server-observed collection time; requestedAt remains caller metadata. */
    observedAt: z.string().datetime(),
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
 * provenance cannot be reconstructed by guessing at a later stage.
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

export const productionAnalysisReadModelSchema = z
  .object({
    result: productionAnalysisResultSchema,
    artifact: productionResearchArtifactSchema,
    report: opportunityReportSchema,
    planPackage: planPackageSchema
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
    sourceItemCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    complaintCount: z.number().int().nonnegative(),
    deletionCount: z.number().int().nonnegative(),
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
    text: z.string().max(20_000).nullable(),
    language: z.string().min(2).max(16),
    product: z.string().min(1),
    company: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
    synthetic: z.literal(false),
    redacted: z.boolean(),
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
    /** Optional reviewed seed that enables an automatic analysis handoff. */
    analysisSeedReviewId: appseaIdentifierSchema.optional(),
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

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

export const productionCollectionWorkflowInputSchema = z
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
    analysisSeedReviewId: appseaIdentifierSchema.optional(),
    requestedBy: workflowActorSchema.optional()
  })
  .strict()

export const productionCollectionWorkflowHashMaterialSchema =
  productionCollectionWorkflowInputSchema.omit({ inputHash: true })

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
    result: productionCollectionWorkflowResultSchema.nullable()
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
    failureCode: z.enum([
      'analysis_input_invalid',
      'analysis_policy_denied',
      'analysis_budget_exceeded',
      'analysis_activity_failed',
      'analysis_reconciliation_required'
    ]),
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

export const sourceMaintenanceInputSchema = z
  .object({
    jobId: maintenanceJobIdSchema,
    occurredAt: z.string().datetime(),
    quotaBatchSize: z.number().int().min(1).max(10_000),
    deletionBatchSize: z.number().int().min(1).max(1_000),
    retentionBatchSize: z.number().int().min(1).max(1_000),
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
    workspaceInvitationsDeleted: z.number().int().nonnegative().max(10_000)
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

export const authSessionTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)

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

export const authSignInResultSchema = z
  .object({
    token: authSessionTokenSchema,
    session: authSessionReadModelSchema
  })
  .strict()

export const workspaceOpportunityReadModelSchema = z
  .object({
    id: appseaIdentifierSchema,
    slug: opportunitySlugSchema,
    name: z.string().min(1),
    oneLine: z.string().min(1),
    complaintCount: z.number().int().nonnegative(),
    synthetic: z.boolean(),
    score: z.number().min(0).max(100),
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
    text: z.string().min(1).max(20_000),
    language: z.string().min(2).max(16),
    product: z.string().min(1),
    company: z.string().min(1),
    feature: z.string().min(1),
    category: z.string().min(1),
    synthetic: z.boolean(),
    redacted: z.boolean(),
    allowedRepresentation: z.enum(['excerpt', 'metadata-only', 'aggregate-only', 'fixture']),
    capturedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable()
  })
  .strict()

export const workspaceComplaintReviewActionSchema = z.enum(['confirmed', 'rejected'])

export const workspaceComplaintReviewInputSchema = z
  .object({
    action: workspaceComplaintReviewActionSchema
  })
  .strict()

export const workspaceComplaintReviewReadModelSchema = z
  .object({
    complaintId: appseaIdentifierSchema,
    reviewState: complaintReviewStateSchema
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
    coverageGaps: z.array(z.string()),
    sourceCoverage: z.array(reportSourceCoverageSchema),
    report: workspaceReportReadModelSchema.nullable(),
    plan: workspacePlanReadModelSchema.nullable()
  })
  .strict()

export type SourcePolicy = z.infer<typeof sourcePolicySchema>
export type SourceQuota = z.infer<typeof sourceQuotaSchema>
export type SourceDeletionPolicy = z.infer<typeof sourceDeletionPolicySchema>
export type SourcePolicyState = z.infer<typeof sourcePolicyStateSchema>
export type SourceDeletionEvent = z.infer<typeof sourceDeletionEventSchema>
export type Complaint = z.infer<typeof complaintSchema>
export type ComplaintReviewState = z.infer<typeof complaintReviewStateSchema>
export type ComplaintCluster = z.infer<typeof complaintClusterSchema>
export type Competitor = z.infer<typeof competitorSchema>
export type ScoreFactors = z.infer<typeof scoreFactorsSchema>
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>
export type Opportunity = z.infer<typeof opportunitySchema>
export type ResearchArtifact = z.infer<typeof researchArtifactSchema>
export type FixtureResearchArtifact = z.infer<typeof fixtureResearchArtifactSchema>
export type ProductionOpportunitySeed = z.infer<typeof productionOpportunitySeedSchema>
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
export type ProductionAnalysisPersistenceInput = z.infer<
  typeof productionAnalysisPersistenceInputSchema
>
export type ProductionAnalysisSnapshot = z.infer<typeof productionAnalysisSnapshotSchema>
export type ProductionAnalysisResult = z.infer<typeof productionAnalysisResultSchema>
export type ProductionAnalysisReadModel = z.infer<typeof productionAnalysisReadModelSchema>
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
export type SourceMaintenanceInput = z.infer<typeof sourceMaintenanceInputSchema>
export type SourceMaintenanceResult = z.infer<typeof sourceMaintenanceResultSchema>
export type AuthRetentionInput = z.infer<typeof authRetentionInputSchema>
export type AuthRetentionResult = z.infer<typeof authRetentionResultSchema>
export type AuthRecoveryBatchInput = z.infer<typeof authRecoveryBatchInputSchema>
export type WorkspaceInvitationDeliveryBatchInput = z.infer<
  typeof workspaceInvitationDeliveryBatchInputSchema
>
export type AuthSignUpInput = z.infer<typeof authSignUpInputSchema>
export type AuthSignInInput = z.infer<typeof authSignInInputSchema>
export type AuthReauthenticationInput = z.infer<typeof authReauthenticationInputSchema>
export type AuthAccountDeletionInput = z.infer<typeof authAccountDeletionInputSchema>
export type AuthPasswordResetToken = z.infer<typeof authPasswordResetTokenSchema>
export type AuthPasswordResetRequestInput = z.infer<typeof authPasswordResetRequestInputSchema>
export type AuthPasswordResetInput = z.infer<typeof authPasswordResetInputSchema>
export type AuthPasswordResetAcceptedReadModel = z.infer<
  typeof authPasswordResetAcceptedReadModelSchema
>
export type AuthSessionReadModel = z.infer<typeof authSessionReadModelSchema>
export type AuthSessionSummaryReadModel = z.infer<typeof authSessionSummaryReadModelSchema>
export type AuthSessionListReadModel = z.infer<typeof authSessionListReadModelSchema>
export type AuthAccountDeletionResult = z.infer<typeof authAccountDeletionResultSchema>
export type AuthSignInResult = z.infer<typeof authSignInResultSchema>
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
