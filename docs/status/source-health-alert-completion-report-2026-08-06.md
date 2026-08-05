# Source-health alert inspection completion report

Status: implemented in the repository; production deployment and live source
activation remain open.

## Delivered

- Added bounded contracts for source-health alert observations, inputs, results,
  counters, truncation, and alert-state invariants.
- Added the pure, lease-owned worker scan and
  `pnpm worker:source:health:alert`. The scan sorts and deduplicates active
  workspaces, caps workspace/source work, and reports stale, exhausted, or
  aged-degraded collectible sources. A capped scan is `incomplete`, never
  `clear`.
- Added migration `0108_source_health_alert_read.sql`, a maintenance-only
  security-definer projection that returns scalar health/freshness/quota state
  only. It does not expose source payloads, complaint text, policy JSON, or
  activation capability.
- Added migration `0109_source_health_alert_allowlist.sql` as a forward repair
  for the released scheduler and scalar operational-alert allowlists.
- Added repository mapping, observability fields, durable alert-event routing,
  static migration checks, repository tests, worker tests, and a PostgreSQL
  integration test for maintenance/service role separation.

## Validation

- `pnpm --filter @appsea/contracts test` passed.
- `pnpm --filter @appsea/db test` passed.
- `pnpm --filter @appsea/worker test` passed.
- Affected TypeScript checks passed after the worker test mock was corrected.
- PostgreSQL integration, fresh migration, and backup/restore proof remain
  blocked in this environment because Docker Desktop's Linux engine pipe is
  unavailable. The SQL integration test is present but is not reported as
  executed.
- Local website checks use direct localhost HTTP only; no browser-control
  tooling is required. The sparse leaderboard and opportunity detail routes
  remain unchanged by this maintenance slice.

## Explicit limits

This tranche does not approve or activate CFPB, Stack Exchange, or any other
third-party source; the reviewed tenant-private manual owner import remains the
only active non-fixture path. It does not provide hosted PostgreSQL/Temporal,
object-storage, alert-provider, billing, deployment, incident, or signed
desktop evidence. It does not turn stale or missing observations into market
demand claims.
