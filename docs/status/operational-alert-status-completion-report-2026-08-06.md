# Operational-alert outbox status completion report - 2026-08-06

Status: repository-level bounded status inspection implemented. AppSea remains
not production-ready; this tranche does not operate an external scheduler,
incident endpoint, provider, or production database.

## Delivered

- Added forward-only migration `0110_operational_alert_outbox_status.sql`.
  `appsea_maintenance` can call one bounded, server-clock read that returns
  only pending, sending, exhausted, oldest-open age, truncation, and
  clear/alert/incomplete state. Direct table access remains denied.
- Extended the maintenance scheduler allowlist and scalar event allowlist
  without editing released migration history.
- Added validated contracts, repository mapping, and integration/static tests.
- Added `pnpm worker:alerts:status`, with explicit production enablement,
  bounded environment inputs, its own maintenance lease and run metrics, and
  fixed secret-free events. It never enqueues into the outbox it inspects,
  claims or mutates rows, purges records, calls a provider, or routes incidents.
- Added the status command as the sixth fixed child of `alerts:loop` and
  updated the worker observability and deployment runbooks.

## Decisions and safety properties

- The reader orders exhausted and stale/aged work ahead of ordinary open rows.
  A capped scan reports `incomplete` rather than claiming `clear`; an observed
  exhausted or aged/stale row reports `alert`.
- `oldestOpenAgeSeconds` is derived from database timestamps, never from an
  outbox payload. Payloads, URLs, credentials, source text, and raw failures
  cannot cross the status boundary.
- The status observation is local telemetry. Enqueuing it into the same outbox
  would create a self-referential backlog, so durable delivery remains owned by
  the existing alert producers and `alerts:deliver` drain.

## Validation

- `pnpm --filter @appsea/contracts test -- --run src/contracts.test.ts` passed
  (112 tests).
- `pnpm --filter @appsea/db test -- --run src/operational-alert-outbox-repository.test.ts src/db.test.ts` passed (181 tests).
- `pnpm --filter @appsea/worker test -- --run src/operational-alert-status.test.ts src/observability.test.ts src/alert-maintenance-loop.test.ts` passed (134 tests).
- Contracts, DB, and worker lint/typecheck/build checks passed.
- Full `pnpm verify` passed all 56 Turbo tasks plus fixture, plan, analysis,
  quality, local web smoke, static release, and repository checks.
- PostgreSQL integration coverage was extended for status transitions, but
  Docker-backed execution remains blocked by the unavailable
  `dockerDesktopLinuxEngine` named pipe on this host.

Residual validation gaps are explicit: the unavailable PostgreSQL runtime
means exhausted-row, stale-sending, truncation-to-incomplete, and
maintenance-role denial cases have not executed against a real database. The
CLI tests cover bounded environment parsing and event mapping; lease,
database-failure, and external scheduling behavior still require an operated
environment. The contract schema validates the truncation/state relationship;
the database function remains the authority for semantic count/age
consistency.

## Remaining gates

Deployment still owns scheduler availability, endpoint/provider operation,
HMAC secret rotation and idempotency, incident routing, hosted PostgreSQL
roles/HA/backups/restore drills, and payment-gated CI execution. No source was
activated and no real market-research claim changed.
