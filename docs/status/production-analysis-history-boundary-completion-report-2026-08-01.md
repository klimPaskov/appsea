# Production analysis history-boundary completion report

Date: 2026-08-01

## Outcome

New production analysis starts use `production-analysis-v2`. Temporal receives
only workspace, collection, analysis, seed-review, request-time, and derived
digest identifiers. Complaint excerpts, evidence rows, reports, plan files,
and the redacted analysis artifact are reconstructed inside the worker activity
from workspace-bound PostgreSQL rows immediately before idempotent persistence.

The public leaderboard and fixture path are unchanged. The CFPB connector
remains disabled and no synthetic fixture is presented as market research.

## Changed surfaces

- `packages/contracts` replaces the v1 Temporal input shape with the strict
  identifier-only v2 start/input schemas and metadata.
- `packages/workflows` hashes only stable identifiers, advertises v2, and
  validates the sanitized workflow envelope.
- `apps/worker` reconstructs the production artifact inside the activity; the
  handoff, recomputation dispatcher, and private web route pass only the seed
  review identifier.
- The activity uses a server-observed timestamp for artifact/report/plan
  creation and retention; the repository rejects materially future timestamps
  supplied by direct callers.
- Finalization locks the active/current/unexpired policy, enforces
  allowed/restricted commercial use, and verifies confirmed redacted evidence
  and display representation before linking outputs.
- Production collection workflow initialization now fails closed when the
  database admission reservation is missing or already consumed; both the
  existing-job and insert paths roll back instead of starting Temporal.
- Migration `0042` adds an authenticated manual-analysis admission boundary:
  the private route stores only a digest/input reservation before Temporal,
  binds the session user into the identifier-only envelope, and the worker
  consumes/releases that reservation with run persistence. Actor identity is
  immutable, and consumed/released digests replay without another slot.
- Route, client, and recomputation tests assert that no artifact crosses the
  start boundary.

## Validation

- `pnpm --filter @appsea/contracts typecheck`
- `pnpm --filter @appsea/workflows typecheck`
- `pnpm --filter @appsea/worker typecheck`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/contracts test` (61 tests)
- `pnpm --filter @appsea/workflows test` (19 tests)
- `pnpm --filter @appsea/worker test` (39 tests)
- `pnpm --filter @appsea/web test` (53 tests)
- `pnpm --filter @appsea/db test -- production-analysis-repository.test.ts`
  (56 tests across the db suite)

The client and private route tests inspect the prepared input and assert that
the serialized request has no `artifact` field or complaint excerpt.
The persistence helper test rejects a 2099 timestamp when evaluated against a
fixed current time.

## Remaining deployment/security gaps

This tranche does not erase existing v1 Temporal histories. A deployment must
drain or retain v1 workers until those executions finish, then remove v1 only
through an approved retention plan. Object-store purge and crash-race
handling, atomic lease assert-to-persist ownership, stale recompute claim
recovery, retryable tombstone propagation, source-policy reviewer
independence, and production
Temporal TLS/namespace authorization remain open. The direct source CLI now
uses the migration `0051` worker-principal admission branch and shares the
bounded production ledger; deployment-level service-role rotation and
namespace authorization remain open. Docker-backed database and worker
integration proof is also still unavailable in this environment.

This report is evidence for the history boundary only, not a claim that AppSea
is production-ready or that a real source has been activated.
