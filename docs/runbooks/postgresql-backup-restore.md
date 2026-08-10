# PostgreSQL backup and restore verification

This runbook verifies the repository's local PostgreSQL backup/restore shape in
an isolated disposable database. It does not provision, restore, or mutate a
production database and must never be pointed at a remote URL.

## Run the local drill

Prerequisites: Docker, Node.js 22 or later, and pnpm.

```bash
pnpm test:backup-restore
pnpm verify:backup-restore
```

The command:

1. starts only the loopback PostgreSQL service from
   `infra/local/compose.yaml`;
2. applies the checked-in migrations to the local `appsea` database through
   the dedicated migrator role;
3. creates a plain SQL dump in a temporary mode-600 directory;
4. restores it into the fixed isolated database
   `appsea_backup_restore_check`;
5. verifies the restored migration prefix, `appsea` schema, forced RLS on
   `appsea.workspaces`, denial of runtime reads from the operational-alert
   outbox, and maintenance execution of the alert-claim function; and
6. drops the isolated database with `FORCE` and removes the temporary dump in a
   `finally` block.

The local PostgreSQL container is left running for other development commands,
but the restored database and dump do not persist. The script refuses
`NODE_ENV=production` and does not accept a caller-selected database URL.

The verifier currently requires the restored migration history to end at
`0122`, the checked-in schema head. A previous successful drill through
`0119` remains historical evidence only; after schema changes, rerun the
Docker-backed command and record its fresh output before treating backup/restore
coverage as current.

## Production handoff

Production backups remain deployment-owned. Before a release, the owner must
choose an approved encrypted/versioned backup provider, define retention and
deletion duties, restrict restore credentials, record the migration/role
compatibility review, and run a restore/failover drill against an isolated
target. The local command is evidence for the repository's schema and role
shape only; it is not proof of provider encryption, HA, backup retention,
network isolation, or production recovery time.

Do not use a backup to bypass source-policy deletion, workspace-retention
approval, or evidence redaction. A restored copy is still sensitive research
data and must follow the same access, retention, and deletion controls.

## Completion evidence

The successful command prints the restored migration count and version plus the
RLS/privilege result. Record that output with the release evidence. A failure
must preserve the process logs, stop release promotion, and receive a reviewed
repair; do not weaken a grant or constraint to make the drill pass.
