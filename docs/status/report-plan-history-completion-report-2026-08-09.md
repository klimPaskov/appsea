# Report and plan history tranche

## Scope

This tranche closes the private artifact-history and export-format gap without
changing the sparse public leaderboard. It covers report/plan version metadata,
selected reads, deterministic plan comparison, and approved Markdown exports.

## Implementation evidence

- `packages/contracts` adds bounded report/plan summaries, a visible
  `truncated` marker, export-format validation, and plan file-change metadata.
- `packages/db/src/auth-repository.ts` reads up to 51 rows to expose a bounded
  50-row history, filters deleted/non-collectible analysis rows, keeps
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

The implementation and repository checks passed after the final
documentation/memory checkpoint:

- `pnpm --filter @appsea/contracts test` — 118 tests passed.
- `pnpm --filter @appsea/reports test` — 13 tests passed.
- `pnpm --filter @appsea/db test -- src/auth-repository.test.ts` — 186 tests
  passed across the database source suite.
- `pnpm --filter @appsea/web test -- src/app/workspace-report-routes.test.ts
  src/app/workspace-plan-routes.test.ts
  src/app/workspace-artifact-history-routes.test.ts` — 230 web tests passed.
- `pnpm verify` — formatting, lint, typecheck, tests, builds, fixture/plan/
  analysis samples, research-quality gate, web smoke, static release boundary,
  and repository validation passed.
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

## Remaining gaps

- History is visibly bounded rather than cursor-paginated; a later contract can
  add an opaque cursor without changing the summary shape.
- Provider-side export retention, deletion, backup purge, and hosted deployment
  evidence remain external release gates.
- No third-party public complaint connector is active; fixture and owner-import
  data remain explicitly non-public market research.
