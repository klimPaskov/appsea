# Worker instructions

Read the root `AGENTS.md`, `appsea-worker-job` skill, and ADR 0007.

Worker entry points must be deterministic in fixture mode, idempotent for the same run id, explicit about output paths, and safe to rerun. Production jobs will need durable checkpoints, cancellation, retry limits, cost budgets, and structured failure records.

The durable fixture worker owns Temporal activity adapters and PostgreSQL job
projections. Keep workflow histories sanitized, map failures to fixed types, and
make persistence completion a non-cancellable safe point. The local Temporal
endpoint is loopback-only and development-only; production TLS, authorization,
retention, HA, backups, and deployment controls require a separate reviewed
configuration. Emit only the bounded, secret-free events defined by
`src/observability.ts`; never add raw exception messages, source text, bearer
tokens, passwords, or database URLs to worker logs.

Scheduled maintenance and delivery entry points must acquire the migration
`0046` server-clock lease through `src/maintenance-scheduler.ts` using the
dedicated `APPSEA_MAINTENANCE_DATABASE_URL`/`appsea_maintenance` connection.
Production requires a unique `APPSEA_SCHEDULER_OWNER_ID`; each acquisition has
a fresh token, a contended lease must skip work, guarded mutations should call
`assertLease`, and selected service transactions must also carry the private
`MaintenanceSchedulerFence` so migration `0052` can hold the lease row lock
through commit. Never log or persist the fence token. External provider sends,
source HTTP requests, and object-store deletion remain outside this database
fence and require idempotency/recovery controls. Renewal/release failures must
use fixed event codes.
Scheduler outcome telemetry must use the migration `0047` maintenance-role
functions through the repository; persist only generated run IDs, fixed states
or failure codes, durations, and bounded numeric counters. Never persist lease
tokens, source content, credentials, database URLs, or raw exception messages.

Use `workflow:analysis:history:check` before changing production Temporal worker
versions. It may inspect visibility metadata only, must not fetch or print
arbitrary workflow memos/history, and must fail closed for unresolved or
truncated legacy executions. Temporal archive/deletion remains an explicitly
approved deployment operation.

The long-lived Temporal worker must keep SIGINT/SIGTERM handling idempotent:
request worker shutdown, stop heartbeat and dispatch loops, await their drain,
then close database and Temporal connections. Do not add a signal path that
logs raw errors, skips the worker safe point, or exits before cleanup.
