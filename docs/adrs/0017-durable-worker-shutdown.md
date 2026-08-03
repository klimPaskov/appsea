# ADR 0017: Drain the durable worker before process exit

- Status: accepted
- Date: 2026-08-03

## Context

The long-lived worker owns Temporal activities, a heartbeat, and database-backed
handoff/recomputation scans. Relying on the process default signal behavior can
terminate it before the Temporal worker reaches its configured safe point or
before the scan loop and connections are closed.

## Decision

Install one idempotent SIGINT/SIGTERM lifecycle at the worker entry point. The
first signal stops new dispatch scans, requests Temporal worker shutdown, stops
the heartbeat, awaits the scan-loop drain, emits the bounded stop event, and
closes PostgreSQL and Temporal connections. Repeated signals are ignored by the
same lifecycle guard. The worker does not log signal details or raw failures.

## Consequences

- Graceful deployment rollouts preserve the existing Temporal retry/checkpoint
  and persistence safe-point contracts.
- A forced kill is still possible but is visible as a crash-recovery event and
  must be followed by normal checkpoint/workflow inspection.
- The lifecycle is unit-tested without opening external connections; deployed
  drain-window and crash-fault-injection proof remain deployment work.
