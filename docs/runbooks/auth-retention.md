# Authentication retention and abuse controls

Authentication attempts are throttled in PostgreSQL rather than in process
memory. The web login and signup routes hash email/client markers before they
write a 15-minute bucket through `PostgresAuthRepository.consumeAuthRateLimit`.
The table contains no email, IP address, password, or bearer token. Recovery
requests use the separate security-definer reset/outbox boundary described in
[`auth-recovery.md`](auth-recovery.md); invitation delivery uses the analogous
`0025` boundary described in [`workspace-invitations.md`](workspace-invitations.md).
Account closure uses the `0026` security-definer boundary described in
[`account-closure.md`](account-closure.md); its session/reset revocation is
transactional and does not rely on this scheduled cleanup.
The runtime role cannot read reset/invitation delivery rows or update password
hashes directly.

Run the bounded cleanup command from a scheduler or the worker deployment:

```text
pnpm --filter @appsea/worker auth:retention
```

`APPSEA_AUTH_RETENTION_DAYS` defaults to 7 and
`APPSEA_AUTH_RETENTION_BATCH_SIZE` defaults to 1000. The command deletes only
expired or revoked sessions older than the retention window, expired/consumed
reset material, and stale rate-limit buckets. `authRetentionInputSchema` bounds
those values, and the
`runAuthRetention` runner returns a validated result with the scheduler job ID
and deletion counters, including `workspaceInvitationsDeleted`. Set `APPSEA_AUTH_MAINTENANCE_JOB_ID` when a scheduler
retry must keep the same correlation ID; otherwise the command uses a
UTC-minute bucket. It emits secret-free `auth_retention_finished` or
`auth_retention_failed` events and should be retried by the supervisor on
failure. Migration `0046` protects the pass with the
`appsea-auth-maintenance-v1` server-clock lease. The lease uses the dedicated
`appsea_maintenance` connection from `APPSEA_MAINTENANCE_DATABASE_URL` and a
per-acquisition token; the data work continues through `DATABASE_URL`. Set a
unique `APPSEA_SCHEDULER_OWNER_ID` in production and optionally bound the lease with
`APPSEA_MAINTENANCE_LEASE_SECONDS` (30-3,600, default 900); a contended run
emits `maintenance_scheduler_lease_contended` without touching retention rows.

Source quota reservations and tombstone propagation share the source
maintenance command:

```text
pnpm --filter @appsea/worker source:maintenance
```

The command enumerates active workspaces through the owner-scoped
`appsea.list_active_workspaces_for_maintenance()` function and expires bounded,
abandoned PostgreSQL quota reservations, purging settled reservation metadata
after the retention window. It claims and propagates deletion tombstones with skip-locked
transactions and reclaims stale processing leases. Set
`APPSEA_DELETION_WORKSPACE_ID` only when a single-workspace run is required.
`APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE` defaults to 1000,
`APPSEA_SOURCE_QUOTA_RETENTION_DAYS` defaults to 30, and
`APPSEA_DELETION_BATCH_SIZE` defaults to 100. It emits only secret-free
completion/failure events. `sourceMaintenanceInputSchema` and the pure
`runSourceMaintenance` runner bound the work and keep expiry and purge budgets
independent. Source quota windows are shared across workspaces; deployment
scheduling and alerting remain required before a live connector is enabled.
