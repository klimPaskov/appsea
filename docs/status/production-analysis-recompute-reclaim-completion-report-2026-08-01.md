# Production-analysis recomputation claim recovery completion report

Date: 2026-08-01

## Outcome

Deletion-triggered production-analysis recomputation jobs now recover a worker
crash after the dispatch claim is committed. The repository uses PostgreSQL's
server clock to reclaim `dispatching` rows older than 15 minutes, caps claims
at 24 attempts, and records a fixed terminal failure when an exhausted stale
claim is encountered. The deterministic Temporal workflow identity keeps a
late start idempotent.

This closes the repository-level stranded-dispatch gap. It does not claim a
deployed Temporal scheduler, authenticated namespace, or crash-injection proof.

## Changed surfaces

- `packages/db/src/production-analysis-recompute-repository.ts` now reclaims
  stale dispatch claims with `FOR UPDATE SKIP LOCKED`, server-clock eligibility,
  bounded attempts, and fixed exhausted-claim failure metadata.
- `packages/db/src/production-analysis-recompute-repository.test.ts` covers
  queued claims, stale recovery, exhausted terminalization, and existing
  retry/approval behavior.
- `packages/db/integration/db.integration.test.ts` adds a real PostgreSQL
  fixture that inserts an invalidated opportunity and stale recomputation row,
  then verifies the service role reclaims it under workspace RLS.
- `packages/db/src/index.ts` exports the reviewed recomputation limits.
- `appsea-worker-job` and `appsea-database-migration` document server-clock
  stale recovery and bounded dispatch claims as reusable procedures.
- Current status, known gaps, architecture, runbook, active plan, and project
  memory now distinguish this closed repository gap from remaining deployment
  blockers.

## Validation

- `pnpm --filter @appsea/db lint` passed.
- `pnpm --filter @appsea/db typecheck` passed.
- `pnpm --filter @appsea/db test` passed: 71 tests.
- The PostgreSQL integration test is present but requires the local Docker
  Desktop Linux engine, which is unavailable in this environment.

## Remaining blockers and simplifications

- Production Temporal TLS/authentication, HA, namespace authorization,
  scheduler ownership, metrics/alerts, and worker crash fault injection are
  still deployment work.
- Retryable tombstone propagation, cloud/backup object deletion, workspace
  closure/export purge, direct source-CLI authentication, CFPB approval, and
  live-source activation remain open.
- Claim recovery relies on deterministic Temporal idempotency; a future
  deployment may add per-attempt claim tokens if multi-worker ownership races
  require stronger fencing.
- Fixture mode remains the only complete research path, and no synthetic data
  is presented as real market research.
