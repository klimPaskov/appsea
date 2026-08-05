import {
  appseaIdentifierSchema,
  composeCompetitiveResearchReadModel,
  opportunitySlugSchema,
  resolveOpportunityStateForRead,
  workspaceEvidenceReadModelSchema,
  workspaceOpportunityDetailReadModelSchema,
  workspaceOpportunityReadModelSchema,
  workspacePlanReadModelSchema,
  workspaceReportReadModelSchema,
  type AuthSessionReadModel,
  type CompetitiveResearchObservation,
  type ProductionAnalysisReadModel,
  type WorkspaceOpportunityDetailReadModel,
  type WorkspaceCompetitorTarget,
  type WorkspaceMembershipReadModel
} from '@appsea/contracts'
import { PostgresCompetitiveResearchRepository } from '@appsea/db/competitive-research'
import { PostgresDeepResearchGateRepository } from '@appsea/db/deep-research-gate'
import { PostgresProductionAnalysisRepository } from '@appsea/db/production-analysis'
import { authRepository, readSession } from './auth-session'
import { getDatabasePool } from './database'
import { getObjectStore } from './object-store'
import { decodePathParam } from './path-params'

export interface PrivateOpportunityContext {
  session: AuthSessionReadModel
  workspace: WorkspaceMembershipReadModel
  detail: WorkspaceOpportunityDetailReadModel
  competitorTargets: WorkspaceCompetitorTarget[]
}

/** Map a validated production analysis into the private opportunity read model. */
export function mapProductionAnalysisToOpportunityDetail(
  model: ProductionAnalysisReadModel,
  observations: CompetitiveResearchObservation[] = [],
  deepResearchGate: WorkspaceOpportunityDetailReadModel['deepResearchGate'] = null
): WorkspaceOpportunityDetailReadModel {
  const { artifact, result, report, planPackage } = model
  const opportunity = artifact.opportunity
  const competitiveResearch = composeCompetitiveResearchReadModel({
    synthetic: false,
    coverageGaps: artifact.coverageGaps,
    observations,
    seedReview: {
      reviewId: artifact.opportunitySeedReview.reviewId,
      seedVersion: artifact.opportunitySeedReview.seedVersion,
      contentHash: artifact.opportunitySeedReview.contentHash,
      reviewedBy: artifact.opportunitySeedReview.reviewedBy,
      reviewedAt: artifact.opportunitySeedReview.reviewedAt
    }
  })
  const summary = workspaceOpportunityReadModelSchema.parse({
    id: opportunity.id,
    slug: opportunity.slug,
    name: opportunity.name,
    oneLine: opportunity.oneLine,
    complaintCount: opportunity.complaintCount,
    synthetic: false,
    score: opportunity.scoreSnapshot.score,
    ...('rawScore' in opportunity.scoreSnapshot
      ? {
          rawScore: opportunity.scoreSnapshot.rawScore,
          riskAdjustedScore: opportunity.scoreSnapshot.riskAdjustedScore,
          rankingScore: opportunity.scoreSnapshot.rankingScore,
          evidenceConfidence: opportunity.scoreSnapshot.evidenceConfidence
        }
      : {}),
    scoreVersion: opportunity.scoreSnapshot.version,
    scoreCalculatedAt: opportunity.scoreSnapshot.calculatedAt,
    state: resolveOpportunityStateForRead({
      synthetic: false,
      persistedState: 'researched',
      competitiveResearchStatus: competitiveResearch.status,
      coverageGaps: artifact.coverageGaps,
      deepResearchGatePassed: deepResearchGate?.status === 'passed'
    }),
    currentReportId: result.reportId,
    currentPlanPackageId: result.planPackageId
  })
  const evidence = artifact.complaints.map((complaint) =>
    workspaceEvidenceReadModelSchema.parse({
      id: complaint.evidenceId,
      sourceItemId: complaint.sourceItemId,
      canonicalLocator: complaint.canonicalLocator,
      text: complaint.text,
      language: complaint.language,
      product: complaint.product,
      company: complaint.company,
      feature: complaint.feature,
      category: complaint.category,
      analysis:
        model.artifact.analyses.find((analysis) => analysis.complaintId === complaint.id) ??
        (() => {
          throw new Error(`Missing complaint analysis for ${complaint.id}`)
        })(),
      deduplication:
        artifact.deduplication.find((decision) => decision.complaintId === complaint.id) ?? null,
      synthetic: false,
      redacted: complaint.redacted,
      allowedRepresentation: complaint.allowedRepresentation,
      capturedAt: complaint.capturedAt,
      publishedAt: complaint.publishedAt
    })
  )
  return workspaceOpportunityDetailReadModelSchema.parse({
    opportunity,
    summary,
    evidence,
    competitiveResearch,
    deepResearchGate,
    coverageGaps: artifact.coverageGaps,
    sourceCoverage: report.coverage.sources,
    report: workspaceReportReadModelSchema.parse({
      id: result.reportId,
      version: 'production-report-v1',
      structuredReport: report,
      generatedAt: report.generatedAt,
      approvalState: model.governance.reportApprovalState
    }),
    plan: workspacePlanReadModelSchema.parse({
      id: result.planPackageId,
      version: 'production-plan-v1',
      files: planPackage.files,
      generatedAt: planPackage.generatedAt,
      readinessState: 'ready',
      approvalState: model.governance.planApprovalState,
      synthetic: false
    })
  })
}

/** Read one workspace-bound opportunity without relying on browser cookies. */
export async function readPrivateOpportunityDetailForUser(
  userId: string,
  workspaceId: string,
  slug: string
): Promise<WorkspaceOpportunityDetailReadModel | null> {
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(decodePathParam(workspaceId))
  const parsedSlug = opportunitySlugSchema.safeParse(decodePathParam(slug))
  if (!parsedWorkspaceId.success || !parsedSlug.success) return null
  const repository = authRepository()
  const listed = (await repository.listWorkspaceOpportunities(userId, parsedWorkspaceId.data)).find(
    (opportunity) => opportunity.slug === parsedSlug.data
  )
  if (listed && !listed.synthetic) {
    const competitiveResearchRepository = new PostgresCompetitiveResearchRepository(
      getDatabasePool()
    )
    const production = await new PostgresProductionAnalysisRepository(
      getDatabasePool(),
      getObjectStore()
    ).readLatestForOpportunityForUser(userId, parsedWorkspaceId.data, parsedSlug.data)
    if (production) {
      const observations = await competitiveResearchRepository.listForUser(
        userId,
        parsedWorkspaceId.data,
        production.artifact.opportunity.id
      )
      const deepResearchGate = await new PostgresDeepResearchGateRepository(
        getDatabasePool(),
        getObjectStore()
      ).readForUser(userId, parsedWorkspaceId.data, production.artifact.opportunity.id)
      return mapProductionAnalysisToOpportunityDetail(production, observations, deepResearchGate)
    }
  }
  const detail = await repository.readWorkspaceOpportunity(
    userId,
    parsedWorkspaceId.data,
    parsedSlug.data
  )
  if (!detail) return null
  const observations = await new PostgresCompetitiveResearchRepository(
    getDatabasePool()
  ).listForUser(userId, parsedWorkspaceId.data, detail.opportunity.id)
  const competitiveResearch = composeCompetitiveResearchReadModel({
    synthetic: detail.competitiveResearch.synthetic,
    coverageGaps: detail.competitiveResearch.coverageGaps,
    seedReview: detail.competitiveResearch.seedReview,
    observedAt: detail.competitiveResearch.observedAt,
    sourceIds: detail.competitiveResearch.sourceIds,
    evidenceIds: detail.competitiveResearch.evidenceIds,
    observations
  })
  const deepResearchGate = await new PostgresDeepResearchGateRepository(
    getDatabasePool(),
    getObjectStore()
  ).readForUser(userId, parsedWorkspaceId.data, detail.opportunity.id)
  const summary = workspaceOpportunityReadModelSchema.parse({
    ...detail.summary,
    state: resolveOpportunityStateForRead({
      synthetic: detail.summary.synthetic,
      persistedState: detail.summary.state,
      competitiveResearchStatus: competitiveResearch.status,
      coverageGaps: detail.coverageGaps,
      deepResearchGatePassed: deepResearchGate?.status === 'passed'
    })
  })
  return workspaceOpportunityDetailReadModelSchema.parse({
    ...detail,
    summary,
    competitiveResearch,
    deepResearchGate
  })
}

export async function readPrivateOpportunityContext(
  workspaceId: string,
  slug: string
): Promise<PrivateOpportunityContext | null> {
  const session = await readSession()
  if (!session) return null
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(decodePathParam(workspaceId))
  const parsedSlug = opportunitySlugSchema.safeParse(decodePathParam(slug))
  if (!parsedWorkspaceId.success || !parsedSlug.success) return null
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) return null
  const detail = await readPrivateOpportunityDetailForUser(
    session.user.userId,
    parsedWorkspaceId.data,
    parsedSlug.data
  )
  if (!detail) return null
  const competitorTargets = await new PostgresCompetitiveResearchRepository(
    getDatabasePool()
  ).listTargetsForUser(session.user.userId, parsedWorkspaceId.data, detail.opportunity.id)
  return { session, workspace, detail, competitorTargets }
}
