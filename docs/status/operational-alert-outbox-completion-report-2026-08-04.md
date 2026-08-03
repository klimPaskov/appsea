# Operational alert outbox completion report - 2026-08-04

Status: repository-level durable operational-alert delivery implemented. This
does not claim a deployed provider, scheduler, or incident-response operation.

## Delivered

- Added migration `0082` with a maintenance-owned scalar outbox, idempotent
  enqueue, server-clock claims, stale-claim recovery, bounded retry and
  exhaustion, retention purge, direct-table access denial, and v2 scheduler
  lease/metrics functions for the alert scans and drain.
- Added validated contracts and a repository that calls only migration-owned
  functions; imported content cannot enter the outbox as arbitrary objects or
  unknown fields.
- Updated the three alert inspection commands to enqueue before HMAC delivery
  and added `pnpm worker:alerts:deliver` for bounded durable draining.
- Added fixed delivery counters to worker telemetry, unit coverage, a
  PostgreSQL integration slice, ADR 0018, runbook updates, status updates,
  active-plan updates, and worker guidance.

## Validation

- Contracts: 93 tests, typecheck, and lint pass locally.
- Database: 137 unit tests, typecheck, and lint pass locally; integration
  coverage includes idempotent enqueue, service/maintenance direct-table
  denial, retry/reclaim/complete, and v2 scheduler names. A fresh PostgreSQL
  run is required for SQL execution proof.
- Worker: 116 tests, typecheck, and lint pass locally, including provider
  failure redaction and outbox-first delivery.
- Full `pnpm verify` passes locally: all 56 package tasks, fixture worker,
  sample plan/analysis generation, web smoke, agents synchronization, and
  repository validation. `pnpm memory:check`, `pnpm docs:check`,
  `pnpm format:check`, and `git diff --check` also pass.

## Security review

The outbox accepts only a bounded, allowlisted scalar event envelope. It stores
no complaint text, imported instructions, credentials, provider responses, or
raw exception messages. Runtime and maintenance roles cannot select or mutate
the table directly; provider effects are intentionally outside the transaction.

## Remaining blockers and simplifications

- The provider endpoint, HMAC secret rotation, scheduler uptime, billing and
  incident routing, production PostgreSQL/Temporal topology, and deployment
  crash/recovery proof remain external gates.
- Local Docker-backed PostgreSQL integration cannot run until the Docker
  Desktop Linux engine is available; remote CI is required to prove migration
  syntax and role behavior.
- The outbox retains fixed scalar telemetry only; it does not make the provider
  itself transactional or guarantee delivery when the external service is
  permanently unavailable.
