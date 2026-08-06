# ADR 0018: Persist operational alerts before provider delivery

- Status: accepted
- Date: 2026-08-04

## Context

The quota-reconciliation, production-analysis recomputation, and workspace-cost
inspection commands emit bounded operational events. Sending those events only
from process memory loses an incident when the provider or worker exits after
the inspection completes. The released scheduler lease and run-metrics
functions also allow only the original four scheduler names, so changing their
allowlist in place would rewrite migration history.

## Decision

Migration `0082_operational_alert_outbox.sql` adds a maintenance-role-owned
outbox and forward-compatible v2 scheduler lease/metrics functions. Producers
validate and enqueue a scalar, allowlisted redacted event before attempting the
external HMAC endpoint. The delivery ID and payload hash are deterministic and
re-enqueueing the same event is a no-op; a conflicting payload is a serialization
failure. Only `appsea_maintenance` can execute the enqueue, claim, complete,
failure, and purge functions. Neither `appsea_service` nor
`appsea_maintenance` receives direct table access.

Claims use a PostgreSQL server-clock lease, recover stale work, retry with a
fixed failure code, and terminalize after five attempts. The bounded
`pnpm worker:alerts:deliver` command drains claims and purges sent/exhausted
rows after retention. Provider effects remain outside the database transaction
and retain HMAC signing, redirect rejection, and external idempotency headers.

Migration `0110_operational_alert_outbox_status.sql` adds a separate
`appsea-operational-alert-status-v1` maintenance lease and a bounded scalar
status reader. `pnpm worker:alerts:status` reports pending/sending/exhausted,
age, truncation, and clear/alert/incomplete state without returning payloads or
mutating the outbox. It is local telemetry rather than a provider or incident
router, and it never enqueues its own observation.

## Consequences

- Provider/process failures leave an inspectable retry record without persisting
  source text, credentials, response bodies, or raw exception strings.
- Alert producers must use the durable helper; direct provider sends are only a
  fallback when the maintenance database was never opened during startup
  failure handling.
- Migration history remains append-only, while v2 scheduler functions extend
  the allowlist for alert scans and the drain.
- Endpoint ownership, secret rotation, provider idempotency, scheduler uptime,
  and incident routing remain deployment responsibilities.
