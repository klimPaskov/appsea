# Complaint-cluster review slice — 2026-08-05

## Delivered

- Added strict cluster review and identifier-only snapshot contracts in
  `packages/contracts`.
- Added migration `0106_cluster_review_governance.sql` with forced RLS,
  append-only events, stale input checks, idempotency, split/merge lineage,
  transactional membership updates, and scalar audit/outbox receipts.
- Added the authenticated PostgreSQL cluster-review repository and package
  export. Narrative fields are masked in private projections when linked
  evidence is redacted.
- Added the deep-research cluster-review blocker and included current review
  states in the gate reproducibility hash.
- Added private Evidence API routes and a focused dark-theme review surface;
  fixture clusters are explicitly read-only.

## Validation

- `pnpm --filter @appsea/contracts typecheck` — pass.
- `pnpm --filter @appsea/contracts test` — 110 tests pass.
- `pnpm --filter @appsea/db typecheck` — pass.
- `pnpm --filter @appsea/db test` — 37 files / 165 tests pass.
- `pnpm --filter @appsea/research typecheck` and research tests — pass.
- `pnpm --filter @appsea/web typecheck` and lint — pass.
- `pnpm --filter @appsea/web test` — 60 files / 216 tests pass.

Docker-backed PostgreSQL migration and backup/restore proof was not available
on this workstation because the Docker Desktop Linux engine named pipe was
unavailable. The migration remains pending a fresh-install and populated-upgrade
run before production deployment claims.

## Scope boundary

This slice does not activate a new external source, infer unique authors,
redistribute complaints, or create new split/merge cluster versions. Those are
reviewed follow-up work.
