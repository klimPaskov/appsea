# MCP agent admission completion report — 2026-08-04

Status: repository slice implemented and locally validated; deployment remains
open.

## Outcome

Read-only MCP requests now have a durable PostgreSQL admission boundary. Token
authentication and admission both require an active account, private active
workspace, and current workspace membership. Migration `0097` enforces 60
requests per 60-second token window, four in-flight requests, and 30-second
server-clock leases. The web handler releases every admitted lease even when
JSON parsing or downstream reads fail; stale leases are reclaimed on the next
admission. Rate/concurrency denial is HTTP `429` with `Retry-After`.

MCP resource descriptors use static labels instead of untrusted opportunity
names or summaries. Returned opportunity content remains data, and existing
scope, provenance, redaction, coverage-gap, synthetic, and report/plan approval
gates remain unchanged.

## Changed surfaces

- `packages/contracts`: validated admission decision contract.
- `packages/db/migrations/0097_mcp_agent_access_admission.sql`: membership
  recheck, token rate state, forced-RLS lease table, and security-definer
  admission/release functions.
- `packages/db/src/agent-access-token-repository.ts`: admission/release
  repository methods with server-generated lease identifiers.
- `apps/web/src/server/mcp.ts`: admission lifecycle, `429` response, release
  recovery, and static resource descriptor labels.
- Runbook, ADR, active plan, status, and memory documentation.

## Validation

- Contracts: 96 tests passed; typecheck passed.
- Database package: lint, typecheck, 150 unit tests, and 50 PostgreSQL
  integration tests passed. The integration test proves membership revocation,
  four-lease concurrency denial, the 60-request window, and lease release.
- Web package: lint, typecheck, and 176 tests passed.
- Fresh PostgreSQL migration lifecycle passed through `0097`.
- `pnpm verify:backup-restore`, `pnpm verify:local-stack`, and the full
  repository `pnpm verify` passed, including 56 package tasks, fixture/plan/
  analysis generation, web smoke, release-boundary checks, and repository
  validation.

## Deliberate limits and remaining blockers

- The limits are repository-owned defaults, not caller-configurable billing or
  a substitute for a distributed edge limiter.
- No MCP write tool, source activation, workflow start, or report generation
  was added.
- HTTPS termination, external secret storage, edge limits, deployment
  monitoring, provider identity, source approvals, hosted PostgreSQL/Temporal,
  object/backup purge, and signed desktop releases remain open.
