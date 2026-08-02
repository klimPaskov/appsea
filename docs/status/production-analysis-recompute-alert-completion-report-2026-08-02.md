# Production-analysis recomputation alert inspection

Date: 2026-08-02

## Outcome

AppSea now has a bounded, read-only inspection path for the durable
deletion- and correction-triggered production-analysis recomputation queue.
The path reports failed, blocked, stale, oldest-age, alert, and truncation
state without claiming, retrying, resolving, dispatching, starting Temporal,
recollecting source data, or changing retention.

## Changed surfaces

- Migration `0064_recompute_alert_read_boundary.sql` adds the narrow
  `appsea.list_production_analysis_recompute_alerts` projection. It is a
  `SECURITY DEFINER` function callable only by `appsea_maintenance`, validates
  active workspace context and bounded limits, and returns only state, attempt
  count, and timestamps.
- `PostgresProductionAnalysisRecomputeRepository` exposes the projection
  through a maintenance-role read transaction and validates every row with the
  shared contract. Direct table reads remain unavailable to the maintenance
  role.
- Contracts define bounded input, observation, and result schemas. The result
  makes incomplete coverage explicit and enforces deterministic alert-state
  invariants.
- `apps/worker/src/production-analysis-recompute-alert.ts` provides the pure,
  lease-aware bounded scan. The CLI uses separate service and maintenance
  database URLs, fixed task-queue/event names, and secret-free telemetry.
- Worker observability now carries bounded recomputation counters and a
  truncation flag. The runbooks describe routing and the rule that incomplete
  coverage is not clear.

## Security and policy boundary

The scan enumerates active workspace IDs through the service repository, then
reads only the maintenance projection under a scheduler lease. It does not
return repair identifiers, failure summaries, source content, object
references, lineage, or credentials. Imported evidence remains untrusted, and
no connector is activated or presented as live market research.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (78 tests).
- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/db test` — passed (111 tests, 25 files).
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/db lint` — passed.
- `pnpm --filter @appsea/worker test` — passed (87 tests, 20 files).
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm --filter @appsea/worker lint` — passed.
- Fresh and populated PostgreSQL/Temporal integration gates still require the
  Docker Desktop Linux engine; this environment reports the unavailable
  `//./pipe/dockerDesktopLinuxEngine` pipe. Full repository verification
  passed locally; only the Docker-backed gates remain unavailable.

## Scope and remaining work

This is repository-level observability, not production-operated alerting.
Deployment still owns scheduler supervision, event routing, incident identity,
Temporal provisioning, cloud deletion, and operator response. The source
connectors remain disabled pending independent legal, privacy, security, and
commercial-use review.
