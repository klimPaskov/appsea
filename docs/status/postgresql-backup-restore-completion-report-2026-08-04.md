# PostgreSQL backup/restore verification completion report

## Outcome

AppSea now has a checked-in, local-only PostgreSQL backup/restore drill. It
creates a disposable plain SQL dump from the loopback Compose database,
restores it into the fixed `appsea_backup_restore_check` database, verifies the
schema and least-privilege role boundary, and removes the restored database and
temporary dump even when verification fails.

This is repository recovery evidence, not a production deployment claim. It
does not contact a remote database, provision a provider, activate a source,
or establish production backup encryption, high availability, retention,
recovery time, or failover.

## Files and systems changed

- `scripts/run_db_backup_restore.mjs` — local-only orchestration, refusal
  guards, dump/restore cleanup, schema/privilege inspection, and redacted
  failures.
- `scripts/run_db_backup_restore.test.mjs` — refusal and verification-summary
  contract tests.
- `package.json` — `test:backup-restore` and `verify:backup-restore` commands.
- `.github/workflows/ci.yml` — persistence job coverage for the focused test and
  disposable restore drill.
- `docs/runbooks/postgresql-backup-restore.md` and
  `docs/runbooks/postgresql-local.md` — procedure, safety boundary, and
  production handoff.
- `memory/ACTIVE.md`, `memory/HOT.md`, `memory/PROJECT.md`, the active plan,
  current status, known gaps, and the production-readiness audit — repository
  state and external blockers aligned with the implementation.

## Validation

- `pnpm test:backup-restore` — passed, 4 tests.
- `pnpm verify:backup-restore` — passed: 95 migrations restored through
  `0095`; forced workspace RLS, runtime outbox denial, and maintenance alert
  claim privilege checks passed.
- `pnpm agents:sync`, `pnpm memory:check`, `pnpm repo:check --docs-only`,
  `pnpm format:check`, and `git diff --check` — required guidance and formatting
  checks passed before commit.

The repository-wide verification suite and the preceding PostgreSQL/Temporal
and worker-replacement proofs remain the supporting baseline. Hosted GitHub
Actions run `30919346892` for this commit remains externally blocked by the
account payment/spending-limit gate; every job failed before repository steps,
so it is not represented as a code failure.

## Security and policy review

The command accepts only the checked-in loopback Compose file and fixed local
database names. It refuses `NODE_ENV=production` and a caller-provided backup
database URL. Temporary dump permissions are mode `600`, command errors redact
the local password token, cleanup uses `DROP DATABASE ... WITH (FORCE)`, and the
restored copy is explicitly treated as sensitive research data. No imported
content, source policy, permission, instruction, skill, or repository memory
can influence the command.

## Simplifications and remaining blockers

- The dump format is plain SQL and the target is a disposable local database;
  provider-native encrypted/versioned backups and isolated restore credentials
  are not simulated.
- The script leaves the local PostgreSQL service running for developer reuse;
  only the temporary database and dump are removed.
- Production HA, backup retention/deletion, object-store purge, restore and
  failover drills, scheduler/incident ownership, provider provisioning, and
  source approvals remain open in `docs/status/known-gaps.md`.
- No visual asset was needed for this database/recovery tranche, so imagegen was
  not invoked. Existing interface assets remain unchanged; generated visuals
  are reserved for actual product visual work.
