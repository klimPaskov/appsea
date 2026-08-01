# Retryable deletion propagation completion report

## Outcome

Migration `0044_retryable_deletion_propagation.sql` closes the first-failure
terminalization gap in source-deletion propagation. Tombstones retain their
immutable source identity and now carry an attempt counter plus a server-clock
`next_attempt_at` deadline. Pending rows and failed rows below the eight-attempt
limit are due work; processing rows hold a non-null claim lease; exhausted
failed rows have fixed failure metadata and no next attempt.

The repository claims with `FOR UPDATE SKIP LOCKED`, recovers stale processing
claims after 15 minutes, increments attempts atomically, clears retry metadata
only for the active claim, and schedules a bounded 60-second retry after a
propagation exception. A stale claim at the attempt limit is terminalized
without being claimed again. Completion remains idempotent and affected counts
remain monotonic.

## Changed surfaces

- `packages/db/migrations/0044_retryable_deletion_propagation.sql` adds retry
  columns, due indexing, state/lease/terminal trigger checks, and least-
  privilege update grants.
- `packages/db/src/deletion-propagation-repository.ts` exposes retry metadata,
  server-clock claim recovery, bounded failure scheduling, and deterministic
  mapping for the new columns.
- `packages/db/src/deletion-propagation-repository.test.ts`,
  `packages/db/integration/db.integration.test.ts`, and worker fixtures cover
  claim attempts, retry scheduling, reclaim, completion, and migration
  contracts. The PostgreSQL scenario is present but Docker-blocked here.
- `appsea-worker-job` and `appsea-database-migration` now document the reusable
  tombstone retry/recovery procedure.

## Validation

- `pnpm --filter @appsea/db lint` passed.
- `pnpm --filter @appsea/db typecheck` passed.
- `pnpm --filter @appsea/db test` passed (73 tests).
- `pnpm --filter @appsea/worker typecheck` passed.
- `pnpm --filter @appsea/worker test` passed (46 tests).
- `pnpm agents:sync`, `pnpm memory:check`, and `pnpm repo:check --docs-only`
  are required at the guidance checkpoint.
- Docker-backed PostgreSQL migration/read/deletion proof remains blocked by the
  unavailable Docker Desktop Linux engine; no production migration was run.

## Simplifications and remaining gaps

The queue uses a fixed 60-second retry delay and a fixed eight-attempt budget;
it does not yet carry per-attempt fencing tokens, so stale-claim ownership
races outside the server-clock lease remain a deployment hardening item.
Cloud object/backup deletion, workspace-closure/export purge, deployed
scheduling/alerting, direct source-CLI authentication, live source approval,
and production PostgreSQL/Temporal provisioning remain open. This tranche does
not activate a source or present fixture evidence as market research.
