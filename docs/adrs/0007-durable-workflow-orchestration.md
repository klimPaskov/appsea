# ADR 0007: Durable workflow orchestration

- Status: accepted
- Date: 2026-07-24

## Context

Research jobs must survive worker replacement, retry transient activity failures,
record inspectable progress, enforce cost and source-item budgets, and preserve
idempotency when a caller or worker is retried. PostgreSQL already owns product
records and their invariants. A database polling table would duplicate workflow
engine behavior and make cancellation and recovery ambiguous.

## Decision

The first durable workflow implementation uses the Temporal TypeScript SDK
`1.20.2` and a fixed `appsea-research-v1` task queue. The local Compose proof
uses `temporalio/temporal:1.8.0` with SQLite on a named volume. That image,
SQLite configuration, loopback binding, and unauthenticated UI are local/CI
development choices only; they are not a production deployment recipe.

Workflow histories contain only validated, small identifiers, hashes, budgets,
and fixed failure summaries. Raw idempotency keys, source payloads, complaint
text, artifacts, plans, and exception messages stay outside workflow history.
Activities validate their inputs, perform database and research side effects,
and map failures to fixed retryable or non-retryable application failure types.

PostgreSQL stores the workspace-scoped workflow projection, immutable checkpoints,
input and idempotency hashes, budget counters, output lineage, terminal audit,
cost, and outbox records. Composite foreign keys prevent an output from a
different run or opportunity being attached to a job. The workflow ID is derived
from a scoped idempotency digest; a reused key with a different input hash is a
conflict.

Activity retries are bounded by the validated job budget. Persistence and its
completion projection run inside a non-cancellable safe point. Cancellation
before that point records a sanitized terminal state; a late cancellation cannot
downgrade a committed result. Terminal cleanup can reconcile a committed fixture
run after a response loss or worker restart.

All monetary counters use integer USD micros. Fixture mode remains deterministic
and explicitly synthetic; its first activity reports zero model/source cost.

## Consequences

- `packages/workflows` is deterministic workflow code and has no database, Node,
  crypto, or raw evidence dependency.
- `apps/worker` owns activity adapters, PostgreSQL access, report generation, and
  local Temporal process configuration.
- `packages/db` remains the source of truth for workspace authorization defense,
  state transitions, lineage, and one-time ledgers.
- `pnpm verify:workflows:fresh` proves a fresh local stack, retry/replay behavior,
  Temporal restart recovery, PostgreSQL idempotency, and absence of the raw local
  key from decoded Temporal payloads.
- Production still requires an authenticated and TLS-protected Temporal endpoint,
  namespace/task-queue provisioning, worker identity and authorization, HA,
  backups/retention, alerting, deployment controls, and fault-injection proof.
  These are explicit release blockers, not implied by the local proof.

## Rejected alternatives

- An in-memory worker loop cannot resume after process loss.
- A PostgreSQL polling queue would duplicate timers, retries, cancellation, and
  execution history while weakening the existing state invariants.
- Passing raw evidence or caller secrets through workflow arguments would make
  durable history an unnecessary retention and disclosure boundary.
