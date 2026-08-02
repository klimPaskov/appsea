# Production-analysis attempt telemetry tranche

Date: 2026-08-02
Status: implemented and package-validated; PostgreSQL integration remains
Docker-blocked in this environment.

## Outcome

Production-analysis activity attempts are now durable operational metadata.
The Temporal worker passes its bounded activity attempt separately from the
validated persistence input. PostgreSQL migration `0055` stores the highest
observed value on `production_analysis_runs`, rejects decreases, and grants
the runtime only the new column update. Private status fallback reads expose
the stored value for queued, running, and completed runs.

The attempt is intentionally excluded from the content hash, so retries and
replays retain the existing idempotency contract. The workflow result now uses
the activity result's attempt instead of a hard-coded `1`.

## Changed surfaces

- `packages/contracts`: strict activity-result contract and bounded attempt
  validation.
- `packages/workflows`: activity interface and production-analysis workflow
  projection use the returned attempt.
- `apps/worker`: reads `Context.current().info.attempt`, persists it as
  execution metadata, and emits only the existing bounded event fields.
- `packages/db`: migration `0055`, monotonic repository projection, status
  mapping, and service-column grant.
- Tests cover contract bounds, Temporal retry projection, status reads, SQL
  migration shape, and a real-PostgreSQL monotonicity scenario.
- Architecture, runbook, plan, current status, known gaps, and project memory
  now distinguish durable attempt counts from still-open event telemetry.

## Validation

- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/contracts test` — 72 passed.
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/db test` — 97 passed.
- `pnpm --filter @appsea/workflows typecheck` — passed.
- `pnpm --filter @appsea/workflows test` — 28 passed, including a three-attempt
  production-analysis retry projection.
- `pnpm --filter @appsea/worker typecheck` — passed.
- `pnpm --filter @appsea/worker test` — 63 passed.
- PostgreSQL integration test coverage was added but cannot execute until the
  local Docker Desktop Linux engine is available.

## Security and scope review

The change adds no source payload, personal data, credential, raw exception,
or workflow hash to logs or read contracts. Attempts are bounded in Zod and
PostgreSQL, monotonic in a trigger, and written only through the reviewed
runtime column grant. No source was activated, no production migration was
run, and no production deployment was claimed.

Remaining gaps are event-level timings/heartbeats, automatic scheduling,
production Temporal/DB provisioning, and the separate source/legal/security
approval work recorded in `docs/status/known-gaps.md`.
