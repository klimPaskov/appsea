---
name: appsea-worker-job
description: Use when adding or changing AppSea worker commands, scheduled jobs, durable workflows, retries, or recovery.
---

# AppSea worker job

## Procedure

1. Define the job input and validated output.
2. Choose a stable idempotency key.
3. Record checkpoints before external or expensive stages.
4. Make retries bounded and classify retryable failures.
5. Support cancellation and terminal failure records.
6. Track source quota, model cost, duration, and output artifact ids.
7. Keep fixture mode deterministic.
8. Write artifacts atomically and print explicit output paths.
9. Test duplicate runs, partial failure, retry, and resume.

Do not rely on an in-memory loop for production durability. Do not hide a partial result behind a successful exit code.

## Completion

The job can be safely rerun, interrupted, inspected, and resumed without duplicating evidence or plans.
