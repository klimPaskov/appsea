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
  their bounded counters (including `productionWorkflowAdmissionsPurged` and
  `sourceCollectionLeasesPurged`) and
  job ID;
- missing `worker_started`/`worker_stopped` heartbeats for the task queue;
- database connection or migration failures from the process supervisor.

The source and authentication maintenance commands parse bounded contracts
before opening repository work. Their default job IDs use a UTC-minute bucket;
set `APPSEA_SOURCE_MAINTENANCE_JOB_ID` or `APPSEA_AUTH_MAINTENANCE_JOB_ID` to
reuse the same correlation ID when a scheduler retries a run. Source quota
expiry and settled-reservation purge each receive their own batch budget, so
one maintenance action cannot starve the other. The runners sort and dedupe
workspace IDs, cap deletion work, and return schema-validated counters. The
underlying PostgreSQL operations are idempotent, allowing a safe rerun after a
worker interruption without creating a second workflow queue.

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
