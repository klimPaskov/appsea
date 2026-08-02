# Worker observability and recovery

The AppSea worker emits one-line JSON events with `schemaVersion`, service,
task queue, timestamp, workflow/job ID, terminal state, bounded source-item,
cost, maintenance, and retention counters, and fixed failure codes. It never
logs workflow input, passwords, bearer tokens, complaint text, database URLs,
or arbitrary exception messages. Collect these events through the deployment's
log sink and alert on:

- `workflow_failed` or repeated `activity_failed` events;
- `workflow_finished`, `workflow_budget_rejected`, and auth-retention success or
  failure events to build completion and cleanup metrics;
- `workflow_budget_rejected` events grouped by `cost_budget_exceeded` and
  `source_item_budget_exceeded` failure codes;
- `source_maintenance_finished` and `auth_retention_finished` events grouped by
  their bounded counters (including `productionWorkflowAdmissionsPurged`,
  `sourceCollectionLeasesPurged`, and `productionAnalysisObjectsPurged`) and
  job ID;
- `maintenance_scheduler_lease_contended` events, plus fixed
  `APPSEA_MAINTENANCE_SCHEDULER_LEASE_LOST` or
  `APPSEA_MAINTENANCE_SCHEDULER_LEASE_RELEASE_FAILED` failures;
- `APPSEA_MAINTENANCE_SCHEDULER_METRICS_FAILED` events, which indicate that
  durable scheduler telemetry needs operator repair without implying that the
  underlying job failed;
- `maintenance_loop_started`, `maintenance_loop_pass_failed`, and
  `maintenance_loop_stopped` events. The loop's failure event carries only a
  consecutive-attempt counter and the fixed
  `APPSEA_MAINTENANCE_LOOP_PASS_FAILED` code; it never forwards child errors;
- `source_quota_reconciliation_failed` events and open-case age from the
  private reconciliation read model; these require an explicit maintenance-role
  decision and never justify an automatic re-fetch;
- `production_analysis_recompute_alert`,
  `production_analysis_recompute_alert_incomplete`, and
  `production_analysis_recompute_clear` events; alert on failed/blocked/stale
  counters, and never treat a truncated inspection as clear. The command is
  read-only and never dispatches or retries a repair;
- missing `worker_started`/`worker_stopped` heartbeats for the task queue;
- database connection or migration failures from the process supervisor.

After `worker_started`, the long-lived worker emits a `worker_heartbeat` event
every 30 seconds until shutdown. The event contains only the task queue and
the bounded event envelope. Alert when the expected heartbeat window is
missed; a heartbeat is a liveness signal, not proof that a particular workflow
or source job is making progress.

The source and authentication maintenance commands parse bounded contracts
before opening repository work. Their default job IDs use a UTC-minute bucket;
set `APPSEA_SOURCE_MAINTENANCE_JOB_ID` or `APPSEA_AUTH_MAINTENANCE_JOB_ID` to
reuse the same correlation ID when a scheduler retries a run. Source quota
expiry and settled-reservation purge each receive their own batch budget, so
one maintenance action cannot starve the other. The runners sort and dedupe
workspace IDs, cap deletion work, and return schema-validated counters. The
underlying PostgreSQL operations are idempotent, allowing a safe rerun after a
worker interruption without creating a second workflow queue. Object purge
claims are separately bounded and should alert when fixed retry attempts are
exhausted; the worker never logs object URIs or exception text.

The worker command `pnpm worker:production:analysis:recompute:alert` uses the
same lease-owned maintenance boundary for read-only inspection of deletion- or
correction-triggered repairs. It emits only bounded counters, age, alert state,
and truncation; deployment owns scheduling and incident routing.

The worker command `pnpm worker:workspace:cost:alert` uses the same boundary to
inspect exact micro-unit aggregates from the immutable cost ledger. Configure
one comparison currency and separate actual/estimated thresholds through
`APPSEA_COST_ALERT_*`. A non-target currency or truncated workspace scan keeps
the result `incomplete`; no currency conversion, billing assertion, admission
block, or automatic refund occurs. The command emits only bounded counts and
fixed alert/incomplete/clear events, never ledger identifiers or source data.

Migration `0046` adds a server-clock scheduler lease shared by source
maintenance, auth retention, password-recovery delivery, and workspace-
invitation delivery. Only the standalone `appsea_maintenance` role may call
the four allowlisted lease functions; workers receive that role through
`APPSEA_MAINTENANCE_DATABASE_URL`, separate from `DATABASE_URL`. Production
requires a stable, unique `APPSEA_SCHEDULER_OWNER_ID`; development/test runs
generate an ephemeral owner. Each acquisition has a unique token, renews
during a pass, rejects concurrent owners (including same-owner retries),
permits takeover after expiry, and releases only when owner and token match.
This is a repository-level duplicate-run guard. Migration `0052` adds a
server-clock transaction fence for selected SQL-only maintenance mutations;
external source requests, provider delivery, and object-store deletion remain
outside that atomic boundary. Deployment still owns scheduler availability and
alert routing. Migration `0047` adds durable,
secret-free outcomes through the same maintenance connection. Each acquired,
contended, or failed invocation records a generated run ID, owner, fixed state
and failure code, bounded duration, and numeric counters; lease tokens and raw
errors are never persisted. The record/list/purge functions are callable only
by `appsea_maintenance`. Each command purges rows older than
`APPSEA_MAINTENANCE_METRICS_RETENTION_DAYS` (default 30) up to
`APPSEA_MAINTENANCE_METRICS_PURGE_BATCH_SIZE` (default 1,000). A metrics write
failure emits the fixed `APPSEA_MAINTENANCE_SCHEDULER_METRICS_FAILED` event but
does not replace the underlying job result.

Temporal remains the source of truth for retry and replay. The worker uses
bounded activity retries and the PostgreSQL workflow checkpoint tables use
idempotent keys. A replacement worker must use the same namespace,
authenticated task queue, workflow bundle version, and database role. Operators
should inspect the workflow ID and checkpoint state before retrying a terminal
request; never replay a request with a new idempotency key to work around a
conflict.

The local fixture worker is intentionally not a production deployment.
Production still requires a TLS-protected Temporal endpoint, durable log/metric
retention, alert routing, secret redaction verification, and a documented
worker replacement drill. The private workspace cost summary provides bounded
cross-run ledger accounting; migration `0065` and the cost-alert command add
repository-level threshold inspection, but a production scheduler, alert
ownership, provider billing controls, external idempotency/recovery, and any
stronger maintenance checkpoint/fencing boundary remain deployment
responsibilities.
Settled source-quota cases are
inspectable at:

```text
GET /api/workspaces/:workspaceId/research/quota-reconciliation?limit=50
```

The worker command `pnpm worker:source:quota:reconcile` uses the standalone
`appsea_maintenance` role for bounded inspection or an explicit linked/voided
resolution. It records no source payload or caller key; deployment owns case
alert routing and operator identity provisioning.

Private workspace members can inspect bounded cross-run cost accounting at:

```text
GET /api/workspaces/:workspaceId/costs
```

The endpoint reads the immutable `cost_ledger_entries` table through an
authenticated read-only transaction and returns exact micro-unit totals by
currency and cost type. Optional `from` and `to` ISO timestamps are limited to
365 days; the default window is the previous 30 days. The response is
`private, no-store` and contains no source content, run identifiers, or raw
errors. This is operational accounting, not billing or payment processing;
deployment still owns alert routing, provider pricing, and retention/backup
controls.
