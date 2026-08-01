# Automatic recomputation completion report

- Date: 2026-08-01
- Scope: source-deletion recomputation scheduling, active-evidence dispatch,
  bounded recovery, observability, and documentation alignment
- Status: implemented as a production-shaped local/CI slice; production
  Temporal, scheduler alerting, source approval, and PostgreSQL deployment
  remain open

## Surface audit

| Surface               | Result                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Persistence           | Migration `0037` adds a forced-RLS, tenant-scoped recomputation read-state table with tombstone, collection-run, opportunity, seed, and deterministic analysis lineage; a security-definer trigger rejects active-opportunity or cross-seed inserts; grants are limited to the service role. | `packages/db/migrations/0037_production_analysis_recompute_jobs.sql`                                                        |
| Invalidation boundary | Opportunity invalidation and recomputation enqueue happen in one transaction. One job is idempotently keyed per opportunity/tombstone; a withdrawn seed is retained as `blocked` instead of bypassing approval.                                                                              | `packages/db/src/deletion-propagation-repository.ts`                                                                        |
| Worker dispatch       | Skip-locked claims close superseded jobs, require an invalidated opportunity and no active output, reconstruct active confirmed evidence, preserve deletion coverage gaps, and start the existing Temporal analysis workflow idempotently.                                                   | `packages/db/src/production-analysis-recompute-repository.ts`, `apps/worker/src/production-analysis-recompute.ts`           |
| Recovery              | Readiness and transient dispatch failures use bounded retries; seed withdrawal blocks until approval; seed lineage failure is terminal.                                                                                                                                                      | `packages/db/src/production-analysis-recompute-repository.test.ts`, `apps/worker/src/production-analysis-recompute.test.ts` |
| Observability         | Maintenance results and secret-free worker events report recomputation jobs queued; scan failures have a distinct event.                                                                                                                                                                     | `packages/contracts/src/index.ts`, `apps/worker/src/maintenance-runner.ts`, `apps/worker/src/observability.ts`              |
| Public boundary       | The sparse public leaderboard is unchanged. Private collection and opportunity routes remain the detail boundary; no raw source text or caller complaint payload enters the repair job.                                                                                                      | Existing web route tests and security-boundary documentation                                                                |

## Validation

- Focused Vitest passed for the recomputation repository, deletion
  propagation, dispatcher, maintenance runner, observability, database
  migration assertions, and contracts: 6 files, 75 tests before the new
  dispatcher slice; the recomputation-focused run passes 3 files, 12 tests.
- TypeScript passed for `packages/contracts`, `packages/db`, and
  `apps/worker`.
- `pnpm verify` passed on 2026-08-01, including package lint/typecheck/test/build,
  fixture/plan/analysis samples, web smoke, and repository checks.
- Docker-backed PostgreSQL and Temporal integration remain unavailable because
  the local Docker Desktop Linux engine pipe is absent.

## Security and simplifications

- The queue never acquires a source record. It reuses the completed collection
  run and fails closed when policy, evidence, or seed lineage is unavailable.
- Automatic scheduling means durable enqueue plus worker dispatch; it does not
  mean automatic source re-collection, seed invention, or approval. Those remain
  explicit reviewed actions.
- Production Temporal authentication/HA, scheduler ownership and alerting,
  encrypted cloud object storage, backup purge, live source approval, and
  Docker-backed crash/replay proof remain release blockers.
