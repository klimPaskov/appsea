# Deterministic export bundles — 2026-08-10

## Checkpoint

- Added the repository-owned `appsea-export-bundle-v1` ZIP representation for
  approved report exports and ready-plus-approved plan exports.
- The bundle is generated on demand from the same hydrated, policy-filtered,
  redacted read models as JSON and Markdown. It contains a README, validated
  `manifest.json`, JSON, Markdown, and (for plans) the six supported files under
  `plan/`.
- Imported evidence, report prose, and plan files remain inert file data; the
  bundle writer rejects absolute/parent paths, duplicate entries, oversize
  archives, and invalid manifest metadata. No raw object URI is included.
- ZIP audit receipts include representation `zip`; responses expose both the
  source manifest hash and deterministic archive hash. No ZIP object is persisted
  or added to deletion lineage.
- The review also closed a readiness boundary: all plan JSON, Markdown, and ZIP
  exports now fail closed unless the package is both `ready` and owner-approved;
  the route and repository tests cover the fixed 409 behavior.

## Proof

- Contracts, reports, DB, and web typecheck/tests/lint pass, including deterministic
  replay, hostile-content inertness, manifest validation, approval-gated DB
  helpers, and report/plan route header/body coverage.
- Public UI capture remains the verified reference loop. Private authenticated
  capture and fresh PostgreSQL execution remain pending because Docker/local
  private-stack infrastructure is unavailable in this environment.

## Simplifications and blockers

- This is a bounded ZIP v1, not the complete 08_spec directory package. The full
  evidence/research/product/machine layout remains a documented gap.
- Provider-consumed retention, download revocation, and destructive export/object/
  backup purge remain deployment-owned. Existing persisted `report-markdown`
  objects retain their separate deletion lineage.
- Root `AGENTS.md` is an empty, user-owned worktree change and remains unstaged.
