import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { cfpbSourcePolicy } from '@appsea/connectors'
import {
  productionAnalysisInputSchema,
  sourcePolicySchema,
  type ProductionAnalysisInput
} from '@appsea/contracts'
import { generateOpportunityReport, generateProductionPlanPackage } from '@appsea/reports'
import { buildProductionResearchArtifact } from '@appsea/research'

const sampleAt = '2026-07-26T00:00:00.000Z'
const packagePaths = [
  'README.md',
  '01-product-brief.md',
  '02-mvp-scope.md',
  '03-architecture.md',
  '04-task-graph.json',
  '05-validation.md'
] as const

function samplePolicy() {
  return sourcePolicySchema.parse({
    ...cfpbSourcePolicy,
    enabled: true,
    policyState: 'approved',
    policyOwner: 'offline analysis sample; no connector activation',
    accessMethod: `${cfpbSourcePolicy.accessMethod}; test-only in-memory transport`,
    coverageNotes: [
      ...cfpbSourcePolicy.coverageNotes,
      'This approved-shaped policy is used only for a test-only offline composition sample.'
    ]
  })
}

export function buildOfflineCfpbAnalysisSample(): ReturnType<
  typeof buildProductionResearchArtifact
> {
  const policy = samplePolicy()
  const input: ProductionAnalysisInput = productionAnalysisInputSchema.parse({
    collectionArtifactId: 'collection:cfpb-offline-sample-v1',
    runId: 'run:cfpb-offline-sample-v1',
    analysisRunId: 'analysis-run:cfpb-offline-sample-v1',
    transport: 'offline-sample',
    testOnly: true,
    request: {
      workspaceId: 'workspace:analysis-sample',
      campaignId: 'campaign:analysis-sample',
      runId: 'run:cfpb-offline-sample-v1',
      idempotencyKey: 'analysis-sample-cfpb-v1',
      sourceId: policy.sourceId,
      policyVersion: 'cfpb-offline-sample-v1',
      query: 'shared inbox handoff',
      limit: 3,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt',
      budget: {
        currency: 'USD',
        maxSourceItems: 3,
        maxCostMicros: 0,
        maxActivityAttempts: 1
      },
      requestedAt: sampleAt
    },
    policySnapshot: {
      sourceId: policy.sourceId,
      policyVersion: 'cfpb-offline-sample-v1',
      contentHash: 'a'.repeat(64),
      reviewId: 'review:cfpb-offline-sample-v1',
      policy: {
        ...policy,
        policyOwner: 'offline analysis sample; no connector activation'
      }
    },
    complaints: [
      {
        id: 'cfpb-sample-complaint-1001',
        evidenceId: 'evidence:cfpb-sample-1001',
        sourceItemId: 'source-item:cfpb-sample-1001',
        evidenceHash: '1'.repeat(64),
        sourceId: policy.sourceId,
        sourceRecordId: '1001',
        capturedAt: '2026-07-25T00:00:00.000Z',
        publishedAt: null,
        query: 'shared inbox handoff',
        product: 'Example Inbox',
        company: 'Example Company',
        feature: 'ownership history',
        category: 'handoff loss',
        text: 'The next teammate cannot see the ownership history after a handoff.',
        language: 'en',
        synthetic: false,
        redacted: true,
        allowedRepresentation: 'excerpt'
      },
      {
        id: 'cfpb-sample-complaint-1002',
        evidenceId: 'evidence:cfpb-sample-1002',
        sourceItemId: 'source-item:cfpb-sample-1002',
        evidenceHash: '2'.repeat(64),
        sourceId: policy.sourceId,
        sourceRecordId: '1002',
        capturedAt: '2026-07-25T00:00:00.000Z',
        publishedAt: null,
        query: 'shared inbox handoff',
        product: 'Example Inbox',
        company: 'Example Company',
        feature: 'reassignment audit',
        category: 'accountability gap',
        text: 'A reassigned conversation does not show who changed its owner.',
        language: 'en',
        synthetic: false,
        redacted: true,
        allowedRepresentation: 'excerpt'
      },
      {
        id: 'cfpb-sample-complaint-1003',
        evidenceId: 'evidence:cfpb-sample-1003',
        sourceItemId: 'source-item:cfpb-sample-1003',
        evidenceHash: '3'.repeat(64),
        sourceId: policy.sourceId,
        sourceRecordId: '1003',
        capturedAt: '2026-07-25T00:00:00.000Z',
        publishedAt: null,
        query: 'shared inbox handoff',
        product: 'Example Inbox',
        company: 'Example Company',
        feature: 'handoff notes',
        category: 'stale handoff',
        text: 'Manual handoff notes become stale before the next shift starts.',
        language: 'en',
        synthetic: false,
        redacted: true,
        allowedRepresentation: 'excerpt'
      }
    ],
    deletions: [],
    coverageGaps: [
      'This payload is a test-only offline sample, not a statistical sample.',
      'No competitor or contrary-evidence source was included.',
      'The CFPB connector remains pending review and was not activated.'
    ],
    warnings: [
      'Test-only production-shaped transport; do not present this artifact as market research.'
    ],
    opportunitySeed: {
      seed: {
        id: 'opportunity:cfpb-offline-sample',
        slug: 'handoff-audit-sample',
        name: 'Handoff Audit Sample',
        oneLine: 'A test-only seed for reviewing shared-inbox handoff evidence.',
        thesis:
          'The supplied observations describe handoff visibility problems, but this offline sample cannot establish demand or market size.',
        audience: 'Test readers reviewing source-policy and report boundaries.',
        firstWedge: 'Read-only ownership history and shift handoff review.',
        tags: ['test-only', 'shared-inbox'],
        competitors: [],
        contraryEvidence: [
          'No competitor or workaround research is present in the offline sample.'
        ],
        scoreFactors: {
          complaintVolume: 10,
          painSeverity: 30,
          recurrence: 20,
          willingnessToPay: 0,
          competitiveGap: 0,
          buildFeasibility: 30,
          evidenceQuality: 25,
          contraryEvidencePenalty: 90
        },
        planFiles: [...packagePaths]
      },
      seedVersion: 'handoff-audit-sample-seed-v1',
      contentHash: 'b'.repeat(64),
      reviewId: 'review:handoff-audit-sample-v1',
      reviewedBy: 'offline analysis sample; no connector activation',
      reviewedAt: sampleAt
    },
    analysisAt: sampleAt
  })
  return buildProductionResearchArtifact(input)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

export async function writeOfflineCfpbAnalysisSample(
  root = resolve(import.meta.dirname, '../../..')
) {
  const artifact = buildOfflineCfpbAnalysisSample()
  const generatedAt = artifact.createdAt
  const report = generateOpportunityReport(artifact, generatedAt)
  const plan = generateProductionPlanPackage(artifact, generatedAt)
  const outputDirectory = resolve(root, 'artifacts/analysis-sample')
  await mkdir(outputDirectory, { recursive: true })
  await writeAtomically(
    resolve(outputDirectory, 'analysis-artifact.json'),
    `${JSON.stringify(artifact, null, 2)}\n`
  )
  await writeAtomically(
    resolve(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  const fileHashes: Record<string, string> = {}
  for (const file of plan.files) {
    const filePath = resolve(outputDirectory, 'plan', file.path)
    await mkdir(resolve(filePath, '..'), { recursive: true })
    await writeAtomically(filePath, `${file.content}\n`)
    fileHashes[file.path] = digest(file.content)
  }
  await writeAtomically(
    resolve(outputDirectory, 'manifest.json'),
    `${JSON.stringify(
      {
        artifactId: artifact.id,
        reportArtifactId: report.artifactId,
        planOpportunitySlug: plan.opportunitySlug,
        generatedAt,
        testOnly: artifact.testOnly,
        transport: artifact.transport,
        files: fileHashes
      },
      null,
      2
    )}\n`
  )
  return { artifact, report, plan, outputDirectory }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await writeOfflineCfpbAnalysisSample()
  console.log(`wrote test-only production-shaped analysis sample to ${result.outputDirectory}`)
  console.log(
    `analysis artifact: ${result.artifact.complaints.length} complaints, ${result.artifact.clusters.length} clusters, score ${result.artifact.opportunity.scoreSnapshot.score}`
  )
}
