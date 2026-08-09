# Report and plan history tranche

## Scope

This tranche closes the private artifact-history and export-format gap without
changing the sparse public leaderboard. It covers report/plan version metadata,
selected reads, deterministic plan comparison, and approved Markdown exports.

## Implementation evidence

- `packages/contracts` adds bounded report/plan summaries, opaque cursor/page
  validation, a compatibility `truncated` marker, export-format validation,
  and plan file-change metadata.
- `packages/db/src/auth-repository.ts` reads up to 51 rows per artifact family
  to expose cursor-paginated 50-row pages, filters deleted/non-collectible analysis rows, keeps
  withdrawn rows metadata-only, hydrates selected versions through the existing
  object-store and redaction boundary, and writes representation-aware export
  audit receipts.
- `packages/reports` renders reports and the six-file plan package as
  deterministic, inert Markdown and compares plans using sorted paths,
  SHA-256, and UTF-8 byte counts.
- Web routes add history, selected reads, plan comparison, and strict
  `format=json|markdown` negotiation. Markdown is on-demand and returns
  `X-AppSea-Manifest-Hash`; no new durable Markdown reference is written.
- Private Report and Plan pages add bounded version selectors, approved JSON /
  Markdown links, and a calm plan file-change table. The leaderboard remains
  unchanged.
- `design/references/source/artifact-approval.svg` and its mobile counterpart
  were updated before the UI implementation to include the version-history and
  format controls.

## Security and retention decisions

History and selected reads preserve workspace membership, current source-policy
collectibility, deletion state, object hydration, and field-level redaction.
Withdrawn content cannot be selected or exported. Markdown is not persisted in
this slice because the current analysis purge queue and source-deletion path do
not yet provide complete `report-markdown` tombstoning and backup proof. A ZIP
transport and MCP history resources are also intentionally deferred.

## Validation

The original history/export tranche passed its repository checks before this
cursor follow-up. Its evidence is retained in the preceding commit and the
original validation record. Current follow-up evidence is:

- `pnpm --filter @appsea/contracts test` — 118 tests passed.
- `pnpm --filter @appsea/reports test` — 13 tests passed.
- `pnpm --filter @appsea/db test -- src/auth-repository.test.ts` plus cursor
  tests — 31 focused tests passed; the full database source suite also passed
  (189 tests).
- `pnpm --filter @appsea/web test` — 233 web tests passed.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` — all 15 packages passed;
  the Next.js production build compiled and generated all routes.
- `pnpm format:check`, `pnpm docs:check`, and `git diff --check` passed. The
  full `pnpm repo:check` also passed before the final wording-only update to
  this report.
- `pnpm security:audit` — passed after the workspace-level `nanoid@3.3.17`
  override removed the high transitive PostCSS finding.
- `pnpm ui:capture` — 24 public route/viewport captures passed with no runtime
  errors, missing `<main>`, or horizontal overflow. Desktop captures use the
  desktop viewports; the mobile capture is a separate responsive check.
- `pnpm ui:references` — 34 reference sources rendered; PNG export was skipped
  because the optional `cairosvg` package is not installed.

`pnpm ui:capture:private` could not start its authenticated PostgreSQL/Temporal
stack because Docker Desktop's `dockerDesktopLinuxEngine` pipe is unavailable
on this machine. This is an environment blocker for private screenshot proof,
not a browser-debugging result; the private route and repository behavior are
covered by the authenticated route tests above.

## Follow-up cursor tranche

The 2026-08-09 follow-up adds independently advancing, workspace/opportunity/
family-bound `reportCursor` and `planCursor` values to the private history API.
The report and plan pages link to older pages, and selected-version reads now
resolve an id directly so versions beyond the first page remain reachable.

Cursor follow-up validation: `pnpm --filter @appsea/db typecheck` and `lint`,
`pnpm --filter @appsea/web typecheck`, the focused DB cursor/auth tests (31
passed), and the web suite (233 passed) are green. The Temporal package test
budget is now 120 seconds for both tests and hooks because workflow bundle
startup can exceed 30 seconds under monorepo contention; the isolated workflow
suite (31 passed) and the full repository `pnpm test` (15 packages passed) are
now green. `pnpm format:check`, `pnpm agents:sync`, and
`pnpm repo:check --docs-only` are green. The PostgreSQL integration suite is
still not runnable in this shell because the required disposable test database
environment variables are absent.

## Remaining gaps

- MCP history resources, ZIP/download-directory packaging, and durable
  `report-markdown` object publication remain deferred until deletion,
  retention, and backup purge proof covers that object kind.
- Provider-side export retention, deletion, backup purge, and hosted deployment
  evidence remain external release gates.
- No third-party public complaint connector is active; fixture and owner-import
  data remain explicitly non-public market research.
