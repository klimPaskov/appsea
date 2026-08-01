# Source-maintenance snapshot scheduler completion report — 2026-08-01

## Outcome

The repository-level source-maintenance command now owns bounded resume of due
identifier-only CFPB snapshot reconciliation jobs. A pass enumerates the same
active workspace set used by deletion maintenance, calls the durable
reconciliation runner at most once per sorted workspace, and stops at an
independent `snapshotReconciliationBatchSize` budget. The runner remains the
owner of policy, quota, lease, page-checkpoint, retry, and deletion-proof
semantics.

The command emits only bounded counters: processed, completed, incomplete,
failed, retried, and visible coverage gaps. It never logs source content or a
caller idempotency key. The targeted `source:cfpb:reconcile:next` command is
unchanged and remains available for narrowly scoped recovery.

## Changed surfaces

- `packages/contracts`: source-maintenance input and result schemas now carry
  the independent snapshot budget and bounded counters.
- `apps/worker/src/maintenance-runner.ts`: optional snapshot-resume callback,
  sorted workspace fairness, independent budget, state classification, and
  coverage-gap accounting.
- `apps/worker/src/source-maintenance.ts`: production wiring to the existing
  CFPB snapshot runner, environment configuration, and aggregate events.
- `apps/worker/src/observability.ts`: secret-free snapshot counters.
- Tests cover sorted per-workspace fairness, budget truncation, retry state,
  and coverage-gap reporting; existing contract and worker suites remain green.
- Runbooks, status, active plan, memory, and the worker-job skill now describe
  the repository scheduler boundary and its deployment limitations.

## Decisions and simplifications

- The maintenance pass processes one due job per workspace per invocation. It
  does not drain a workspace or run an unbounded loop.
- No migration was required: snapshot jobs, page checkpoints, leases, and
  retry deadlines already provide the durable boundary.
- The implementation reuses the deletion-maintenance workspace enumerator;
  it does not add a second cross-workspace RLS bypass or a separate scheduler
  table.
- The command defaults to one snapshot resume per pass. Operators can set the
  bounded environment variable to zero to disable snapshot work for a run.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (62 tests).
- `pnpm --filter @appsea/contracts lint` — passed.
- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/worker test` — passed (47 tests).
- `pnpm --filter @appsea/worker lint` — passed.
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm exec prettier --write ...` — passed for changed TypeScript files.

The real PostgreSQL scheduler path remains Docker-blocked in this environment;
`//./pipe/dockerDesktopLinuxEngine` is unavailable. Deployed scheduler
ownership, alerting, service-role separation/secret rotation, source policy
approval, Temporal production, and cloud retention remain release blockers.
