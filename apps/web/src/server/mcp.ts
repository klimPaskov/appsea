import {
  appseaIdentifierSchema,
  mcpJsonRpcRequestSchema,
  mcpToolCallInputSchema,
  opportunitySlugSchema,
  type AgentAccessTokenAuthentication,
  type AgentAccessTokenScope,
  type McpJsonRpcId,
  type WorkspaceOpportunityDetailReadModel,
  type WorkspaceOpportunityReadModel,
  type WorkspaceSourceReadModel
} from '@appsea/contracts'
import { PostgresAgentAccessTokenRepository } from '@appsea/db/agent-access-token'
import { PostgresSourcePolicyRepository } from '@appsea/db/source-policy'
import { authRepository } from './auth-session'
import { getDatabasePool } from './database'
import { readPrivateOpportunityDetailForUser } from './private-opportunity'

export const mcpProtocolVersion = '2025-06-18'
export const mcpServerName = 'appsea-readonly'
export const mcpServerVersion = '0.4.0'

const maxRequestBytes = 64 * 1024
const maxResponseTextBytes = 500 * 1024

type JsonRpcError = {
  code: number
  message: string
}

export interface McpDependencies {
  authenticate: (token: string) => Promise<AgentAccessTokenAuthentication | null>
  listOpportunities: (
    userId: string,
    workspaceId: string
  ) => Promise<WorkspaceOpportunityReadModel[]>
  readOpportunity: (
    userId: string,
    workspaceId: string,
    slug: string
  ) => Promise<WorkspaceOpportunityDetailReadModel | null>
  listSources: (userId: string, workspaceId: string) => Promise<WorkspaceSourceReadModel[]>
}

export function defaultMcpDependencies(): McpDependencies {
  return {
    authenticate: (token) =>
      new PostgresAgentAccessTokenRepository(getDatabasePool()).authenticate(token),
    listOpportunities: (userId, workspaceId) =>
      authRepository().listWorkspaceOpportunities(userId, workspaceId),
    readOpportunity: readPrivateOpportunityDetailForUser,
    listSources: (userId, workspaceId) =>
      new PostgresSourcePolicyRepository(getDatabasePool()).listForUser(userId, workspaceId)
  }
}

function responseHeaders(): Record<string, string> {
  return {
    'cache-control': 'private, no-store',
    'content-type': 'application/json'
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders() })
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { ...responseHeaders(), 'www-authenticate': 'Bearer' }
  })
}

function jsonRpcError(id: McpJsonRpcId | undefined, error: JsonRpcError): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, error })
}

function jsonRpcResult(id: McpJsonRpcId | undefined, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result })
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer\s+([^\s]+)$/i.exec(header)
  return match?.[1] ?? null
}

async function readBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && Number.isSafeInteger(Number(declaredLength))) {
    if (Number(declaredLength) > maxRequestBytes) throw new Error('request too large')
  }
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > maxRequestBytes) {
    throw new Error('request too large')
  }
  return JSON.parse(body) as unknown
}

function workspaceIdArgument(args: Record<string, unknown>): string | null {
  const parsed = appseaIdentifierSchema.safeParse(args.workspaceId)
  return parsed.success ? parsed.data : null
}

function slugArgument(args: Record<string, unknown>): string | null {
  const parsed = opportunitySlugSchema.safeParse(args.slug)
  return parsed.success ? parsed.data : null
}

function limitArgument(args: Record<string, unknown>): number | null {
  if (args.limit === undefined) return 20
  return typeof args.limit === 'number' &&
    Number.isSafeInteger(args.limit) &&
    args.limit >= 1 &&
    args.limit <= 100
    ? args.limit
    : null
}

function hasScope(auth: AgentAccessTokenAuthentication, scope: AgentAccessTokenScope): boolean {
  return auth.scopes.includes(scope)
}

function authorizeWorkspace(
  auth: AgentAccessTokenAuthentication,
  args: Record<string, unknown>
): string | null {
  const workspaceId = workspaceIdArgument(args)
  return workspaceId === auth.workspaceId ? workspaceId : null
}

function toolDefinitions(auth: AgentAccessTokenAuthentication) {
  const tools: Array<Record<string, unknown>> = []
  if (hasScope(auth, 'opportunities:read')) {
    tools.push(
      {
        name: 'appsea.search_opportunities',
        description: 'Search the authenticated private workspace opportunity summaries.',
        inputSchema: {
          type: 'object',
          properties: {
            workspaceId: { type: 'string' },
            query: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          },
          required: ['workspaceId'],
          additionalProperties: false
        }
      },
      {
        name: 'appsea.get_opportunity',
        description: 'Read one authenticated private opportunity without evidence text.',
        inputSchema: {
          type: 'object',
          properties: { workspaceId: { type: 'string' }, slug: { type: 'string' } },
          required: ['workspaceId', 'slug'],
          additionalProperties: false
        }
      }
    )
  }
  if (hasScope(auth, 'evidence:read')) {
    tools.push({
      name: 'appsea.get_evidence_refs',
      description: 'Read policy-bounded evidence references for one opportunity.',
      inputSchema: {
        type: 'object',
        properties: { workspaceId: { type: 'string' }, slug: { type: 'string' } },
        required: ['workspaceId', 'slug'],
        additionalProperties: false
      }
    })
  }
  if (hasScope(auth, 'reports:read')) {
    tools.push({
      name: 'appsea.get_report',
      description: 'Read an approved report or an explicitly synthetic fixture report.',
      inputSchema: {
        type: 'object',
        properties: { workspaceId: { type: 'string' }, slug: { type: 'string' } },
        required: ['workspaceId', 'slug'],
        additionalProperties: false
      }
    })
  }
  if (hasScope(auth, 'plans:read')) {
    tools.push({
      name: 'appsea.get_plan_package',
      description:
        'Read an approved coding-agent plan package or an explicitly synthetic fixture package.',
      inputSchema: {
        type: 'object',
        properties: { workspaceId: { type: 'string' }, slug: { type: 'string' } },
        required: ['workspaceId', 'slug'],
        additionalProperties: false
      }
    })
  }
  return tools
}

function resourceUri(workspaceId: string, suffix: string): string {
  return `appsea://workspaces/${encodeURIComponent(workspaceId)}/${suffix}`
}

function decodeUriPart(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function resourceDescriptor(uri: string, name: string, description: string) {
  return { uri, name, description, mimeType: 'application/json' }
}

function resourcesForWorkspace(
  auth: AgentAccessTokenAuthentication,
  opportunities: WorkspaceOpportunityReadModel[]
) {
  const resources: Array<Record<string, unknown>> = []
  if (hasScope(auth, 'sources:read')) {
    resources.push(
      resourceDescriptor(
        resourceUri(auth.workspaceId, 'sources'),
        'source coverage',
        'Approved, pending, and unavailable source-policy coverage for this workspace.'
      )
    )
  }
  if (hasScope(auth, 'opportunities:read')) {
    for (const opportunity of opportunities.slice(0, 100)) {
      const base = `opportunities/${encodeURIComponent(opportunity.slug)}`
      resources.push(
        resourceDescriptor(
          resourceUri(auth.workspaceId, base),
          opportunity.name,
          opportunity.synthetic ? 'Synthetic fixture opportunity.' : opportunity.oneLine
        )
      )
      if (hasScope(auth, 'evidence:read')) {
        resources.push(
          resourceDescriptor(
            resourceUri(auth.workspaceId, `${base}/evidence`),
            `${opportunity.name} evidence`,
            'Policy-bounded evidence references.'
          )
        )
      }
      if (hasScope(auth, 'reports:read')) {
        resources.push(
          resourceDescriptor(
            resourceUri(auth.workspaceId, `${base}/report`),
            `${opportunity.name} report`,
            'Approved or synthetic report artifact.'
          )
        )
      }
      if (hasScope(auth, 'plans:read')) {
        resources.push(
          resourceDescriptor(
            resourceUri(auth.workspaceId, `${base}/plan`),
            `${opportunity.name} plan`,
            'Approved or synthetic coding-agent plan package.'
          )
        )
      }
    }
  }
  return resources
}

function contentResult(uri: string, value: unknown): Record<string, unknown> | JsonRpcError {
  const text = JSON.stringify(value)
  if (text === undefined || new TextEncoder().encode(text).byteLength > maxResponseTextBytes) {
    return { code: -32006, message: 'MCP resource output is too large' }
  }
  return {
    contents: [{ uri, mimeType: 'application/json', text }]
  }
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code?: unknown }).code === 'number' &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

function notFound(): JsonRpcError {
  return { code: -32004, message: 'Requested AppSea artifact was not found' }
}

function forbidden(): JsonRpcError {
  return { code: -32003, message: 'MCP token scope does not permit this operation' }
}

function invalidArguments(): JsonRpcError {
  return { code: -32602, message: 'MCP arguments are invalid' }
}

async function callTool(
  auth: AgentAccessTokenAuthentication,
  input: unknown,
  dependencies: McpDependencies
): Promise<unknown | JsonRpcError> {
  const parsed = mcpToolCallInputSchema.safeParse(input)
  if (!parsed.success) return invalidArguments()
  const args = parsed.data.arguments
  const workspaceId = authorizeWorkspace(auth, args)
  if (!workspaceId) return forbidden()

  if (parsed.data.name === 'appsea.search_opportunities') {
    if (!hasScope(auth, 'opportunities:read')) return forbidden()
    const limit = limitArgument(args)
    if (limit === null) return invalidArguments()
    const query =
      args.query === undefined ? '' : typeof args.query === 'string' ? args.query.trim() : null
    if (query === null || query.length > 200) return invalidArguments()
    const normalized = query.toLowerCase()
    const opportunities = await dependencies.listOpportunities(auth.userId, workspaceId)
    const data = opportunities
      .filter((opportunity) =>
        normalized.length === 0
          ? true
          : `${opportunity.slug} ${opportunity.name} ${opportunity.oneLine}`
              .toLowerCase()
              .includes(normalized)
      )
      .slice(0, limit)
    return {
      opportunities: data,
      coverage: {
        synthetic: data.some((opportunity) => opportunity.synthetic),
        warning: data.some((opportunity) => opportunity.synthetic)
          ? 'Synthetic fixture opportunities are not market evidence.'
          : null
      }
    }
  }

  const slug = slugArgument(args)
  if (!slug) return invalidArguments()
  if (parsed.data.name === 'appsea.get_opportunity') {
    if (!hasScope(auth, 'opportunities:read')) return forbidden()
    const detail = await dependencies.readOpportunity(auth.userId, workspaceId, slug)
    if (!detail) return notFound()
    return {
      opportunity: detail.opportunity,
      summary: detail.summary,
      competitiveResearch: detail.competitiveResearch,
      coverageGaps: detail.coverageGaps,
      sourceCoverage: detail.sourceCoverage,
      artifacts: {
        report: detail.report
          ? {
              id: detail.report.id,
              version: detail.report.version,
              approvalState: detail.report.approvalState
            }
          : null,
        plan: detail.plan
          ? {
              id: detail.plan.id,
              version: detail.plan.version,
              readinessState: detail.plan.readinessState,
              approvalState: detail.plan.approvalState
            }
          : null
      }
    }
  }

  const detail = await dependencies.readOpportunity(auth.userId, workspaceId, slug)
  if (!detail) return notFound()
  if (parsed.data.name === 'appsea.get_evidence_refs') {
    if (!hasScope(auth, 'evidence:read')) return forbidden()
    return {
      evidence: detail.evidence.map((evidence) => ({
        id: evidence.id,
        sourceItemId: evidence.sourceItemId,
        canonicalLocator: evidence.canonicalLocator,
        text:
          evidence.allowedRepresentation === 'excerpt' ||
          evidence.allowedRepresentation === 'fixture'
            ? evidence.text
            : null,
        language: evidence.language,
        product: evidence.product,
        company: evidence.company,
        feature: evidence.feature,
        category: evidence.category,
        analysis: evidence.analysis,
        synthetic: evidence.synthetic,
        redacted: evidence.redacted,
        redactedFields: evidence.redactedFields ?? [],
        allowedRepresentation: evidence.allowedRepresentation,
        capturedAt: evidence.capturedAt,
        publishedAt: evidence.publishedAt
      })),
      coverageGaps: detail.coverageGaps
    }
  }
  if (parsed.data.name === 'appsea.get_report') {
    if (!hasScope(auth, 'reports:read')) return forbidden()
    if (!detail.report) return notFound()
    if (!detail.summary.synthetic && detail.report.approvalState !== 'approved') {
      return { code: -32005, message: 'Report is not approved for agent access' }
    }
    return { report: detail.report, synthetic: detail.summary.synthetic }
  }
  if (parsed.data.name === 'appsea.get_plan_package') {
    if (!hasScope(auth, 'plans:read')) return forbidden()
    if (!detail.plan) return notFound()
    if (
      !detail.summary.synthetic &&
      (detail.plan.readinessState !== 'ready' || detail.plan.approvalState !== 'approved')
    ) {
      return { code: -32005, message: 'Plan package is not approved for agent access' }
    }
    return { plan: detail.plan, synthetic: detail.summary.synthetic }
  }
  return { code: -32601, message: 'MCP tool is not available' }
}

async function readResource(
  auth: AgentAccessTokenAuthentication,
  uri: unknown,
  dependencies: McpDependencies
): Promise<unknown | JsonRpcError> {
  if (typeof uri !== 'string' || uri.length < 1 || uri.length > 1_000) return invalidArguments()
  const match =
    /^appsea:\/\/workspaces\/([^/]+)\/(sources|opportunities\/([^/]+)(?:\/(evidence|report|plan))?)$/.exec(
      uri
    )
  if (!match) return notFound()
  const workspaceId = decodeUriPart(match[1] ?? '')
  if (!workspaceId || workspaceId !== auth.workspaceId) return forbidden()
  const kind = match[2]
  if (kind === 'sources') {
    if (!hasScope(auth, 'sources:read')) return forbidden()
    const sources = await dependencies.listSources(auth.userId, auth.workspaceId)
    return contentResult(uri, { sources })
  }
  const slug = decodeUriPart(match[3] ?? '')
  if (!slug) return notFound()
  const detail = await dependencies.readOpportunity(auth.userId, auth.workspaceId, slug)
  if (!detail) return notFound()
  const subresource = match[4]
  if (!subresource) {
    if (!hasScope(auth, 'opportunities:read')) return forbidden()
    return contentResult(uri, {
      opportunity: detail.opportunity,
      summary: detail.summary,
      competitiveResearch: detail.competitiveResearch,
      coverageGaps: detail.coverageGaps,
      sourceCoverage: detail.sourceCoverage
    })
  }
  if (subresource === 'evidence') {
    if (!hasScope(auth, 'evidence:read')) return forbidden()
    const value = await callTool(
      auth,
      {
        name: 'appsea.get_evidence_refs',
        arguments: { workspaceId: auth.workspaceId, slug }
      },
      dependencies
    )
    return isJsonRpcError(value) ? value : contentResult(uri, value)
  }
  if (subresource === 'report') {
    if (!hasScope(auth, 'reports:read')) return forbidden()
    const value = await callTool(
      auth,
      {
        name: 'appsea.get_report',
        arguments: { workspaceId: auth.workspaceId, slug }
      },
      dependencies
    )
    return isJsonRpcError(value) ? value : contentResult(uri, value)
  }
  if (subresource === 'plan') {
    if (!hasScope(auth, 'plans:read')) return forbidden()
    const value = await callTool(
      auth,
      {
        name: 'appsea.get_plan_package',
        arguments: { workspaceId: auth.workspaceId, slug }
      },
      dependencies
    )
    return isJsonRpcError(value) ? value : contentResult(uri, value)
  }
  return notFound()
}

async function handleAuthenticatedRequest(
  auth: AgentAccessTokenAuthentication,
  method: string,
  params: Record<string, unknown>,
  dependencies: McpDependencies
): Promise<unknown | JsonRpcError> {
  if (method === 'initialize') {
    return {
      protocolVersion: mcpProtocolVersion,
      capabilities: { resources: {}, tools: {} },
      serverInfo: { name: mcpServerName, version: mcpServerVersion }
    }
  }
  if (method === 'notifications/initialized' || method === 'ping') return {}
  if (method === 'tools/list') return { tools: toolDefinitions(auth) }
  if (method === 'tools/call') {
    const value = await callTool(auth, params, dependencies)
    if (isJsonRpcError(value)) return value
    const text = JSON.stringify(value)
    if (text === undefined || new TextEncoder().encode(text).byteLength > maxResponseTextBytes) {
      return { code: -32006, message: 'MCP tool output is too large' }
    }
    return {
      content: [{ type: 'text', text }],
      structuredContent: value,
      isError: false
    }
  }
  if (method === 'resources/list') {
    const opportunities = hasScope(auth, 'opportunities:read')
      ? await dependencies.listOpportunities(auth.userId, auth.workspaceId)
      : []
    return { resources: resourcesForWorkspace(auth, opportunities.slice(0, 100)) }
  }
  if (method === 'resources/read') return readResource(auth, params.uri, dependencies)
  if (method === 'resources/templates/list') {
    return {
      resourceTemplates: [
        {
          uriTemplate: 'appsea://workspaces/{workspaceId}/opportunities/{slug}',
          name: 'opportunity package',
          description: 'Workspace-bound opportunity package resources.',
          mimeType: 'application/json'
        }
      ]
    }
  }
  return { code: -32601, message: 'MCP method is not available' }
}

export async function handleMcpRequest(
  request: Request,
  dependencies: McpDependencies = defaultMcpDependencies()
): Promise<Response> {
  const token = bearerToken(request)
  if (!token) return unauthorized()
  const auth = await dependencies.authenticate(token)
  if (!auth) return unauthorized()

  let payload: unknown
  try {
    payload = await readBody(request)
  } catch {
    return jsonResponse({ error: 'MCP request must be valid JSON under the size limit' }, 400)
  }
  const parsed = mcpJsonRpcRequestSchema.safeParse(payload)
  if (!parsed.success) return jsonResponse({ error: 'Invalid MCP JSON-RPC request' }, 400)
  const id = parsed.data.id
  if (id === undefined && parsed.data.method !== 'notifications/initialized') {
    return jsonRpcError(null, { code: -32600, message: 'MCP requests require an id' })
  }
  try {
    const result = await handleAuthenticatedRequest(
      auth,
      parsed.data.method,
      parsed.data.params ?? {},
      dependencies
    )
    if (id === undefined) return new Response(null, { status: 204, headers: responseHeaders() })
    if (typeof result === 'object' && result !== null && 'code' in result && 'message' in result) {
      return jsonRpcError(id, result as JsonRpcError)
    }
    return jsonRpcResult(id, result)
  } catch (error) {
    console.error('AppSea MCP request failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
    if (id === undefined) return new Response(null, { status: 204, headers: responseHeaders() })
    return jsonRpcError(id, { code: -32000, message: 'MCP request failed' })
  }
}
