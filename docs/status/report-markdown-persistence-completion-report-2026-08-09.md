# Report Markdown persistence completion report — 2026-08-09

## Outcome

Production analysis now stores one deterministic, content-addressed
`report-markdown` object alongside the structured JSON report and plan package.
The persisted reference is workspace-bound and retained on both the report
version and analysis-run lineage rows. The web export remains an approved,
redacted on-demand rendering boundary; it does not expose object URIs or skip
governance.

## Implementation evidence

- `packages/reports/src/markdown.ts` encodes and stores the validated renderer
  output as `text/markdown; charset=utf-8` with the existing object-store seam.
- `packages/db/migrations/0120_report_markdown_object_persistence.sql` adds the
  full report reference, validates workspace/kind/URI binding, extends the
  invalidated-analysis purge queue to the Markdown kind, and replaces the
  report deletion guard so both URI and full metadata are cleared safely.
- `packages/db/migrations/0121_workspace_purge_markdown_reference.sql` keeps the
  direct owner-confirmed purge gate aligned with the complete analysis output
  set, including `report_markdown_object_ref`.
- `packages/db/src/production-analysis-repository.ts` writes the Markdown object
  during production analysis, persists both references, and verifies the
  reference during idempotent replay when present.
- `packages/db/src/deletion-propagation-repository.ts` clears the report-side
  Markdown references only after the invalidation queue has captured them.
- `packages/db/integration/db.integration.test.ts` covers four-output purge
  queueing, including `report-markdown`, and proves the real purge manifest and
  owner purge gate remain blocked while that reference is retained; reports
  tests cover deterministic bytes, content type, and object-store readback.

## Security and retention boundary

Imported content remains inert JSON/Markdown data. The existing approval,
current-policy, deletion, redaction, and object-hydration gates remain the
private read/export authority. Existing rows may have a null full Markdown
reference and remain readable; no legacy payload is rewritten. ZIP packaging,
provider-side export/backup deletion, encrypted cloud lifecycle, and live
deployment operations remain outside this repository tranche.

## Validation

- `pnpm --filter @appsea/reports typecheck`, lint, and tests — passed (14 tests).
- `pnpm --filter @appsea/db typecheck`, lint, and tests — passed (189 tests).
- PostgreSQL integration/fresh-upgrade proof still requires the disposable local
  stack; Docker is unavailable in the current environment. The real PostgreSQL
  integration fixture includes the purge-gate assertion and remains unrun until
  Docker Desktop is available.
