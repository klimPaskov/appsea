# Runtime skill persistence completion report — 2026-08-04

## Scope

This tranche closes the internal persistence/audit gap for the dormant runtime
skill registry. It does not activate a skill, connect a new source, or claim an
autonomous coding loop.

## Changed

- Added migration `0099_runtime_skill_governance.sql` with global skill rows,
  immutable transition events, forced RLS, operator-only functions, expected
  hash concurrency, and privileged `operator:` activation enforcement.
- Added `PostgresRuntimeSkillRepository`, which hydrates and hashes every
  record through `@appsea/skill-registry`, supports idempotent event replay,
  verifies persisted identity/evidence, and exposes bounded operator reads.
- Added repository, migration, and PostgreSQL integration tests for transitions,
  replay, tampered records, limits, service/maintenance denial, and role-safe
  migration history. Updated backup/restore latest-migration expectations to
  `0099`.
- Updated the active plan, security boundaries, PostgreSQL runbook, current
  status, known gaps, ADR index, and repository memory.

## Proof

- `pnpm --filter @appsea/db test` — passed (158 package tests).
- `pnpm verify:persistence:fresh` — passed (fresh PostgreSQL 18 lifecycle,
  52 integration tests, through migration `0099`).
- `pnpm verify:persistence` — passed (populated-upgrade lifecycle).

## Explicit simplifications and blockers

- No worker or web path imports the repository; activation remains an explicit
  operator operation with external identity/review evidence.
- No source connector was enabled and no imported content was promoted to a
  skill or permission.
- Hosted CI, provider PostgreSQL/Temporal, backups/HA, identity operations,
  desktop signing, and legal/privacy/security approval for third-party sources
  remain deployment or review blockers. The GitHub account payment/spending
  gate still prevents hosted workflow proof.
- No image asset work was needed for this backend/security tranche; no Python
  geometry or synthetic market visual was introduced.
