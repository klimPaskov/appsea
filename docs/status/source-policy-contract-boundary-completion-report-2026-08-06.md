# Source-policy contract boundary completion report — 2026-08-06

Status: implemented and locally validated. This tranche hardens the handoff
between PostgreSQL source-policy approval and production connector execution;
it does not approve or activate a third-party source.

## Outcome

Production connector construction now receives the immutable policy JSON payload
that the database approval read verified. The effective policy snapshot may
change only database-owned activation fields (`enabled`, `policyState`,
`reviewedAt`, and `expiresAt`). Connector constructors compare the remaining
policy contract before a source request, including purposes, quotas, retention,
deletion duties, attribution, display mode, and coverage metadata. A production
constructor without the reviewed payload fails closed.

## Changed surfaces

- `packages/connectors/src/index.ts` adds the stable immutable-policy projection
  and applies it to CFPB and Stack Exchange constructors.
- `packages/connectors/src/manual-import.ts` applies the same boundary to the
  tenant-private owner-import connector.
- `packages/db/src/source-policy-repository.ts` returns the verified raw policy
  payload alongside the effective activation snapshot from `readCollectible`.
- `apps/worker/src/production-cfpb-runner.ts` and
  `apps/worker/src/production-cfpb-reconciliation.ts` carry that payload into
  connector construction.
- Connector tests cover quota, purpose, and retention tampering plus the
  production missing-snapshot failure.
- Architecture, runbook, scoped connector guidance, and project memory record
  the boundary.

## Validation

- `pnpm --filter @appsea/connectors test` — 32 tests passed.
- `pnpm --filter @appsea/worker test` — 124 tests passed.
- `pnpm --filter @appsea/db test` — 179 tests passed.
- Affected package lint and typecheck passed.
- `pnpm verify` passed, including formatting, repository checks, fixture
  research, plan generation, research-quality gates, web smoke, and static
  release verification.
- Direct localhost checks returned `200` for `/`, the leaderboard, all four
  opportunity routes, and `/api/health/live`; `/api/health/ready` returned the
  expected `503` without local PostgreSQL/Temporal dependencies.
- Docker-backed fresh-schema and integration proof remains environment-blocked
  when the Docker Desktop Linux engine is unavailable.

## Explicit limits

This is a handoff-integrity control, not legal approval, source activation,
provider authentication, quota settlement, or deployment proof. CFPB and Stack
Exchange remain disabled pending independent legal/privacy/security review.
