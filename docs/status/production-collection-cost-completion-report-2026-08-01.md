# Production collection cost propagation — 2026-08-01

## Outcome

The approved source quota settlement cost now remains visible across the
production collection boundary. `CfpbConnector` returns the settled request
cost, the worker passes it into the immutable PostgreSQL collection snapshot and
result, and Temporal checkpoints, terminal workflow ledgers, and audit/outbox
metadata consume the same value. Existing snapshots remain readable because
the persisted JSON contract defaults missing cost to zero.

The reviewed CFPB policy still declares zero API cost and remains disabled until
legal, privacy, security, and deployment review. This tranche adds accounting
continuity and rejects a known source-cost overage before opening the source
lease; it does not activate a source or prove a non-zero billing adapter.

## Evidence

- `packages/connectors/src/index.ts` returns `costMicros` after durable quota
  settlement; fixture collection remains explicitly zero-cost.
- `packages/contracts/src/index.ts` bounds cost at one trillion micro-USD and
  defaults legacy collection snapshots/results to zero.
- `packages/db/src/production-collection-repository.ts` stores cost in the
  snapshot/result and identifier-only audit/outbox payloads.
- `apps/worker/src/production-workflow-activities.ts` carries the persisted
  cost into checkpoints and replay reconciliation.
- `apps/worker/src/production-cfpb-runner.ts` preflights the approved policy's
  known request cost before lease acquisition; the Temporal workflow returns a
  bounded `cost_budget_exceeded` result with the estimate.
- `apps/worker/src/production-cfpb.ts` includes the bounded cost in its
  identifier-only CLI result.
- Connector, repository, workflow, database, and worker tests cover a
  non-zero synthetic policy cost and the zero-cost reviewed CFPB policy.

## Validation

- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/connectors test` — 16 tests passed.
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/db test` — 74 tests passed.
- `pnpm --filter @appsea/workflows typecheck` — passed.
- `pnpm --filter @appsea/workflows test` — 21 tests passed.
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm --filter @appsea/worker test` — 48 tests passed.
- Docker-backed PostgreSQL/Temporal verification remains unavailable because
  the Docker Desktop Linux engine pipe is not running.

## Remaining gaps

Production source approval, non-zero provider pricing adapters, deployment-level
cost monitoring/alerts, cloud storage/backups, and production infrastructure
remain open. The cost field does not alter source deletion, re-collection, or
fixture disclosure boundaries.
