# Reviewed production-analysis launch completion report

Date: 2026-08-02

## Outcome

The private collection surface now has a complete reviewed handoff into the
existing `production-analysis-v2` workflow. Owner/editor members can choose an
approved workspace seed, start analysis from a completed collection, and follow
a private status page without exposing workflow hashes, object references,
source payloads, or seed content.

## Changed surfaces

- `packages/contracts` defines strict analysis states, fixed failure codes, and
  the safe status projection.
- `packages/db` projects authenticated production-analysis status from
  PostgreSQL and joins only the opportunity slug needed for navigation.
- `apps/web` validates workspace-bound workflow identifiers, adds the private
  status API/page, and adds the approved-seed start action to collection
  inspection.
- The reference renderer and `design/README.md` include desktop/mobile
  analysis-status references.
- Product, architecture, plan, status, memory, and decision records document
  the handoff and its remaining telemetry limitation.

## Validation

- `pnpm --filter @appsea/contracts test` — 70 tests passed.
- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/db test` — 95 tests passed.
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/web test` — 93 tests passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- `pnpm --filter @appsea/web lint` — passed.
- `pnpm verify` — 56 workspace tasks passed, including lint, typecheck, tests,
  builds, fixture/plan/analysis samples, smoke web, and repository checks.
- `pnpm ui:references` — 20 SVG references generated; PNG export was skipped
  because the local `cairosvg` dependency is unavailable.

`pnpm verify:persistence` remains blocked in this environment because Docker
Desktop's Linux engine pipe is unavailable (`//./pipe/dockerDesktopLinuxEngine`).

## Deliberate limits

This slice keeps analysis start manual and approved-seed-only. The existing
production-analysis run table does not persist activity-attempt history, so a
PostgreSQL fallback reports zero attempts for queued/running rows. Automatic
analysis scheduling, production Temporal provisioning, source activation, and
live market claims remain outside this tranche.
