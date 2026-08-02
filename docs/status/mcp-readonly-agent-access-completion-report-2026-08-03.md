# Read-only MCP agent access completion report

Date: 2026-08-03

Status: repository slice complete; production deployment remains open

## Outcome

AppSea now has a private, workspace-bound read-only MCP-over-HTTP boundary.
Workspace owners can issue short-lived scoped agent tokens after a recent
step-up. The raw token is returned once, only its SHA-256 hash is persisted,
and the token can be listed or revoked without exposing credentials.

The MCP handler authenticates only bearer tokens, filters tools by scope,
checks the token workspace on every read, preserves source coverage gaps and
redaction state, and gates non-synthetic reports and plan packages on approval.
It exposes no workflow, connector activation, policy, deployment, or other
write tool.

## Changed surfaces

- `packages/contracts`: strict agent-token, JSON-RPC, and MCP tool contracts.
- `packages/db/migrations/0069_agent_access_tokens.sql`: forced-RLS token
  table, owner-only issue/list/revoke functions, hash-only authentication,
  and identifier-only audit/outbox receipts.
- `packages/db/src/agent-access-token-repository.ts`: transactional token
  creation, listing, revocation, and authentication repository.
- `apps/web/src/app/api/workspaces/[workspaceId]/agent-tokens`: owner API with
  same-origin and recent-step-up checks.
- `apps/web/src/app/api/mcp/route.ts` and `apps/web/src/server/mcp.ts`:
  authenticated MCP protocol boundary and private read models.
- `docs/runbooks/mcp-agent-access.md`: token lifecycle and operating rules.

## Validation

Focused validation completed for this slice:

- contracts: 84 tests passed
- database package: 121 tests passed; typecheck and lint passed
- web package: 126 tests passed; typecheck and lint passed
- token repository, route, migration-catalog, and MCP security tests cover
  hashing, workspace isolation, scope filtering, approval gates, source
  resources, redaction, malformed requests, and notification handling

Repository-wide `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm format:check`, `pnpm worker:fixture`, `pnpm plan:sample`,
`pnpm analysis:sample`, `pnpm smoke:web`, `pnpm memory:check`, and
`pnpm repo:check` passed. The fresh PostgreSQL and Temporal probes remain
blocked because the Docker Desktop Linux engine pipe is unavailable.
The aggregate `pnpm verify` command also passed, including synchronized agent
catalogs, all package checks, fixture/plan/analysis artifacts, web smoke, and
repository validation.

## Deliberate simplifications

- This tranche adds an HTTP MCP boundary, not the aspirational versioned REST
  API or a general MCP write surface.
- Token management is API-only; a workspace settings UI is deferred.
- OIDC/MFA, deployment rate limiting, external secret storage, HTTPS
  termination, and production alert routing remain deployment/provider work.
- No source connector was activated and no fixture content is presented as
  market evidence.

## Remaining blockers

CFPB and Stack Exchange candidates remain disabled pending independent legal,
privacy, and security approval. Production PostgreSQL/Temporal provisioning,
MFA/OIDC and provider delivery, cloud/object/backup purge, deployed scheduler
ownership, crash/retry drills, and Windows/macOS release evidence remain open.
