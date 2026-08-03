# PostgreSQL persistence runbook

This runbook covers the repository's PostgreSQL 18 development and integration-test environment. It is not a production provisioning guide.

## Boundaries

- `appsea_owner` owns schema objects and cannot log in.
- `appsea_migrator` can log in and assume `appsea_owner` only for reviewed migrations.
- `appsea_service` is the non-owner runtime role. It cannot bypass row-level security, assume the owner role, change source policy rows directly, rewrite immutable history, or truncate tables.
- `appsea_maintenance` is a standalone, non-inheriting login role that may execute only the migration-owned scheduler lease, maintenance-run metrics, and operational-alert outbox functions. Migration `0082` adds forward-compatible v2 scheduler functions for the alert scans and drain without editing released migration history. It cannot read or mutate lease, metrics, or outbox rows directly and must not be reused by the web or research runtime. Migration `0052` grants the separate `appsea_service` role only the scheduler-fence assertion; the service role never receives lease-table access.
- Every private workspace transaction must use `withAuthenticatedWorkspaceTransaction`,
  which checks membership before setting `appsea.workspace_id`. The controlled
  fixture worker may use `withWorkspaceTransaction` only for its fixture-only path.
- Authentication uses `appsea.users`, `appsea.auth_sessions`, and the global
  `appsea.auth_mfa_*` tables from migration `0080`, plus the session-bound
  `last_mfa_reauthenticated_at` marker and runtime grant from migration `0081`,
  `appsea.workspace_memberships` (migration `0008`), durable auth rate limits,
  and session retention (migration `0010`). Migration `0021` adds only a
  short-lived `last_reauthenticated_at` marker for explicit owner-action
  step-up; migration `0022` adds role-checked report approval transitions and
  identifier-only audit/outbox receipts. Passwords and session
  bearer tokens are never stored directly; `withAuthenticatedWorkspaceTransaction`
  verifies membership before setting the workspace context. Auth tables are
  global lookup tables so a session can discover memberships before a workspace
  context exists. Membership rows use a narrow null-context RLS branch keyed to
  the authenticated-user transaction GUC only for this authorization lookup;
  once workspace context is set they are workspace-scoped.
- Source policies are global. Runtime fixture registration can activate only a new testing fixture source and cannot override operator or policy kill switches.

Production role creation, credentials, TLS, backups, high availability, and secret rotation remain deployment responsibilities. The local bootstrap passwords in `infra/local` are deliberately non-production.

## Start PostgreSQL

Prerequisites are Docker, Node.js 22 or later, and pnpm.

```bash
docker compose -f infra/local/compose.yaml up -d postgres
docker compose -f infra/local/compose.yaml ps
```

The container binds PostgreSQL only to `127.0.0.1:5433`. Its initialization script creates the `appsea` and disposable `appsea_test` databases plus the four local roles.

## Apply migrations

Load the local values from `.env.example` into the process environment, then run:

```bash
pnpm db:migrate
```

The migration command requires all of these values:

- `APPSEA_MIGRATION_DATABASE_URL` for the migrator login
- `APPSEA_DATABASE_MIGRATION_ROLE=appsea_owner`
- `APPSEA_DATABASE_SSL_MODE=disable` only for this loopback local environment

Migration history is an exact, checksummed prefix of `packages/db/migrations`. Never edit a migration after it has been applied outside a disposable database. Repair a released or shared migration with a new forward migration.

## Verify persistence

```bash
pnpm verify:persistence
```

This starts the local container if necessary and runs the guarded integration lifecycle against `appsea_test`. The suite verifies fresh migrations, a populated version-one upgrade, PostgreSQL version, role separation, grants, forced RLS, source and evidence policy gates, normalized provenance, immutable snapshots, replay and concurrency behavior, run lineage, current pointers, and migration-history rejection.

For a clean bootstrap check:

```bash
pnpm verify:persistence:fresh
```

`verify:persistence:fresh` is intentionally destructive: it removes the Compose project's local PostgreSQL named volume before recreating it. Do not run it when local development data must be retained. The fresh suite also exercises migration `0082` outbox idempotency, claim recovery, retry, completion, v2 alert scheduler names, migration `0083` archived-owner purge-manifest replay/read authorization, migration `0084` archival-function qualification, migration `0085` read-only manifest reads, migration `0086` MFA ciphertext-version defaults/status, and direct table-access denial.

The integration test itself will drop only the `appsea` schema and migration-history table inside the exact local `appsea_test` database. It requires loopback port `5433`, exact service, maintenance, and migrator usernames, the database marker comment, and `APPSEA_ALLOW_DESTRUCTIVE_DB_TESTS=yes`. Connection-string query parameters are rejected so they cannot redirect the destructive target.

## Exercise the application repository

After migrating the `appsea` database, set `DATABASE_URL` to the local `appsea_service` URL and
`APPSEA_MAINTENANCE_DATABASE_URL` to the local `appsea_maintenance` URL before running
maintenance commands:

```bash
pnpm worker:fixture:persist
pnpm worker:fixture:persist
```

The first run should report `replayed=false`; the second should report `replayed=true` with the same identifiers and counts.

## Failure handling

- A checksum or unknown-history error means migration files and applied history disagree. Do not rewrite the database history row; identify whether a forward repair is required.
- A `42501` error normally indicates RLS, a least-privilege grant, a source lifecycle kill switch, or the source/evidence policy gate correctly failed closed.
- A `23503` lineage error means a run, opportunity, score, plan, cluster, source item, or policy was cross-wired.
- If local role bootstrap changed, run the explicitly destructive fresh verification command.
- Preserve the failing database while diagnosing an unexpected integration failure. The verification script does not tear the container down after the suite.

## Completion proof

A persistence change is not complete until package lint/typecheck/tests pass, `pnpm verify:persistence:fresh` passes, the application fixture persists and replays, migrations and role grants are reviewed, and architecture/status/memory remain aligned.
