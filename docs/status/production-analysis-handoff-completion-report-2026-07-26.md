# Production analysis handoff completion report

- Date: 2026-07-26
- Scope: reviewed seed-bound collection input, transactional analysis handoff
  persistence, crash-reclaimable worker dispatch, private start/read-status
  validation, and documentation/memory alignment
- Status: implemented as a production-shaped local/CI slice; production
  Temporal, database, source-policy, object-storage, and scheduler approval
  remain open

## Surface audit

| Surface              | Result                                                                                                                                                                                                                        | Evidence                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract             | Complete for this slice: `analysisSeedReviewId` is optional, strict, and part of the collection input hash; status exposes the configured seed.                                                                               | `packages/contracts/src/index.ts`, `packages/workflows/src/client.ts`, `packages/workflows/src/workflows.ts`                                                     |
| Persistence          | Complete for this slice: migration `0034` adds the approved-seed gate, RLS handoff table, deterministic identity, stale-claim recovery, retry/terminal states, and least-privilege grants.                                    | `packages/db/migrations/0034_production_analysis_handoffs.sql`, `packages/db/src/production-analysis-handoff-repository.ts`                                      |
| Collection boundary  | Complete for this slice: collection completion queues the handoff in the same transaction as the terminal collection projection.                                                                                              | `packages/db/src/production-collection-workflow-repository.ts`                                                                                                   |
| Analysis boundary    | Complete for this slice: the worker reconstructs active policy/evidence lineage and approved seed content; no source acquisition or caller complaint payload crosses the handoff.                                             | `packages/db/src/production-collection-repository.ts`, `packages/db/src/opportunity-seed-review-repository.ts`, `apps/worker/src/production-analysis-handoff.ts` |
| Worker recovery      | Complete locally: `FOR UPDATE SKIP LOCKED`, 15-minute stale dispatch recovery, bounded retry for unconfirmed evidence, idempotent Temporal start, and terminal seed-integrity failure.                                        | `apps/worker/src/durable-worker.ts`, `packages/db/src/production-analysis-handoff-repository.test.ts`                                                            |
| Private web boundary | Complete for this slice: collection start verifies an approved seed and enforces declared and chunked body limits; the collection read model now exposes bounded handoff status; the manual analysis route remains available. | `apps/web/src/app/api/workspaces/[workspaceId]/research/production/route.ts`, `packages/db/src/production-collection-repository.ts`                              |
| Public UI            | Preserved: no leaderboard or public route changes.                                                                                                                                                                            | Existing sparse leaderboard contract/tests                                                                                                                       |

## Validation

- TypeScript passed for contracts, workflows, database, worker, and web.
- ESLint and Prettier passed for changed source files; repository formatting
  check passed.
- Focused Vitest passed: contracts 58, database 35, worker 29 (excluding the
  existing Temporal activity suite), and web 43 (excluding the existing
  Temporal configuration suite). The handoff-focused database/contract/web
  run passed 62 tests. The private handoff-status contract, repository, and
  collection-route suite passes 59 tests.
- Repository docs/memory validation passed (`21` skills, `11` subagents), and
  the manifest was regenerated for `591` files.
- Docker-backed PostgreSQL and Temporal integration remains unavailable because
  the local Docker Desktop Linux engine pipe is absent.
- Temporal-dependent test suites remain blocked by the damaged local install:
  `protobufjs/light` is missing from the installed `@temporalio/proto` tree.

## Simplifications and remaining blockers

- Automatic analysis is opt-in and requires an approved seed at collection
  start. Collections without that reference remain manual; this avoids silently
  selecting a seed or claiming model-derived market conclusions.
- The queue waits for confirmed evidence only for a bounded two-hour retry
  window. It does not replace a human review UI or automatically re-collect
  deleted source records; migrations `0035`/`0036` invalidate stale
  projections and protect explicit active-evidence repair, while migration
  `0037` now queues that repair for the existing worker.
- The worker uses the existing local loopback Temporal/object-store adapters;
  authenticated Temporal, HA, deployment scheduling, alert ownership,
  encrypted cloud storage, backup/object purge, live connector approval, and
  production database provisioning remain required before release claims.

## Exact next actions

1. Run the fresh and populated PostgreSQL/Temporal integration suites with
   Docker and restore the complete Temporal dependency tree.
2. Review and approve the CFPB source policy, then provision authenticated
   Temporal, encrypted object storage, scheduler, metrics, and alerts.
3. Exercise the migration `0037` recomputation queue and private opportunity
   reactivation under repeated production research runs with Docker-backed
   PostgreSQL and authenticated Temporal.
