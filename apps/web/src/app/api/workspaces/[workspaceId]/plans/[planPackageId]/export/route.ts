import { appseaIdentifierSchema, workspaceExportFormatSchema } from '@appsea/contracts'
import {
  WorkspaceAuthorizationError,
  WorkspacePlanNotApprovedError,
  WorkspacePlanNotReadyError,
  WorkspacePlanNotFoundError,
  WorkspacePlanReportNotApprovedError
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
  context: { params: Promise<{ workspaceId: string; planPackageId: string }> }
): Promise<Response> {
  const session = await readSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId, planPackageId } = await context.params
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  const parsedPlanPackageId = appseaIdentifierSchema.safeParse(planPackageId)
  if (!parsedWorkspaceId.success || !parsedPlanPackageId.success) {
    return Response.json(
      { error: 'Invalid plan path' },
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
      { error: 'Export format must be json, markdown, or zip' },
      { status: 400, headers: privateResponseHeaders }
    )
  }

  try {
    if (parsedFormat.data === 'zip') {
      const data = await authRepository({
        objectStore: getObjectStore()
      }).exportWorkspacePlanBundle(
        session.user.userId,
        parsedWorkspaceId.data,
        parsedPlanPackageId.data
      )
      return new Response(Buffer.from(data.bytes), {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-plan-package-bundle.zip"',
          'content-type': 'application/zip',
          'content-length': String(data.bytes.byteLength),
          'x-appsea-manifest-hash': data.manifestHash,
          'x-appsea-bundle-hash': data.bundleHash
        }
      })
    }
    if (parsedFormat.data === 'markdown') {
      const data = await authRepository({
        objectStore: getObjectStore()
      }).exportWorkspacePlanMarkdown(
        session.user.userId,
        parsedWorkspaceId.data,
        parsedPlanPackageId.data
      )
      return new Response(data.markdown, {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-plan-package.md"',
          'content-type': 'text/markdown; charset=utf-8',
          'x-appsea-manifest-hash': data.manifestHash
        }
      })
    }
    const data = await authRepository({ objectStore: getObjectStore() }).exportWorkspacePlan(
      session.user.userId,
      parsedWorkspaceId.data,
      parsedPlanPackageId.data
    )
    return Response.json(
      { data },
      {
        headers: {
          ...privateResponseHeaders,
          'content-disposition': 'attachment; filename="appsea-plan-package.json"',
          'content-type': 'application/json; charset=utf-8',
          'x-appsea-manifest-hash': data.manifestHash
        }
      }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return forbiddenResponse()
    if (error instanceof WorkspacePlanNotFoundError) {
      return Response.json(
        { error: 'Plan package not found' },
        { status: 404, headers: privateResponseHeaders }
      )
    }
    if (error instanceof WorkspacePlanNotApprovedError) {
      return Response.json(
        { error: 'Only approved plans can be exported' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof WorkspacePlanNotReadyError) {
      return Response.json(
        { error: 'Only ready plans can be exported' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    if (error instanceof WorkspacePlanReportNotApprovedError) {
      return Response.json(
        { error: 'The linked report must be approved before the plan can be exported' },
        { status: 409, headers: privateResponseHeaders }
      )
    }
    console.error('AppSea plan export failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    return Response.json(
      { error: 'Unable to export plan' },
      { status: 500, headers: privateResponseHeaders }
    )
  }
}
