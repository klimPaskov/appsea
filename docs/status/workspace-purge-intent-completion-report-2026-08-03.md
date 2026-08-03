# Workspace purge intent completion report

Date: 2026-08-03

Status: repository slice complete and locally validated. This is not a
production deletion claim.

## Outcome

The owner-only purge-readiness inventory now has a durable handoff boundary.
After a workspace is archived and the PostgreSQL-observable blockers reach
`database_ready`, a recently reauthenticated owner may record a
`workspace-purge:<digest>` request. The request snapshots the readiness
contract, remains `awaiting_external_controls`, and writes identifier-only
audit/outbox receipts. Repeating an active request is idempotent. The owner can
cancel it with a separate typed confirmation. Neither action deletes research,
objects, exports, or backups.

## Changed surfaces

- `packages/contracts`: strict request/cancellation/read-model contracts and
  readiness-snapshot invariants.
- `packages/db/migrations/0073_workspace_purge_intents.sql`: forced-RLS request
  ledger, owner security-definer request/cancel functions, active-request
  uniqueness, and audit/outbox receipts.
- `packages/db/src/auth-repository.ts`: owner authorization, readiness-gated
  request/cancel/read methods and fixed permission/not-ready errors.
- `apps/web`: private `GET`/`POST`/`DELETE` purge-request route, route tests, and
  members-page controls behind the existing 15-minute password step-up.
- Documentation and memory: the purge runbook, private-workspace product
  contract, current/known-gap status, active plan, and project decision memory
  now describe the handoff and its external limits.

## Validation

- `pnpm --filter @appsea/contracts typecheck` and test: passed (88 tests).
- `pnpm --filter @appsea/db typecheck`, lint, and tests: passed (130 tests).
- `pnpm --filter @appsea/web typecheck`, lint, and focused route tests: passed
  (140 web tests in the focused run).
- `pnpm format:check`, `pnpm memory:check`, and `pnpm repo:check --docs-only`
  remain required before integration.
- Docker-backed PostgreSQL/Temporal execution remains environment-blocked by
  the unavailable Docker Desktop Linux engine.

## Remaining boundary

The request is intentionally not a deletion command. Provider-side encrypted
object storage, export retention, backup deletion verification, destructive
database/object deletion, incident receipts, production role provisioning, and
deployment drills still require separate reviewed controls.
