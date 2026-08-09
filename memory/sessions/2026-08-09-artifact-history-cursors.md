# Artifact history cursor tranche — 2026-08-09

## Completed

- Added strict `workspaceArtifactHistoryCursorSchema` and bounded page query
  (`limit` 1..50 plus independent report/plan cursors) in
  `packages/contracts/src/index.ts`.
- Added workspace/opportunity/family-bound base64url cursor encode/decode helpers
  in `packages/db/src/workspace-artifact-history-pagination.ts`.
- Changed `PostgresAuthRepository.listWorkspaceArtifactHistoryForUser` to use
  stable `(generated_at DESC, id ASC)` cursor predicates and limit+1 next-page
  detection. Added direct summary reads so older plan comparisons remain
  available beyond the first page.
- Updated the private history API and Report/Plan pages with strict query
  handling and older-page links. Selected report/plan IDs now resolve directly
  through the existing membership, policy, deletion, hydration, redaction, and
  approval gates.
- Added contract, cursor, repository, route, and PostgreSQL integration tests;
  updated product/spec/runbook/status/memory documentation.

## Validation

- `pnpm --filter @appsea/contracts test` — 118 passed.
- `pnpm --filter @appsea/db typecheck` and `lint` — passed.
- Focused DB cursor/auth tests — 31 passed.
- `pnpm --filter @appsea/web typecheck` and private history route suite — passed
  (route suite currently 233 total web tests).
- `pnpm agents:sync` and `pnpm repo:check --docs-only` — passed.
- `packages/workflows/package.json` now gives Temporal workflow tests and hooks
  a 120-second budget; the isolated workflow suite (31 tests) and full
  repository `pnpm test` pass under monorepo contention.

## Remaining environment blocker

`pnpm --filter @appsea/db test:integration` could not start because
`APPSEA_TEST_DATABASE_URL` (and the required disposable PostgreSQL test
environment) is not configured in this shell. The integration test is checked
by TypeScript/lint but requires the approved local PostgreSQL stack to execute.

## Follow-up

Run the PostgreSQL integration suite in a configured disposable stack before
claiming operational deployment proof. ZIP packaging and durable
`report-markdown` publication remain intentionally deferred until the
corresponding deletion/retention/backup purge proof exists; MCP now exposes
scope-filtered metadata history plus addressed approved selected-version
resources with the same cursor contract.
