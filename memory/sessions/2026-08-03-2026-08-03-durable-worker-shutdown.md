# Resume handoff: durable worker shutdown lifecycle — 2026-08-03

## Delivered

- Added an idempotent `SIGINT`/`SIGTERM` lifecycle in
  `apps/worker/src/durable-worker.ts` and isolated it in a connection-free
  `durable-worker-lifecycle` module.
- Signals are registered before dependency connection attempts. The first
  request stops new handoff/recomputation scans, requests Temporal worker
  shutdown, stops the heartbeat, awaits scan drain, emits the bounded stop
  event, and closes PostgreSQL/Temporal connections; repeated requests do not
  repeat cleanup.
- Added focused lifecycle tests, ADR 0017, worker guidance, and deployment
  runbook/status updates.

## Validation

- The worker package passes all 112 tests, typecheck, and lint locally; the
  lifecycle module has two focused tests.
- Full `pnpm verify` and repository checks pass locally (56 package tasks,
  fixture worker, sample plan/analysis generation, web smoke, and validation).
  Remote CI still needs to run after push.

## Remaining integration

- Configure a deployed process-supervisor drain window and run a replacement
  or crash drill with Temporal checkpoint/idempotency inspection. A forced
  kill is not proof of graceful shutdown.
- Production Temporal topology, namespace authorization, source approvals,
  object-store/backup operations, and signed desktop releases remain open.
