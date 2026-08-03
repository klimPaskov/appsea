# Resume handoff: operational alert outbox - 2026-08-04

## Delivered

- Migration `0082_operational_alert_outbox.sql` adds a maintenance-role-only,
  scalar allowlisted operational-alert outbox, idempotent enqueue, server-clock
  claims, stale recovery, fixed-code retries/exhaustion, retention purge, and
  forward-compatible v2 scheduler lease/metrics functions.
- `packages/contracts` defines the payload, delivery ID/hash, claim, completion,
  failure, and purge contracts. `packages/db` exposes a function-only repository;
  the service and maintenance roles cannot select the outbox table directly.
- Alert inspection commands enqueue before HMAC delivery. The bounded
  `pnpm worker:alerts:deliver` command drains claims and records delivery
  counters. Worker telemetry remains secret-free.
- Docs, ADR 0018, status, active plan, worker guidance, and this handoff were
  updated. Imported content remains unable to alter code, skills, instructions,
  permissions, or repository memory.

## Validation

- Contracts: 93 tests, typecheck, lint.
- Database: 137 unit tests, typecheck, lint; integration coverage added for
  enqueue idempotency, direct access denial, retry/reclaim/complete, and v2
  scheduler names.
- Worker: 116 tests, typecheck, lint.
- GitHub Actions run `30793442326` is green for commit `4fa2fb5`, including
  aggregate verification/build, fresh PostgreSQL persistence, and fresh
  Temporal workflow gates. Local Docker Desktop was unavailable in this
  session.

## Next

The durable alert outbox tranche is complete at repository level. Do not claim
production readiness: source policy approval, deployed infrastructure, provider
operations, identity controls, object/export/backup purge, and signed desktop
releases remain open.
