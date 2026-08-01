# Production analysis object purge completion report

- Date: 2026-08-01
- Scope: retention-aware purge of invalidated production-analysis output objects
- Status: repository tranche complete; production cloud deployment remains blocked

## Outcome

When source deletion invalidates a production analysis, migration `0043` now
queues the complete artifact, report, and plan object references before the
transaction commits. A bounded source-maintenance pass claims those rows,
marks the external object deleted, waits for its immutable `retentionUntil`,
and purges it through the workspace-bound object-store adapter. The queue is
tenant-scoped, forced-RLS, idempotent by object URI, and reclaimable after a
stale claim. Fixed failure metadata prevents provider or filesystem exception
text from reaching database rows or worker events.

The filesystem adapter treats a missing metadata sidecar as an orphan-cleanup
retry rather than a successful no-op. This closes the local crash window where
the blob body could otherwise survive indefinitely.

## Changed surfaces

- `packages/db/migrations/0043_production_analysis_object_purge.sql`
  creates the queue, trigger, constraints, indexes, RLS, and least-privilege
  grants.
- `packages/db/src/production-analysis-object-purge-repository.ts` adds
  skip-locked claims, stale recovery, retention waiting, completion, and
  bounded retries.
- `apps/worker/src/maintenance-runner.ts` and `source-maintenance.ts` run the
  queue with the retention budget and require `APPSEA_OBJECT_STORE_ROOT`.
- `packages/object-store/src/index.ts` removes orphaned filesystem bodies on
  retry; observability and source-maintenance contracts expose a bounded purge
  counter.
- Tests cover repository mark/purge/wait behavior, filesystem orphan cleanup,
  maintenance budgeting, contract shape, migration assertions, and a real
  PostgreSQL trigger/RLS integration path (Docker-gated in this environment).

## Validation

- `pnpm --filter @appsea/contracts lint typecheck test` passed (62 tests).
- `pnpm --filter @appsea/object-store lint typecheck test` passed (9 tests).
- `pnpm --filter @appsea/db lint typecheck test` passed (69 tests).
- `pnpm --filter @appsea/worker lint typecheck test` passed (46 tests).
- PostgreSQL integration coverage was added but cannot run here because the
  Docker Desktop Linux engine pipe is unavailable.

## Deliberate simplifications and remaining blockers

- The trigger covers invalidated production-analysis output objects only; it
  does not implement source-wide retention, active-output expiry, workspace
  closure, exports, or raw-source object deletion.
- The checked-in adapter is an in-memory/filesystem seam. Encrypted,
  versioned S3-compatible storage, backup deletion verification, conditional
  deletes across multiple worker processes, production scheduler ownership,
  and alerting still require deployment-specific review and proof.
- No source was activated and no fixture data was presented as market research.
