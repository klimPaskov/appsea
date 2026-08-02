# Source-quota reconciliation alert inspection — 2026-08-02

## Outcome

AppSea now has a bounded, read-only scheduler job for inspecting open
source-quota reconciliation cases. It enumerates active workspaces through the
service role, reads the private open-case projection through the maintenance
role, and emits a fixed alert, incomplete, clear, or failure signal. It never
resolves a case, refunds quota, retries a source request, or activates a
connector.

## Changed surfaces

- `packages/contracts` adds strict input/result schemas and explicit bounds for
  workspace, case, age, threshold, alert, and truncation fields.
- `apps/worker` adds the pure lease-aware inspection runner, a CLI, bounded
  scheduler metrics, and secret-free observability fields/events.
- The root and worker package scripts expose
  `worker:source:quota:alert`.
- `docs/runbooks/source-quota-reconciliation.md` documents role separation,
  environment bounds, coverage semantics, and deployment routing.

This is an additive worker/contract boundary with no persisted-row or
migration impact; it reads the existing migration `0049` case projection.

## Security and policy

The workspace enumerator uses `DATABASE_URL` (`appsea_service`), while case
reads and scheduler lease/metrics use `APPSEA_MAINTENANCE_DATABASE_URL`
(`appsea_maintenance`). The lease is checked before enumeration, before each
workspace read, and after the scan. Results and metrics contain no identifiers,
source payloads, raw errors, credentials, or provider content. A bounded or
truncated scan is never reported as clear. The job has no write, resolution,
refund, re-fetch, source activation, or retention behavior.

## Validation

- Contract positive/negative schema tests pass.
- Worker runner and observability tests pass.
- Full repository verification, formatting, memory, documentation, and agent
  catalog checks are required before commit.
- Fresh PostgreSQL/Temporal integration remains blocked in this environment by
  the unavailable Docker Desktop Linux engine pipe; this is an environment
  limitation, not a claim of production infrastructure proof.

## Remaining gaps and simplifications

Deployment still owns scheduler process supervision, event routing, incident
response, role provisioning, credentials, retention, and live alert delivery.
The inspection is intentionally one bounded pass rather than a durable alert
ledger or automatic case resolution. No source connector was enabled and no
fixture content was presented as market evidence.
