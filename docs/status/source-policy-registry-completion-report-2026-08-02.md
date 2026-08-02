# Source-policy registry completion report

Date: 2026-08-02

## Outcome

AppSea now has a private, read-only source-coverage surface for workspace
members. It makes policy readiness, production collectibility, quotas,
retention/deletion duties, and coverage notes inspectable without adding a
source-activation path or presenting fixture evidence as market research.

## Changed

- Added the strict `workspaceSourceReadModel` contract in
  `packages/contracts/src/index.ts`.
- Added `PostgresSourcePolicyRepository.listForUser`, an authenticated
  read-only projection over existing source/policy rows. The query derives
  `enabled` and `collectible` from lifecycle, current approved policy, expiry,
  and independent approval evidence. No migration was required.
- Added private `GET /api/workspaces/:workspaceId/sources` and the
  `/workspace/:workspaceId/sources` page, linked from the workspace home.
- Added contract, repository, and route tests, plus responsive source-coverage
  design references and route documentation.
- Updated product, architecture, plan, status, known-gap, and project-memory
  records. No new skill was created; existing source-connector, database,
  security, UI-reference, and vertical-slice skills remain the reusable
  workflows.

## Security and policy boundary

The route requires an authenticated member of a private workspace and returns
private no-store responses. The read model excludes policy payloads, content
hashes, reviewer identities, policy-owner details, and activation controls.
Malformed or hash-mismatched persisted policy payloads fail closed. Fixture
sources are labeled synthetic and never marked production-collectible.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (71 tests).
- `pnpm --filter @appsea/db test` — passed (97 tests).
- `pnpm --filter @appsea/web test` — passed (96 tests).
- Package lint/typecheck checks — passed for contracts, db, and web.
- `pnpm ui:references` — passed; 22 SVG references generated. PNG export was
  skipped because `cairosvg` is unavailable.
- `pnpm memory:check`, `pnpm agents:sync`, `pnpm repo:check --docs-only`, and
  `pnpm format:check` — passed.
- `pnpm verify` — passed; all 56 Turbo tasks, fixture/plan/analysis samples,
  web smoke, and repository validation passed.
- `pnpm verify:persistence` — blocked because Docker Desktop's Linux engine
  pipe (`//./pipe/dockerDesktopLinuxEngine`) is unavailable in this
  environment; no PostgreSQL integration claim is made.

## Remaining gaps and simplifications

- The source registry is read-only; source activation still requires reviewed
  operator/legal/privacy/security action outside the web surface.
- No migration was added because the projection uses existing source and policy
  tables; PostgreSQL integration proof remains dependent on Docker availability.
- Browser capture was not available in this environment; deterministic SVG
  references were generated, while PNG export remains dependent on `cairosvg`.
