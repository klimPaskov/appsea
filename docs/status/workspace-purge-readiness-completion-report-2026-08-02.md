# Workspace purge-readiness completion report — 2026-08-02

Status: partial privacy/data-lifecycle slice complete; AppSea remains not
production-ready.

## Outcome

Owners can inspect a private, read-only workspace purge-readiness inventory
from the members page or
`GET /api/workspaces/:workspaceId/purge-readiness`. The database projection
reports archive state, bounded active-work count, and raw source, analysis,
report, and plan object-reference counts. It derives blockers deterministically
from those values and always keeps cloud object-store, export-retention, and
backup-deletion requirements visible.

The route does not queue, authorize, or perform destructive deletion. A
`database_ready` state is only a PostgreSQL-observable checkpoint and is not a
claim that exports, cloud objects, backups, or research lineage have been
purged.

## Changed surfaces

- `packages/contracts`: strict readiness/blocker/external-requirement contract
  with consistency validation.
- `packages/db`: owner-only, read-only metadata projection with workspace RLS
  context and active-work/object-reference counts.
- `apps/web`: private API route and members-page inventory with explicit
  non-destructive copy.
- `docs/runbooks/workspace-purge-readiness.md`: reviewed retention sequence and
  operational interpretation.
- `docs/status/known-gaps.md`, `docs/status/current.md`, the active plan, and
  `memory/ACTIVE.md`: aligned scope and remaining provider/deletion gates.

## Validation

- `pnpm --filter @appsea/contracts test` — passed (82 tests).
- `pnpm --filter @appsea/db test` — passed (118 tests).
- `pnpm --filter @appsea/web test` — passed (115 tests).
- `pnpm --filter @appsea/db typecheck` — passed.
- `pnpm --filter @appsea/web typecheck` — passed.
- `pnpm format:check` — passed after formatting the five touched TypeScript
  files.

The repository-wide verification and Docker-backed persistence/workflow gates
remain required before an overall production claim. Docker is not available
on this host for the fresh PostgreSQL/Temporal gates.

## Deliberate simplifications and blockers

- No destructive workspace purge, export purge, object-store deletion, backup
  deletion, or provider-side conditional-delete verification was added.
- The inventory counts database references but does not enumerate object URIs
  or expose source/report/plan content.
- Production identity, legal/privacy/security source approval, cloud
  provisioning, scheduler ownership, and signed desktop release remain open.
