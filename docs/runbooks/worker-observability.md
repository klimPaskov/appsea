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

Migration `0046` adds a server-clock scheduler lease shared by source
maintenance, auth retention, password-recovery delivery, and workspace-
invitation delivery. Only the standalone `appsea_maintenance` role may call
the four allowlisted lease functions; workers receive that role through
`APPSEA_MAINTENANCE_DATABASE_URL`, separate from `DATABASE_URL`. Production
requires a stable, unique `APPSEA_SCHEDULER_OWNER_ID`; development/test runs
generate an ephemeral owner. Each acquisition has a unique token, renews
during a pass, rejects concurrent owners (including same-owner retries),
permits takeover after expiry, and releases only when owner and token match.
This is a repository-level duplicate-run guard, not a fencing token for a
long-running database mutation or external delivery; deployment still owns
scheduler availability, durable metric retention, and alert routing.

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
worker replacement drill. A production scheduler, durable maintenance
checkpoint/ledger if cross-run accounting is required, and alert ownership are
still deployment responsibilities.
