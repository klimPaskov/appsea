# Durable worker shutdown completion report — 2026-08-03

Status: repository-level graceful shutdown boundary implemented and tested. It
does not claim a deployed process-supervisor or crash-drill result.

## Delivered

- Added an idempotent worker lifecycle guard for SIGINT/SIGTERM.
- The durable worker now requests Temporal shutdown, stops heartbeat and
  handoff/recomputation scans, awaits the scan-loop drain, emits the bounded
  stop event, and closes PostgreSQL and Temporal connections.
- Added the local Temporal runbook, worker guidance, ADR 0017, and this report.

## Validation

- The worker package passes all 112 tests, typecheck, and lint locally. The
  focused lifecycle tests prove repeated signals invoke cleanup once and the
  shutdown marker is set before cleanup begins.
- Full `pnpm verify` passes locally: all 56 package tasks, fixture worker,
  sample plan/analysis generation, web smoke, and repository validation. Remote
  CI remains required after the commit is pushed.

## Remaining deployment gate

Configure the process supervisor with a drain window, then run a deployed
worker replacement/crash drill and inspect Temporal checkpoint/idempotency
evidence. A forced kill must not be treated as proof of graceful shutdown.
