# Research campaign history pagination completion report — 2026-08-03

## Outcome

Private one-source and multi-source campaign history now supports bounded,
stable cursor pagination. The public leaderboard remains unchanged and still
contains only the sparse ranked list.

## Implementation

- `packages/contracts` defines the strict cursor, query, and page envelopes.
  Cursors contain only version, request timestamp, and a stable identifier.
- Both PostgreSQL repositories expose page methods with a 1–100 limit (25 by
  default), workspace-authenticated reads, deterministic request-time/
  identifier ordering, and `nextCursor` metadata. Existing array methods remain
  for compatibility.
- Migration `0072` adds matching `(workspace, campaign, requested_at,
identifier)` indexes for both history tables so older-page scans remain
  bounded as run volume grows.
- Both private history APIs validate query keys, duplicate parameters, limits,
  and cursor shape before reading the repository.
- The campaign page renders a bounded first page and links to a dedicated
  private history route. The route paginates one-source and multi-source
  histories independently while preserving the other cursor.
- The deterministic UI reference source now includes the private campaign
  history screen for desktop and mobile. SVG references were regenerated;
  raster export remains unavailable because `cairosvg` is not installed.
- History rows continue to exclude idempotency hashes, input hashes, actor
  details, policy-review hashes, raw source payloads, and imported instructions.

## Validation

- `pnpm --filter @appsea/contracts typecheck` — passed.
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- `pnpm --filter @appsea/contracts test` — 87 passed.
- `pnpm --filter @appsea/db test` — 128 passed.
- `pnpm --filter @appsea/web test` — 135 passed.
- Cursor round-trip, malformed cursor, page boundary, API query, and private
  workspace authorization tests are included.

## Remaining gates

This tranche does not activate a source, provision PostgreSQL/Temporal, or
claim production deployment. External source approvals, identity/provider
controls, cloud object/backup retention, deployed scheduler/Temporal proof,
and signed desktop releases remain open in the current production-readiness
audit.
