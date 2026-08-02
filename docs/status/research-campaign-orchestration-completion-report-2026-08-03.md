# Research campaign orchestration completion report — 2026-08-03

## Status

Implemented as a production-shaped local/CI slice. It is not a production
activation claim: the CFPB and Stack Exchange sources remain disabled, and
deployed Temporal, scheduler ownership, crash/retry drills, and PostgreSQL
integration execution remain release gates.

## Delivered

- Added migration `0068_research_campaign_orchestration.sql` with forced-RLS
  parent/child tables, idempotency/input digests, actor checks, bounded claim
  leases and attempts, monotonic transition guards, source-policy gates,
  service grants, and dispatch indexes.
- Added strict parent/child contracts and bounded maintenance counters in
  `packages/contracts`.
- Added `PostgresResearchCampaignOrchestrationRepository` with authenticated
  parent creation/replay, private list/detail reads, service claims, stale
  claim recovery, dispatch/failure transitions, and durable workflow
  reconciliation. Parent state is projected back to the campaign aggregate;
  one child cannot mark a multi-source campaign complete by itself.
- Added the worker orchestration runner to the existing lease-backed source
  maintenance pass. It rechecks connector support and current approved policy,
  uses the existing service production-workflow admission, starts the existing
  one-source Temporal workflow, applies bounded retry/terminal failure codes,
  and emits a separate bounded orchestration completion event.
- Added private campaign orchestration history/detail routes and a focused
  campaign-page history disclosure. The public leaderboard remains unchanged
  and sparse.
- Added fixture-backed unit coverage for contract invariants, repository replay,
  dispatch/failure paths, worker policy/admission behavior, maintenance
  counters, route branching, and the migration catalog.

## Validation

- `pnpm --filter @appsea/contracts test` — 82 passed.
- `pnpm --filter @appsea/db test` — 119 passed.
- `pnpm --filter @appsea/worker test` — 96 passed.
- `pnpm --filter @appsea/web test` — 118 passed.
- Contracts, DB, worker, and web typechecks and lints passed.
- `pnpm format:check` passed.
- Docker-backed `verify:persistence:fresh` and `verify:workflows:fresh` were
  not executable on this host because the Docker Desktop Linux engine pipe is
  unavailable. The migration/RLS integration assertions remain in the suite.

## Security and source-policy review

The web boundary requires an authenticated private workspace and owner/editor
role for enqueueing; read routes repeat membership and private-workspace checks.
The service worker uses a separate principal, maintenance fence, workspace RLS,
digest-only child identity, current policy recheck, and existing admission gate
before Temporal. Imported source content is never used as instructions and no
raw source payload, caller idempotency key, policy hash, or source text is
returned by the orchestration read model. No source policy was activated.

## Simplifications and remaining work

- The first slice supports only two to sixteen sources and dispatches one child
  per bounded maintenance claim; pagination and fan-out tuning remain open.
- Child workflows still use the existing one-source collection workflow; a
  separate multi-source Temporal workflow was intentionally not introduced.
- Cancellation UI/API, external object-store/backup purge, deployed identity
  provider controls, and live connector approval remain outside this tranche.
- Real PostgreSQL and Temporal crash/retry proof must run in a working local or
  CI environment before this boundary is called operational.
