import {
  appseaIdentifierSchema,
  opportunitySlugSchema,
  workspaceEvidenceReadModelSchema,
  workspaceOpportunityDetailReadModelSchema,
  workspaceOpportunityReadModelSchema,
  workspacePlanReadModelSchema,
  workspaceReportReadModelSchema,
  type AuthSessionReadModel,
  type ProductionAnalysisReadModel,
  type WorkspaceOpportunityDetailReadModel,
  type WorkspaceMembershipReadModel
} from '@appsea/contracts'
import { PostgresProductionAnalysisRepository } from '@appsea/db/production-analysis'
import { authRepository, readSession } from './auth-session'
import { getDatabasePool } from './database'
import { getObjectStore } from './object-store'

export interface PrivateOpportunityContext {
  session: AuthSessionReadModel
  workspace: WorkspaceMembershipReadModel
  detail: WorkspaceOpportunityDetailReadModel
}

function productionDetail(model: ProductionAnalysisReadModel): WorkspaceOpportunityDetailReadModel {
  const { artifact, result, report, planPackage } = model
  const opportunity = artifact.opportunity
  const summary = workspaceOpportunityReadModelSchema.parse({
    id: opportunity.id,
    slug: opportunity.slug,
    name: opportunity.name,
    oneLine: opportunity.oneLine,
    complaintCount: opportunity.complaintCount,
    synthetic: false,
    score: opportunity.scoreSnapshot.score,
    scoreVersion: opportunity.scoreSnapshot.version,
    scoreCalculatedAt: opportunity.scoreSnapshot.calculatedAt,
    state: 'researched',
    currentReportId: result.reportId,
    currentPlanPackageId: result.planPackageId
  })
  const evidence = artifact.complaints.map((complaint) =>
    workspaceEvidenceReadModelSchema.parse({
      id: complaint.evidenceId,
      sourceItemId: complaint.sourceItemId,
      text: complaint.text,
      language: complaint.language,
      product: complaint.product,
      company: complaint.company,
      feature: complaint.feature,
      category: complaint.category,
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
    coverageGaps: artifact.coverageGaps,
    sourceCoverage: report.coverage.sources,
    report: workspaceReportReadModelSchema.parse({
      id: result.reportId,
      version: 'production-report-v1',
      structuredReport: report,
      generatedAt: report.generatedAt,
      approvalState: 'draft'
    }),
    plan: workspacePlanReadModelSchema.parse({
      id: result.planPackageId,
      version: 'production-plan-v1',
      files: planPackage.files,
      generatedAt: planPackage.generatedAt,
      readinessState: 'ready',
      approvalState: 'unreviewed',
      synthetic: false
    })
  })
}

export async function readPrivateOpportunityContext(
  workspaceId: string,
  slug: string
): Promise<PrivateOpportunityContext | null> {
  const session = await readSession()
  if (!session) return null
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedSlug = opportunitySlugSchema.safeParse(slug)
  if (!parsedWorkspaceId.success || !parsedSlug.success) return null
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace) return null
  const repository = authRepository()
  const listed = (
    await repository.listWorkspaceOpportunities(session.user.userId, parsedWorkspaceId.data)
  ).find((opportunity) => opportunity.slug === parsedSlug.data)
  if (listed && !listed.synthetic) {
    const production = await new PostgresProductionAnalysisRepository(
      getDatabasePool(),
      getObjectStore()
    ).readLatestForOpportunityForUser(session.user.userId, parsedWorkspaceId.data, parsedSlug.data)
    if (production) return { session, workspace, detail: productionDetail(production) }
  }
  const detail = await repository.readWorkspaceOpportunity(
    session.user.userId,
    parsedWorkspaceId.data,
    parsedSlug.data
  )
  if (!detail) return null
  return { session, workspace, detail }
}
