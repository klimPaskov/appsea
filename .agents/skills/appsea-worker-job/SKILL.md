---
name: appsea-worker-job
description: Use when adding or changing AppSea worker commands, scheduled jobs, durable workflows, retries, or recovery.
---

# AppSea worker job

## Procedure

1. Define the job input and validated output.
2. Choose a stable idempotency key.
3. Record checkpoints before external or expensive stages. For paged source
   work, make each page checkpoint idempotent and persist warnings alongside the
   offset so a retry cannot silently lose a coverage gap.
4. Make retries bounded and classify retryable failures.
5. Support cancellation and terminal failure records.
6. Track source quota, model cost, duration, and output artifact ids. Carry a
   settled source-request cost from the connector/quota boundary through the
   immutable result, workflow checkpoint/ledger, and secret-free audit event;
   default only for explicitly versioned legacy artifacts.
7. Preflight any known source-request cost against the workflow budget before
   opening a source lease or making an external request. Return a bounded
   budget-rejected result with the estimate; never discover a known overage
   only after a quota reservation settles.
8. Keep fixture mode deterministic.
9. Write artifacts atomically and print explicit output paths.
10. Test duplicate runs, partial failure, retry, and resume. If a source quota
    reservation settles without a matching checkpoint, stop for explicit
    reconciliation instead of issuing an unbounded duplicate request.
11. For authenticated workflow starts, reserve a digest-only admission before
    contacting the durable workflow service, consume it in the same transaction
    as job/run initialization, and release it on terminal completion/failure.
    Keep source-collection and downstream-analysis admission ledgers separate;
    bind the immutable requesting actor and purge stale reservations through a
    bounded maintenance job.
12. For external object deletion, enqueue the complete immutable reference in
    PostgreSQL before touching the store. Mark the object deleted first, wait
    for the stored retention deadline, then purge through the adapter. Use a
    skip-locked claim with stale recovery and fixed retry metadata; a missing
    sidecar/body must be safe to reconcile on a later attempt.
13. For database-backed dispatch queues, reclaim `dispatching` rows only from
    a server-clock stale window, bound attempts before claiming, and
    terminalize exhausted stale claims with fixed failure metadata. Use a
    deterministic downstream workflow identity so a late worker start is an
    idempotent replay rather than a duplicate research run.
14. For source-deletion tombstones, keep the complete provenance row in a
    forced-RLS queue, claim with `FOR UPDATE SKIP LOCKED`, and make failed
    propagation retryable with a server-clock deadline and bounded attempts.
    Recover stale processing claims, preserve fixed failure metadata, and
    terminalize only exhausted rows; never turn a transient propagation error
    into an uninspectable or silently dropped deletion.
15. For direct source-reconciliation commands, establish an explicit worker
    service principal inside the workspace transaction and require the target
    workspace to be active, private, and non-fixture. User-triggered requests
    need a separate authenticated owner/editor admission function with fixed
    rate/concurrency limits; do not let a CLI bypass that source-policy gate.
16. When a maintenance pass also resumes source snapshots, enumerate the same
    bounded active-workspace set in stable order, process at most one due job
    per workspace, and apply an independent batch budget. Report terminal,
    retry, and coverage-gap counters without logging source content or caller
    idempotency keys; keep a targeted resume command for operator recovery.

Do not rely on an in-memory loop for production durability. Do not hide a partial result behind a successful exit code.

## Completion

The job can be safely rerun, interrupted, inspected, and resumed without duplicating evidence or plans.
