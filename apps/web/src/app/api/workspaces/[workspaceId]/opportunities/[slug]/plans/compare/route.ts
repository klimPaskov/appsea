import {
  appseaIdentifierSchema,
  opportunitySlugSchema,
  planPackageSchema,
  workspacePlanComparisonSchema
} from '@appsea/contracts'
import { WorkspaceAuthorizationError } from '@appsea/db/auth'
import { comparePlanPackages } from '@appsea/reports'
import {
  authRepository,
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../../server/auth-session'
import { getObjectStore } from '../../../../../../../../server/object-store'
import { decodePathParam } from '../../../../../../../../server/path-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; slug: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const params = await context.params
  const workspaceId = appseaIdentifierSchema.safeParse(decodePathParam(params.workspaceId))
  const slug = opportunitySlugSchema.safeParse(decodePathParam(params.slug))
  const query = new URL(request.url).searchParams
  const queryKeys = [...new Set([...query.keys()])]
  const fromValues = query.getAll('from')
  const toValues = query.getAll('to')
  const fromId = appseaIdentifierSchema.safeParse(fromValues[0] ?? '')
  const toId = appseaIdentifierSchema.safeParse(toValues[0] ?? '')
  if (
    !workspaceId.success ||
    !slug.success ||
    queryKeys.some((key) => key !== 'from' && key !== 'to') ||
    fromValues.length !== 1 ||
    toValues.length !== 1 ||
    !fromId.success ||
    !toId.success
  ) {
    return Response.json(
      { error: 'workspace, opportunity, from, and to are required' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    const repository = authRepository({ objectStore: getObjectStore() })
    const opportunity = (
      await repository.listWorkspaceOpportunities(session.user.userId, workspaceId.data)
    ).find((candidate) => candidate.slug === slug.data)
    if (!opportunity) {
      return Response.json(
        { error: 'Opportunity not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    const history = await repository.listWorkspaceArtifactHistoryForUser(
      session.user.userId,
      workspaceId.data,
      opportunity.id
    )
    const fromSummary = history.plans.find((plan) => plan.id === fromId.data)
    const toSummary = history.plans.find((plan) => plan.id === toId.data)
    if (!fromSummary || !toSummary) {
      return Response.json(
        { error: 'Plan version not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    const [from, to] = await Promise.all([
      repository.readWorkspacePlanVersionForUser(
        session.user.userId,
        workspaceId.data,
        fromId.data,
        opportunity.id
      ),
      repository.readWorkspacePlanVersionForUser(
        session.user.userId,
        workspaceId.data,
        toId.data,
        opportunity.id
      )
    ])
    if (!from || !to) {
      return Response.json(
        { error: 'Plan version is unavailable for comparison' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    const comparison = comparePlanPackages(
      planPackageSchema.parse({
        opportunitySlug: slug.data,
        generatedAt: from.generatedAt,
        files: from.files
      }),
      planPackageSchema.parse({
        opportunitySlug: slug.data,
        generatedAt: to.generatedAt,
        files: to.files
      })
    )
    const data = workspacePlanComparisonSchema.parse({
      from: fromSummary,
      to: toSummary,
      files: comparison.files.map((file) => ({
        path: file.path,
        status: file.state,
        beforeHash: file.before?.hash ?? null,
        afterHash: file.after?.hash ?? null,
        beforeBytes: file.before?.bytes ?? null,
        afterBytes: file.after?.bytes ?? null
      })),
      addedCount: comparison.added.length,
      removedCount: comparison.removed.length,
      changedCount: comparison.changed.length,
      unchangedCount: comparison.unchanged.length
    })
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    console.error('AppSea plan comparison failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to compare plan versions' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
