# Durable worker shutdown completion report — 2026-08-03

Status: repository-level graceful shutdown and local/CI worker-replacement
boundaries implemented and tested. It does not claim a deployed
process-supervisor or hosted restore/failover result.

## Delivered

- Added an idempotent worker lifecycle guard for SIGINT/SIGTERM.
- The durable worker now requests Temporal shutdown, stops heartbeat and
  handoff/recomputation scans, awaits the scan-loop drain, emits the bounded
  stop event, and closes PostgreSQL and Temporal connections.
- Added the local Temporal runbook, worker guidance, ADR 0017, and this report.
- Added the bounded, production-rejected persistence pause and CI drill that
  force-stops a real worker during an activity and verifies replacement output.

## Validation

- The worker package passes all 112 tests, typecheck, and lint locally. The
  focused lifecycle tests prove repeated signals invoke cleanup once and the
  shutdown marker is set before cleanup begins.
- Full `pnpm verify` passes locally: all 56 package tasks, fixture worker,
  sample plan/analysis generation, web smoke, and repository validation.
- GitHub Actions run `30790024810` is green for commit `557ec62`, including
  aggregate verification, fresh PostgreSQL persistence, and fresh Temporal
  workflow gates.
- GitHub Actions run `30841762532` is green for commit `c703747`; its workflow
  job passed the process-replacement drill with one job/run, seven checkpoints,
  one cost row, and two distinct outbox receipts.

## Remaining deployment gate

Configure the process supervisor with a drain window, then run a deployed
worker replacement/restore drill and inspect Temporal checkpoint/idempotency
evidence. A forced kill is crash-recovery evidence, not proof of graceful
shutdown.
