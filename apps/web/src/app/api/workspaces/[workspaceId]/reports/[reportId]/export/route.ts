import { appseaIdentifierSchema, workspaceExportFormatSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspaceReportNotApprovedError,
  WorkspaceReportNotFoundError
} from '@appsea/db/auth'
import {
  authRepository,
  forbiddenResponse,
  privateResponseHeaders,
  readSession,
  unauthorizedResponse
} from '../../../../../../../server/auth-session'
import { getObjectStore } from '../../../../../../../server/object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; reportId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, reportId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedReportId = appseaIdentifierSchema.safeParse(reportId)
  if (!parsedWorkspaceId.success || !parsedReportId.success) {
    return Response.json(
      { error: 'Invalid report path' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  const formatValues = new URL(request.url).searchParams.getAll('format')
  if (formatValues.length > 1) {
    return Response.json(
      { error: 'Export format may be provided only once' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  const parsedFormat = workspaceExportFormatSchema.safeParse(formatValues[0] ?? 'json')
  if (!parsedFormat.success) {
    return Response.json(
      { error: 'Export format must be json or markdown' },
      { status: 400, headers: privateResponseHeaders }
    )
  }
  const format = parsedFormat.data

  try {
    if (format === 'markdown') {
      const data = await authRepository({
        objectStore: getObjectStore()
      }).exportWorkspaceReportMarkdown(
        session.user.userId,
        parsedWorkspaceId.data,
        parsedReportId.data
      )
      return new Response(data.markdown, {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-report.md"',
          'content-type': 'text/markdown; charset=utf-8',
          'x-appsea-manifest-hash': data.manifestHash
        }
      })
    }
    const data = await authRepository({ objectStore: getObjectStore() }).exportWorkspaceReport(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedReportId.data
    )
    return Response.json(
      { data },
      {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-report.json"',
          'content-type': 'application/json; charset=utf-8',
          'x-appsea-manifest-hash': data.manifestHash
        }
      }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    if (error instanceof WorkspaceReportNotFoundError) {
      return Response.json(
        { error: 'Report not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof WorkspaceReportNotApprovedError) {
      return Response.json(
        { error: 'Only approved reports can be exported' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea report export failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to export report' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
