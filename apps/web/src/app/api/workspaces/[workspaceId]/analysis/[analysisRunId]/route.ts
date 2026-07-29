import { appseaIdentifierSchema } from '@appsea/contracts'
import {
  PostgresProductionAnalysisRepository,
  ProductionAnalysisAvailabilityError
} from '@appsea/db/production-analysis'
import {
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../server/auth-session'
import { getDatabasePool } from '../../../../../../server/database'
import { getObjectStore } from '../../../../../../server/object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; analysisRunId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, analysisRunId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedAnalysisRunId = appseaIdentifierSchema.safeParse(analysisRunId)
  if (!parsedWorkspaceId.success || !parsedAnalysisRunId.success) {
    return Response.json({ error: 'Invalid analysis path' }, { status: 400 })
  }
  if (!session.workspaces.some((workspace) => workspace.workspaceId === parsedWorkspaceId.data)) {
    return forbiddenResponse()
  }

  try {
    const repository = new PostgresProductionAnalysisRepository(getDatabasePool(), getObjectStore())
    const data = await repository.readForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedAnalysisRunId.data
    )
    if (!data) return Response.json({ error: 'Analysis not found' }, { status: 404 })
    return Response.json({ data }, { headers: privateResponseHeaders })
  } catch (error) {
    if (error instanceof ProductionAnalysisAvailabilityError) {
      return Response.json({ error: 'Analysis is no longer available' }, { status: 410 })
    }
    // Do not expose storage, SQL, or provenance details through the private API.
    return Response.json({ error: 'Analysis could not be read' }, { status: 503 })
  }
}
