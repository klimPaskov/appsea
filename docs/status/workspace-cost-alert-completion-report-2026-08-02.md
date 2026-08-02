# Workspace cost-threshold inspection

Date: 2026-08-02

## Outcome

AppSea now has a bounded, read-only deployment cost-threshold inspection path
over the immutable workspace cost ledger. It compares exact micro-unit totals
for one explicitly configured currency and separate actual/estimated thresholds.
It never blocks admissions, changes budgets, converts currencies, refunds
spend, or claims to be billing.

## Changed surfaces

- Migration `0065_cost_alert_read_boundary.sql` adds the narrow
  `appsea.list_workspace_cost_alerts` `SECURITY DEFINER` projection. It is
  callable only by `appsea_maintenance`, validates active workspace context,
  period, and row limits, and returns only bounded currency aggregates.
- `PostgresWorkspaceCostAlertRepository` validates every projection row through
  the shared exact micro-unit contract. Direct maintenance-role ledger reads
  remain unavailable.
- Contracts define bounded observation/input/result shapes, threshold breaches,
  saturation limits, and incomplete coverage for unsupported currencies or
  truncated scans.
- `workspace-cost-alert.ts` and its CLI use separate service and maintenance
  database URLs, a scheduler lease, fixed events, and secret-free counters.
- Production preflight now requires an explicit comparison currency and exact
  actual/estimated threshold strings when deployment configuration is checked.

## Security and policy boundary

The scan enumerates active workspace IDs through the service maintenance
enumerator, then reads only aggregate ledger rows through the maintenance
projection. It returns no workspace IDs, ledger IDs, source IDs, run IDs, or
source content. Non-target currencies keep a non-alerting scan incomplete
because no exchange-rate or billing policy is invented; a detected breach is
still reported as alert while the unsupported-row count remains visible.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (79 tests).
- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/db test` — passed (113 tests, 26 files).
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/worker test` — passed (91 tests, 21 files).
- `pnpm --filter @appsea/worker lint` — passed.
- `pnpm --filter @appsea/worker typecheck` — passed.
- Docker-backed fresh/populated database and Temporal integration remains
  unavailable because `//./pipe/dockerDesktopLinuxEngine` is missing.

## Scope and remaining work

This is repository-level spend-pressure observability, not billing or payment
processing. Deployment still owns threshold selection, currency policy,
provider pricing, scheduler routing, incident response, and live ledger proof.
Real source connectors remain disabled pending independent legal, privacy,
security, and commercial-use review.
