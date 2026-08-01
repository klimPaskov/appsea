# Maintenance scheduler lease completion report — 2026-08-01

Historical boundary report. Migration `0052` subsequently adds transaction
fencing for selected SQL-only maintenance mutations; this report describes the
earlier `0046` ownership slice.

## Outcome

Bounded maintenance and delivery commands now share a durable PostgreSQL
scheduler-ownership boundary:

- migration `0046_maintenance_scheduler_leases.sql` stores one lease per fixed
  scheduler name and exposes server-clock acquire, renew, and owner/token-checked
  release functions;
- only the standalone, non-inheriting `appsea_maintenance` role can execute
  those functions; `appsea_service` cannot select, mutate, or execute them;
- source maintenance, auth retention, password-recovery delivery, and
  workspace-invitation delivery acquire the lease before work, renew during a
  pass, skip a contended invocation, release by owner and token, and emit fixed lease
  failure codes;
- production requires a stable `APPSEA_SCHEDULER_OWNER_ID`; development/test
  commands generate an ephemeral owner for local use, and every acquisition
  also carries a fresh lease token.

This closes duplicate bounded-pass ownership at the repository boundary. It is
not a deployed scheduler, fencing token for arbitrary work, metric-retention
system, or alert-routing proof.

## Evidence

- Contract schemas: `packages/contracts/src/index.ts` and tests.
- Database migration and repository: `packages/db/migrations/0046_maintenance_scheduler_leases.sql`,
  `packages/db/src/maintenance-scheduler-lease-repository.ts`.
- Worker wrapper and command wiring: `apps/worker/src/maintenance-scheduler.ts`,
  `source-maintenance.ts`, `auth-retention.ts`, `auth-recovery.ts`, and
  `workspace-invitations.ts`.
- Bounded events: `apps/worker/src/observability.ts`.
- Runbooks: `docs/runbooks/source-maintenance.md` and
  `docs/runbooks/worker-observability.md`.

## Validation

- Contracts: 62 tests passed.
- Database: 77 source tests, lint, and typecheck passed.
- Worker: 56 tests, lint, and typecheck passed.
- Migration, PostgreSQL concurrency, grant, and takeover integration assertions
  are present in `packages/db/integration/db.integration.test.ts` but could not
  run because Docker Desktop's Linux engine pipe is unavailable.

## Simplifications and remaining gaps

The lease token prevents same-owner overwrites and stale release, but it does
not implement database fencing inside every individual maintenance mutation or
external delivery. Lease loss fails the command and guarded runners check the
lease before bounded operations. The coordinator role is trusted across the
four scheduler names; production still must provide per-scheduler/data-work
role separation where required, scheduler ownership, bounded
transaction/runtime limits, durable metric retention, alert routing,
replacement drills, and production database provisioning. No source was
activated and no production endpoint was contacted.
