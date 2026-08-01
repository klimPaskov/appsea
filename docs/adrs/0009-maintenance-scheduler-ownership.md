# ADR 0009: Database-backed maintenance scheduler ownership

- Status: accepted for the repository boundary
- Date: 2026-08-01

## Context

Source maintenance, authentication retention, and delivery workers are bounded
and idempotent, but independent scheduler instances could start the same pass
at once. Process-local locks do not survive replacement, and a PostgreSQL
polling queue would duplicate Temporal's workflow history boundary.

## Decision

Migration `0046_maintenance_scheduler_leases.sql` stores one global lease per
fixed scheduler name. Only the standalone, non-inheriting
`appsea_maintenance` role from `APPSEA_MAINTENANCE_DATABASE_URL` may call the
security-definer acquire, renew, and owner/token-checked release functions;
`appsea_service` is explicitly denied. Acquisition and expiry use PostgreSQL
`clock_timestamp()`; a transaction advisory lock serializes absent-row
creation and stale takeover for each scheduler name. Every acquisition gets a
unique token, and the SQL allowlists the four worker scheduler names. Production
processes must provide a unique `APPSEA_SCHEDULER_OWNER_ID`; development/test
commands generate an ephemeral owner.

The worker wrapper renews during a bounded pass, skips a contended lease, and
fails with fixed codes when renewal or owner/token release is lost. It protects
source maintenance, auth retention, password recovery, and workspace-invitation
delivery.

## Consequences

- Duplicate bounded passes are prevented at the repository boundary, including
  same-owner retries, worker replacement, and stale lease takeover.
- The lease table contains no complaint, source, credential, or personal data,
  and direct runtime table access remains revoked.
- A lease is not a fencing token for every arbitrary mutation or long-running
  external delivery. Deployed
  scheduler ownership, metric retention, alert routing, replacement drills,
  production data-work role separation, optional per-scheduler credential
  isolation, and production role provisioning remain release work.

## Rejected alternatives

- An in-memory lock disappears on process loss and cannot coordinate replicas.
- A caller-supplied timestamp would permit clock manipulation; server time is
  required for expiry and renewal.
- An unconditional row upsert without a per-name advisory lock could let two
  first callers both report ownership when the row is absent.
