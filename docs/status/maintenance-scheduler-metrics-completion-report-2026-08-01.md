# Maintenance scheduler metrics completion report — 2026-08-01

Historical boundary report. Migration `0052` subsequently adds transaction
fencing for selected SQL-only maintenance mutations; this report describes the
earlier `0047` metrics slice.

## Outcome

AppSea maintenance and delivery commands now persist a bounded, secret-free
outcome for every acquired, contended, or failed scheduler invocation. The
record is written through the dedicated `appsea_maintenance` role and can be
listed or purged only through migration-owned security-definer functions.
Metrics improve operator evidence; they do not claim a deployed scheduler,
alert ownership, or production infrastructure.

## Implementation

- `packages/contracts/src/index.ts` defines validated run IDs, states, fixed
  failure codes, bounded numeric counters, durations, and purge inputs.
- `packages/db/migrations/0047_maintenance_scheduler_run_metrics.sql` adds
  the protected run table, retention index, record/list/purge functions,
  role-hardening preconditions, and negative grants.
- `packages/db/src/maintenance-scheduler-run-repository.ts` exposes the narrow
  repository; it never reads or writes the table directly.
- `apps/worker/src/maintenance-scheduler.ts` generates a per-attempt run ID,
  records fixed outcomes and bounded counters, purges configured-old rows, and
  emits only `APPSEA_MAINTENANCE_SCHEDULER_METRICS_FAILED` when telemetry itself
  is unavailable.
- Source maintenance, auth retention, password recovery, and invitation
  delivery pass command-specific counters and fixed failure-code fallbacks.
- `.env.example`, runbooks, architecture/status docs, plan, and memory record
  the retention controls and remaining deployment boundaries.

## Security review

- `appsea_service` cannot execute the metric functions or select the table.
- `appsea_maintenance` cannot select or mutate the table directly; only the
  validated functions are granted.
- SQL and Zod checks reject arbitrary scheduler names, owner/token-like
  fields, raw failure text, future purge cutoffs, non-integer counters, excess
  counter keys, unbounded durations, and invalid state/code combinations.
- No lease token, source content, credential, database URL, or exception
  message is persisted.
- The existing shared maintenance coordinator remains trusted across the four
  allowlisted scheduler names, and lease assertions still do not fence a
  transaction or external delivery that outlives its lease.

## Validation

- `@appsea/contracts`: 62 tests passed.
- `@appsea/db`: 79 tests passed; lint and typecheck passed.
- `@appsea/worker`: 58 tests passed; lint and typecheck passed.
- `pnpm format:check` passed.
- PostgreSQL integration assertions cover maintenance-role function access,
  idempotent recording, listing, purge, and direct-table denial, but could not
  execute on this host because Docker Desktop's Linux engine is unavailable.

## Simplifications and remaining blockers

- Metrics are per scheduler attempt and intentionally do not aggregate costs or
  cross-run SLOs; deployment telemetry must perform that aggregation.
- A metrics write failure does not fail a research or delivery job. It emits a
  fixed alertable event so the durable work result remains recoverable.
- Production still needs a provisioned scheduler, alert/incident owner,
  per-scheduler credential isolation, database fencing for long-running work,
  production role/secret rotation, and fresh Docker-backed proof.
