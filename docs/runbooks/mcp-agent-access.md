# Read-only MCP agent access

This runbook covers the first authenticated agent-access boundary. It is a
workspace-scoped, read-only MCP-over-HTTP endpoint for coding agents that need
to inspect private opportunities, evidence references, source coverage, and
approved report/plan artifacts.

## Security model

- An owner of an active private workspace creates a token through the private
  workspace API after a recent password step-up.
- The raw `appsea_mcp_...` bearer is returned only by the create response. The
  database stores only its SHA-256 hash and safe metadata.
- Every token is bound to one workspace and one user, expires in at most 90
  days, and can be revoked by that workspace owner after a recent step-up.
- MCP authentication does not accept the browser session cookie. The endpoint
  accepts only an `Authorization: Bearer ...` header.
- Imported evidence remains untrusted data. MCP exposes only policy-bounded
  representations, provenance, redaction state, and coverage gaps. It does
  not expose connector credentials, policy payloads, source request keys,
  workflow hashes, or raw exception text.

## Create, list, and revoke tokens

The owner can manage tokens from the private workspace **Agent access** page or
through the authenticated private workspace routes. The browser session must
be same-origin, and `POST`/`DELETE` require recent reauthentication (plus a
fresh MFA step-up when MFA is enabled). The page deliberately offers only the
read scopes below and never renders a token returned by a previous session.

```text
GET    /api/workspaces/{workspaceId}/agent-tokens
POST   /api/workspaces/{workspaceId}/agent-tokens
DELETE /api/workspaces/{workspaceId}/agent-tokens/{tokenId}
```

Open `/workspace/{workspaceId}/agent-access` as the workspace owner to create
or revoke a token without constructing the JSON request by hand. The page
shows the raw credential only in the immediate create response and provides a
copy action; it does not persist or re-fetch the credential.

Create with a strict JSON body:

```json
{
  "label": "Build agent",
  "scopes": ["opportunities:read", "evidence:read", "reports:read", "plans:read", "sources:read"],
  "expiresInDays": 30
}
```

Store the `data.token` value in the agent's secret store immediately. List
responses never contain the raw token. Revocation is idempotent for an existing
token and returns `404` when the token is not owned by the workspace owner.

## MCP endpoint

```text
POST /api/mcp
Authorization: Bearer appsea_mcp_...
Content-Type: application/json
```

The endpoint implements the authenticated read-only subset of MCP protocol
`2025-06-18`:

- lifecycle: `initialize`, `notifications/initialized`, `ping`
- discovery: `tools/list`, `resources/list`,
  `resources/templates/list`, `resources/read`
- tools: `appsea.search_opportunities`, `appsea.get_opportunity`,
  `appsea.get_evidence_refs`, `appsea.get_report`, and
  `appsea.get_plan_package`, filtered by token scope

Workspace IDs are required in tool arguments and must equal the token's bound
workspace. Resource URIs are similarly workspace-bound. There are no MCP write,
connector-activation, report-generation, plan-generation, or workflow-start
tools in this tranche.

Non-synthetic reports require `approved` state. Non-synthetic plan packages
require both `ready` and `approved` state. Fixture responses remain available
only with an explicit `synthetic` marker and warning; they are not market
research. Evidence text is returned only when its allowed representation is
`excerpt` or `fixture`; metadata-only or redacted evidence keeps text null.

Report and plan history are available as metadata-only resources:

```text
appsea://workspaces/{workspaceId}/opportunities/{slug}/report-history
appsea://workspaces/{workspaceId}/opportunities/{slug}/plan-history
```

Append only the matching bounded query keys (`limit` plus `reportCursor` or
`planCursor`). The cursors are opaque and workspace/opportunity/family-bound;
follow the returned next cursor to traverse older pages. A history resource
never hydrates report or plan bodies, and selected content continues to require
the existing approval, readiness, deletion, policy, and redaction gates.

Every authenticated request also passes a PostgreSQL admission boundary from
migration `0097_mcp_agent_access_admission.sql`. The token must still belong to
an active member of the private workspace. The database enforces a fixed
60-request/60-second token window, at most four in-flight requests, and a
30-second server-clock lease. The web handler releases the lease in a
`finally` path; expired leases are reclaimed by the next admission, so a
crashed request cannot permanently consume concurrency. A denied rate or
concurrency request returns HTTP `429` with a bounded `Retry-After` header.
Membership removal or workspace/token revocation returns the same generic
bearer authentication failure on the next request.

Resource-list names and descriptions are static labels. Opportunity names,
summaries, and evidence remain untrusted payload data and are never copied
into MCP descriptor metadata, where an agent could mistake them for protocol
instructions.

## Operations

Rotate before expiry or immediately after suspected disclosure: create a new
scoped token, update the agent secret, verify one read request, then revoke the
old token. Keep scopes minimal and do not put tokens in source control, URLs,
logs, prompts, reports, or workflow inputs. Review `lastUsedAt` and revoke
unused or unexpected credentials. Deployment still owns HTTPS termination,
edge/proxy rate limiting and concurrency controls, secret-store integration,
alert routing, and identity-provider approval. The PostgreSQL admission is
repository evidence, not a substitute for those deployment controls.
