# Workspace archival completion report — 2026-08-02

## Outcome

The repository now has a complete non-destructive workspace archival slice.
An authenticated owner can archive an active private workspace after a recent
password step-up and an exact confirmation. Active durable work blocks the
transition with a bounded count; a completed transition is idempotent.

## Changed surfaces

- `packages/contracts`: strict confirmation and archived/blocked result union.
- `packages/db/migrations/0066_workspace_archival.sql`: `archived_at`, state
  invariant, owner-only security-definer function, active-work guard, campaign
  refresh cleanup, invitation revocation, identifier-only audit/outbox receipts,
  and least-privilege execute grant.
- `packages/db/src/auth-repository.ts` and `packages/db/src/auth.ts`: validated
  repository boundary and permission error mapping.
- `apps/web`: same-origin, step-up-protected `DELETE` route and owner settings
  control with explicit retained-lineage/purge messaging.
- Documentation, runbook, status, plan, and project memory updated.

## Proof

- Contracts: 80 tests passed.
- Database: 114 tests passed; strict typecheck and lint passed.
- Web: 110 tests passed; strict typecheck, lint, and route type generation
  passed.
- Migration loader now requires and checks migration `0066`.

Fresh PostgreSQL integration could not be rerun because this environment lacks
the Docker Desktop Linux engine pipe. No production database migration was
executed.

## Security and scope notes

The route requires same-origin access, an authenticated session, recent
reauthentication, and owner authorization. The database function repeats the
owner check under `SECURITY DEFINER`, locks the workspace, and grants only
function execution to `appsea_service`. Imported content cannot influence the
transition. Archival retains research lineage and does not claim workspace,
object-store, export, or backup purge; those remain separately reviewed
deployment work.

## Remaining blockers

Production identity/MFA/OIDC and delivery approval, legal/privacy/security
approval for a live source, role-separated PostgreSQL/Temporal deployment,
cloud object/backup/export purge, scheduler/alert routing, and signed desktop
release remain outside this slice.
