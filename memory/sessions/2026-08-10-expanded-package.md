# Expanded coding-agent package — 2026-08-10

## Checkpoint

- Added `packages/reports/src/expanded-plan-package.ts`, a deterministic
  08_spec-compatible path set (README, manifest, evidence, research, product,
  delivery, and machine sections) built only from validated, redacted plan and
  optional approved report read models.
- Plan ZIP exports retain the existing six compatibility files and now add the
  expanded directory under `package/`. The nested manifest hashes each payload
  file and carries source/coverage metadata; the manifest is the envelope and
  is intentionally excluded from its own hash list to avoid recursive hashes.
- Missing linked reports, unavailable source dimensions, fixture/test-only
  inputs, restricted excerpts, and competitive coverage gaps remain visible as
  explicit gaps. CSV values are quoted and spreadsheet-dangerous prefixes are
  neutralized. Imported content is serialized as inert data and cannot modify
  code, skills, instructions, permissions, or memory.
- Plan JSON, Markdown, and ZIP exports now fail closed when a linked report is
  present but is not approved, deleted, stale, non-collectible, or cannot be
  hydrated. The linked-report approval gate is covered in DB and web route
  tests.

## Proof

- `@appsea/reports`: 19 tests, typecheck, and lint pass, including deterministic
  path/hash replay and plan-only hostile-data coverage.
- `@appsea/db`: 195 tests and typecheck pass.
- `@appsea/web`: 245 tests and typecheck pass.
- Full repository tests (15 packages), typecheck, lint, format, production build,
  release verifier, smoke, security audit, and 22-route public UI capture pass.
  Fresh PostgreSQL/private-stack capture is still Docker-blocked.

## Remaining boundaries

- ZIPs are on-demand; the expanded directory is not a separately persisted
  plan object. Persisted report Markdown remains governed by migrations
  `0120`/`0121` and its existing purge lineage.
- Provider-side object/download/backup purge, hosted identity, deployment,
  Temporal, and fresh database proof remain external blockers.
- Root `AGENTS.md` remains an empty, user-owned worktree change and must not be
  staged or overwritten.
