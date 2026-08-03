# Workspace purge manifest completion report

Status: repository slice implemented; external retention operation remains open.

## What changed

- Added contract schemas for the exact owner confirmation, deterministic
  manifest ID, workspace-bound object URI/kind entries, bounded count, expiry,
  SHA-256 content hash, and fixed external requirements.
- Added migration `0083_workspace_purge_manifests.sql` with forced RLS,
  direct-table revocation, validation triggers, owner/archived checks,
  idempotent security-definer create/read functions, and identifier-only
  audit/outbox receipts.
- Added corrective migration `0084_workspace_archival_function_qualification.sql`
  after PostgreSQL 18 exposed an ambiguous `workspace_id` output-column
  reference in the pre-existing archival function.
- Added corrective migration `0085_workspace_purge_manifest_read_only.sql`
  after the private read repository exposed a row-locking membership check in
  a read-only transaction.
- Added repository methods that collect and deduplicate persisted source,
  report, plan, and production-analysis object references without reading
  object bodies or provider credentials.
- Added private GET/POST API routes and owner members-page controls. The POST
  route requires same-origin access, authentication, recent password and MFA
  step-up, and the exact phrase `PREPARE WORKSPACE PURGE MANIFEST`.
- Added contract, repository, web-route, and PostgreSQL integration coverage.

## Validation

- `pnpm --filter @appsea/contracts test` — 94 tests passed.
- `pnpm --filter @appsea/db test` — 138 tests passed.
- `pnpm --filter @appsea/web test` — 147 tests passed.
- Affected package typechecks and lints passed.
- Focused suites and affected typechecks/lints passed locally. Fresh CI exposed
  and the repository fixed the PostgreSQL 18 archival ambiguity (`0084`), the
  forced-RLS cleanup context, and the read-only membership lock (`0085`).
  GitHub Actions run `30800490289` passed verify/build, fresh PostgreSQL
  persistence, and fresh Temporal workflow checks for commit `a20bb1d`.
  Docker-backed integration remains unavailable locally.

## Deliberate simplifications and remaining blockers

- The manifest is metadata-only and expires after 24 hours. Replays return the
  existing deterministic record; no renewal or destructive deletion workflow
  is included.
- Provider object-store deletion, export-retention deletion, backup
  verification, credential deployment, scheduled consumption, and final
  workspace purge still require separately reviewed deployment controls.
- No source was activated, and no fixture content was presented as live market
  research.
