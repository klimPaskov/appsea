# Workspace cost observability completion report — 2026-08-01

## Outcome

AppSea now exposes a bounded private workspace cost summary over the existing
immutable `cost_ledger_entries` history. The read model keeps currencies
separate and reports exact integer micro-units by currency and cost type, so
the application never combines decimal amounts through JavaScript floating
point arithmetic.

## Changed surfaces

- `packages/contracts` adds strict period-query, currency, cost-type, and
  workspace summary schemas.
- Migration `0048_cost_ledger_summary_index.sql` adds a workspace/time index
  for bounded ledger scans without changing ledger history or grants.
- `PostgresWorkspaceCostRepository` reads through an authenticated,
  read-only workspace transaction, uses PostgreSQL `clock_timestamp()`, caps
  periods at 365 days, and groups estimated and actual micro-costs by currency
  and cost type.
- `GET /api/workspaces/:workspaceId/costs` exposes the summary only to current
  workspace members, disables caching, rejects unknown or malformed query
  parameters, and maps failures to a fixed private response.
- Contract, repository, route, migration-discovery, and negative-boundary tests
  cover exact units, period limits, membership, and error redaction.

## Security review

The route performs a fast session membership check and the repository repeats
membership authorization inside the same database transaction before setting
the workspace RLS context. The query returns only aggregate ledger values; it
does not expose source content, source identifiers, run identifiers, actor
identities, URLs, or raw database errors. The public leaderboard remains
unchanged and database-free.

## Validation

- `pnpm --filter @appsea/contracts test` — 63 passed.
- `pnpm --filter @appsea/db test` — 82 passed.
- `pnpm --filter @appsea/web test` — 67 passed.
- Affected package lint and typecheck passed.

The PostgreSQL integration suite still requires the unavailable Docker Desktop
Linux engine in this environment; the new index and RLS-backed aggregate query
therefore remain staged for the next Docker-backed run.

## Remaining gaps and simplifications

This is repository-level cost accounting, not billing or payment processing.
It does not add provider pricing adapters, currency conversion, deployment
alerts, retention/backup policy, or a production database deployment. The
summary is intentionally bounded to 365 days, 16 currencies, 64 cost types per
currency, one million ledger entries, and 18-digit micro-unit totals.
