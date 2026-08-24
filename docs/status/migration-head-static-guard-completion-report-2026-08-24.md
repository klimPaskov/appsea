# Migration-head static guard completion report - 2026-08-24

Status: implemented and locally verified; this is a repository-integrity check,
not fresh PostgreSQL or production-readiness evidence.

## Scope

The production release verifier now inspects the checked-in
`packages/db/migrations` directory during its static-only path. It fails closed
when the inventory contains an invalid filename, duplicate version, missing
version, non-contiguous ordering, or a head other than the reviewed `0123`.
The guard expects exactly 123 SQL migrations and never connects to PostgreSQL,
Temporal, object storage, or a source provider.

This catches accidental migration drift before deployment while preserving the
separate Docker-backed fresh/upgrade, backup/restore, role/RLS, hosted HA, and
provider-operations gates.

## Proof

- `node --test scripts/verify_release.test.mjs` — 9 tests passed, including
  missing-head, invalid-filename, and duplicate-version regressions.
- `pnpm verify:release -- --static` — passed without opening a provider or
  dependency connection.
- `pnpm docs:check` — passed after the repository checker was hardened to
  prune pnpm/Windows junction directories instead of following them during
  Markdown, JSON, and TOML validation.
- `packages/db/src/db.test.ts` continues to cover the ordered checksummed
  migration loader and migration-specific SQL contracts.
- The current Docker-backed migration and backup/restore reruns remain blocked
  by the unavailable Docker Desktop `dockerDesktopLinuxEngine` pipe; the last
  successful real proof remains historical through migration `0119`.

## Boundary and follow-up

The guard does not apply migrations, repair a database, activate a source, or
claim hosted persistence. Restore Docker Desktop and rerun the fresh/upgrade,
backup/restore, local-stack, and hosted deployment evidence against migration
`0123` before promoting the service.

The user-owned root `AGENTS.md` was not edited or staged; the generated-agent
sync remains intentionally skipped for that reason.
