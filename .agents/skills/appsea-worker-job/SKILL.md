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
6. Track source quota, model cost, duration, and output artifact ids.
7. Keep fixture mode deterministic.
8. Write artifacts atomically and print explicit output paths.
9. Test duplicate runs, partial failure, retry, and resume. If a source quota
   reservation settles without a matching checkpoint, stop for explicit
   reconciliation instead of issuing an unbounded duplicate request.
10. For authenticated workflow starts, reserve a digest-only admission before
    contacting the durable workflow service, consume it in the same transaction
    as job/run initialization, and release it on terminal completion/failure.
    Keep source-collection and downstream-analysis admission ledgers separate;
    bind the immutable requesting actor and purge stale reservations through a
    bounded maintenance job.
11. For external object deletion, enqueue the complete immutable reference in
    PostgreSQL before touching the store. Mark the object deleted first, wait
    for the stored retention deadline, then purge through the adapter. Use a
    skip-locked claim with stale recovery and fixed retry metadata; a missing
    sidecar/body must be safe to reconcile on a later attempt.

Do not rely on an in-memory loop for production durability. Do not hide a partial result behind a successful exit code.

## Completion

The job can be safely rerun, interrupted, inspected, and resumed without duplicating evidence or plans.
