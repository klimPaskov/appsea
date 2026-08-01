# ADR 0010: Fence scheduler-owned database mutations

- Status: accepted for the repository boundary
- Date: 2026-08-01
- Related: [ADR 0009](0009-maintenance-scheduler-ownership.md)

## Context

Migration `0046` prevents duplicate scheduler starts, but a local renewal
check is not a database fence. A service transaction can begin after that
check, outlive the lease window, and commit after another scheduler has taken
over. This is unsafe for retention, quota, deletion, admission, and delivery
state transitions.

## Decision

Migration `0052_maintenance_scheduler_fencing.sql` adds the security-definer
function `appsea.assert_maintenance_scheduler_lease(name, owner, token)`. It
accepts only the fixed scheduler allowlist and valid owner/token shapes,
requires `session_user = 'appsea_service'`, checks PostgreSQL
`clock_timestamp()`, and takes the per-scheduler advisory lock plus the lease
row lock with `FOR UPDATE`. The locks remain held until the surrounding
`appsea_service` transaction commits or rolls back. Execution is granted only
to `appsea_service`; both runtime roles retain no table access.

The scheduler wrapper passes the private fence identity to workers. Database
transaction helpers assert it before the callback, and selected scheduled
mutations thread it through source quota, deletion propagation, admission and
lease purge, authentication retention, and delivery claim/finalization paths.
The token is never returned in an API response, telemetry, log, or persisted
row.

## Consequences

- A stale scheduler cannot commit one of the fenced database mutations after
  takeover; a false assertion fails closed with a fixed lease-loss boundary.
- A takeover waits for a fenced transaction holding the lease row lock, so
  operators must still keep transactions bounded and monitor lock waits.
- External CFPB requests, email/provider sends, and object-store mark/purge
  calls are not atomic with PostgreSQL. They require provider idempotency,
  conditional deletion, and recovery drills before production activation.
- Snapshot reconciliation is intentionally not included in this tranche: it
  performs external source work and has its own checkpoint/lease transactions.
- The shared `appsea_maintenance` coordinator, deployment scheduler ownership,
  role isolation, alerting, and Docker-backed concurrency proof remain open.

## Rejected alternatives

- A second process-local `assertLease` check still leaves a transaction-level
  race and is not a fence.
- Mutating lease rows from the service role would widen its privilege boundary;
  the security-definer function and explicit execute grant keep ownership
  narrow.
- Holding a lock only around the assertion and releasing it before the
  mutation would not prevent stale commits, so the assertion must run inside
  the mutation transaction.
