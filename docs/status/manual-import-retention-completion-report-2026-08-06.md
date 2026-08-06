# Manual import retention cleanup — 2026-08-06

Status: repository tranche complete; hosted scheduler and provider operation remain external.

Migration `0113` adds a fenced security-definer cleanup for expired
`manual-owner-import` batches. The cutoff is derived from the immutable policy
row captured by each batch, so a later policy change cannot shorten or extend
historical retention unexpectedly. The bounded function:

- requires the `appsea-source-maintenance-v1` server-clock lease assertion and
  a workspace transaction context;
- clears normalized staged payloads, marks staged or consumed batches deleted,
  and records `research.manual_import.retention_expired` with a fixed system
  actor;
- queues tombstones for exact manual source items linked to the batch's
  completed run snapshot, without parsing ambiguous batch-ID prefixes; and
- is idempotent under `FOR UPDATE SKIP LOCKED`, unique tombstone identity, and
  the existing deletion propagation worker.

The worker exposes `manualImportBatchesPurged` in the bounded result, scheduler
metrics, and secret-free maintenance events. Owner-requested deletion remains
available and now reports retention tombstones on replay.

Validation evidence:

- `pnpm --filter @appsea/db test` — 182 unit tests;
- `pnpm --filter @appsea/worker test` — 142 tests;
- `pnpm verify:persistence:fresh` — fresh PostgreSQL 18 install and 55
  integration tests through migration `0113`, including the real maintenance
  lease/fence and payload/audit assertions;
- `pnpm verify:backup-restore` — 113-migration dump/restore and forced-RLS/
  least-privilege checks;
- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` — passed after the
  tranche formatting checkpoint.

This does not activate CFPB, Stack Exchange, or another third-party source;
owner imports remain tenant-private evidence and do not establish public
market coverage. Provider PostgreSQL, Temporal, scheduler ownership, backup,
and incident-recovery evidence remain open.
