# Source maintenance

`@appsea/worker` owns the bounded maintenance command for source quota
reservations, policy-bound collection leases, due full-snapshot reconciliation,
policy-derived retention tombstones, and deletion propagation:

```text
pnpm --filter @appsea/worker source:maintenance
```

For a deployment-owned scheduler, run the supervised loop instead of wiring a
second implementation around the repositories:

```text
pnpm --filter @appsea/worker maintenance:loop
```

The loop starts one bounded `source:maintenance` child pass at a time. Each
pass still acquires the PostgreSQL server-clock lease, renews it through the
fenced work, and releases it before the next interval. A failed child pass is
recorded as a fixed `APPSEA_MAINTENANCE_LOOP_PASS_FAILED` event and retried
after the bounded failure backoff; the loop does not log the child error or
source content. `SIGTERM`/`SIGINT` abort the child, wait for shutdown, and
emit a stopped event. Run the loop under a process supervisor with restart and
alert policy; the loop is not a replacement for deployment ownership,
Temporal authorization, or operator response.

The command enumerates active workspaces through
`appsea.list_active_workspaces_for_maintenance()`, a narrowly granted
migration-owner security-definer function; it does not rely on a runtime
cross-workspace RLS bypass. It expires abandoned PostgreSQL quota reservations
through a workspace-scoped security-definer function. It queues retention
tombstones from each stored source policy's `retentionDays` and
`deletionRequired` fields, then processes
every workspace's deletion queue unless `APPSEA_DELETION_WORKSPACE_ID` is
supplied to narrow a run. Claims use `FOR UPDATE SKIP LOCKED` and reclaim
processing claims older than the lease. A failed propagation keeps fixed
failure metadata and is retried after a server-clock delay until the bounded
eight-attempt budget is exhausted; stale exhausted claims become terminal
failures. Propagation is idempotent, retains
tombstone identifiers, removes source-item raw references, replaces normalized
evidence/report/plan payloads with deletion markers, marks dependent versions
unavailable, and invalidates/de-ranks any mutable opportunity projection whose
completed production analysis used the deleted source record. The invalidation
clears current score and plan pointers while preserving immutable clusters,
score snapshots, and lineage. A later completed analysis from a new collection
run, or an explicit reviewed analysis over the remaining active evidence,
reactivates the projection only after the new active output is linked.

Before doing any work, the command acquires the global
`appsea-source-maintenance-v1` scheduler lease through migration `0046`. The
lease is callable only through the standalone least-privilege
`appsea_maintenance` database role and uses a per-acquisition token, PostgreSQL
server time, a unique `APPSEA_SCHEDULER_OWNER_ID`, and a bounded
`APPSEA_MAINTENANCE_LEASE_SECONDS` window. A contended invocation emits
`maintenance_scheduler_lease_contended` and exits without touching work; an
owned invocation renews periodically and releases only with the same owner and
token. An expired lease can be taken over by a replacement process, while a
stale process cannot release the replacement lease. Lease loss is a fixed
failure code and must alert the deployment operator. The lease connection is
separate from the `appsea_service` connection used for maintenance data work;
set `APPSEA_MAINTENANCE_DATABASE_URL` to the reviewed maintenance-role URL.
Migration `0052` passes the private scheduler identity into each selected
service transaction. PostgreSQL checks server time and holds the lease
row/advisory lock through commit, so a stale process cannot commit quota,
deletion, admission, source-lease, or object-purge state after takeover.
Snapshot reconciliation remains a separate checkpoint flow because its source
request and persistence work are not one atomic transaction.
Migrations `0037` and `0062` insert one durable recomputation job per
invalidated opportunity/tombstone or complaint correction when prior analysis
lineage provides a seed review. The durable worker claims due jobs with
`FOR UPDATE SKIP LOCKED`, reconstructs the remaining active evidence, and
starts the existing analysis workflow. A withdrawn seed is visible as `blocked`
and becomes dispatchable only after a new approval; a `dispatching` claim older
than 15 minutes is reclaimable from the PostgreSQL clock, and a stale claim at
the 24-attempt limit becomes a fixed terminal failure. The deterministic
workflow identity makes a late Temporal start an idempotent replay; no job
performs source acquisition.

Migration `0038` adds transient production workflow admission rows before a
user-triggered Temporal start. The admission function serializes each
workspace's five-start/15-minute and two-active-job limits, returns a replay
for an already admitted digest, and lets workflow initialization consume the
reservation. The bounded maintenance pass also purges consumed, released, or
expired admissions older than the retention cutoff; it never deletes workflow
jobs or research evidence. Migration `0112` lets the owner-import route release
only a fresh, actor-bound reservation when pre-workflow staging fails. It never
releases consumed or expired rows, so an uncertain Temporal start remains
covered by the existing TTL/purge path.

Migration `0042` adds a separate downstream-analysis admission ledger. The
private manual analysis route binds the session user and reserves only the
workflow digest/input hash before Temporal. The worker consumes the reservation
with analysis-run creation and releases it on terminal completion/failure;
consumed or released digests replay without another slot. The same maintenance
pass purges stale analysis admissions and reports their bounded count separately
as `productionAnalysisAdmissionsPurged`.

Migration `0039` adds digest-only source collection leases. Acquisition is
bound to the active source-policy review and stores one observed timestamp for
retry replay. The worker asserts the lease immediately before collection
persistence and releases it only after commit. The same bounded maintenance
pass purges released, expired, or revoked lease rows older than the retention
cutoff; it never deletes source evidence or policy history. An inactive lease
or quota settlement without a completed result remains an operator-
reconciliation case. Inspect and resolve quota cases through
[`source-quota-reconciliation.md`](source-quota-reconciliation.md); the
maintenance pass never refunds quota or re-fetches optimistically.

The maintenance pass now resumes at most one due full-snapshot job per sorted
workspace, up to `APPSEA_SOURCE_SNAPSHOT_RECONCILIATION_BATCH_SIZE`. The
reconciliation runner still owns policy, quota, lease, checkpoint, and retry
semantics; maintenance records only bounded state and coverage counters. This
keeps the repository-level scheduler idempotent while preventing one workspace
from consuming the whole pass. The targeted commands remain available for
operator recovery or a narrowly scoped run:

```text
pnpm --filter @appsea/worker source:cfpb:reconcile
pnpm --filter @appsea/worker source:cfpb:reconcile:next
```

Authenticated editors may request a CFPB reconciliation through the private
route below. The route hashes the caller key, checks workspace membership, and
applies the five-start/15-minute and one-active-job admission limits before the
durable job is inserted:

```text
POST /api/workspaces/:workspaceId/research/source-reconciliation
```

The direct command is reserved for a worker process. Its transaction sets the
explicit `appsea-worker` service principal, and migration `0045` rejects the
insert unless the workspace is active, private, and non-fixture. The command
hashes the caller idempotency key before enqueueing. The resume command claims
only due CFPB jobs and needs only the workspace ID. Page checkpoints store
source identifiers, hashes, and bounded warnings; tombstones are inserted
only after the worker observes a warning-free short page and the database
locks/asserts the source lease in the same transaction. A capped or malformed
traversal records a coverage gap and emits no deletion absence claim. Run the
maintenance command from a reviewed scheduler with bounded retries and
alerting; the direct resume command remains useful for targeted recovery.
Deployed scheduler ownership, service-role separation/secret rotation, and
legal/privacy/security activation remain release gates.

Migration `0058_campaign_refresh_scheduler.sql` adds the same bounded pass's
campaign refresh dispatch. For each active workspace it claims at most one due
non-fixture campaign, persists a deterministic production run/workflow
identity, binds the source-policy-derived request, and admits it through the
existing production workflow ledger before Temporal. A stale claim is
reclaimable. Policy denial or unsupported-source failures clear the pending
request; admission and Temporal failures retain it for a bounded retry. The
campaign page exposes the resulting state and failure summary. This path never
activates a source or treats a fixture as market evidence.

Migration `0068_research_campaign_orchestration.sql` adds a separate bounded
multi-source pass for campaigns configured with two to sixteen approved
non-fixture sources. The authenticated run route creates an idempotent parent
and durable source children. The same lease-backed maintenance process claims
one child at a time, clears stale dispatch leases, rechecks policy and source
connector support, consumes the service production-workflow admission, and
starts the existing one-source Temporal workflow with a deterministic child
run/idempotency identity. A child policy denial is terminal and visible; rate,
admission, and Temporal failures retry with a bounded attempt budget. The
reconciliation step reads `production_collection_workflow_jobs`, projects child
completion/failure counters to the parent, and updates the campaign aggregate
without letting one child incorrectly mark the whole campaign complete. Private
history/detail routes show only child identifiers, state, attempt count, policy
version, workflow identity, and fixed failure summaries. This queue is
production-shaped but not an activation mechanism: live source policy approval,
deployed scheduler/Temporal ownership, and crash/retry integration proof remain
required.

Migration `0070` adds the cancellation pass for this queue. An owner/editor
first persists an immutable cancellation intent through the private API. The
maintenance worker then terminalizes queued children, leaves a dispatching
claim owned until its external workflow identity is recorded, retries Temporal
cancel for started children, and reconciles the parent/campaign state. A failed
Temporal call leaves the request pending for the next leased pass; no new child
is dispatched after the intent is visible. The pass is bounded by the existing
`APPSEA_CAMPAIGN_ORCHESTRATION_BATCH_SIZE` and emits no source content or
caller secrets.

Migration `0071_production_collection_workflow_cancellation.sql` adds the
one-source retry pass. An owner/editor first commits an immutable intent from
the private workflow-status route. Source maintenance reads at most
`APPSEA_PRODUCTION_WORKFLOW_CANCELLATION_BATCH_SIZE` pending workflow IDs per
pass, asserts the scheduler lease before each target, and retries only the
Temporal cancel call. Provider failures leave the intent pending. The worker
does not mutate terminal state; the workflow's non-cancellable termination
activity persists `canceled` or reconciles `completed` if the collection
already crossed its persistence safe point. Logs contain bounded counters only.

The direct filtered collection command uses the same service-principal
boundary. Migration `0051` makes `pnpm worker:source:cfpb` reserve and consume
the shared production workflow admission ledger immediately before the CFPB
request. It shares the five-start/15-minute and two-active limits and refuses
to proceed for an existing workflow identity, a fixture/public/inactive
workspace, or an expired reservation. It does not authorize source activation;
the source-policy review and collection lease remain separate gates.

Retention policies using `redact` or `tombstone` reuse this path. Policy drafts
using `purge` remain rejected until the source/object/backups scope is reviewed;
the output-object queue below is intentionally narrower than a general source
purge policy.

Migration `0043` queues the complete artifact, report, and plan object
references when a production analysis is invalidated by source deletion. The
maintenance worker marks each external object deleted, waits for the
reference's immutable `retentionUntil`, and then purges it through the
workspace-bound object-store adapter. Claims use `FOR UPDATE SKIP LOCKED`, are
reclaimable after a stale lease, and retry with a fixed maximum attempt count.
The queue retains no raw complaint content and is idempotent when a worker
crashes after the external mark or purge. The worker requires
`APPSEA_OBJECT_STORE_ROOT`; an encrypted/versioned cloud adapter and backup
deletion verification remain deployment gates.

Migration `0044` adds the retry schedule and attempt counter to deletion
tombstones. Pending and retryable failed rows have a due `next_attempt_at`,
processing rows hold a server-observed lease, and exhausted failed rows have
no next attempt. The database trigger and runtime grants keep source identity,
failure metadata, and terminal counts fail-closed; a first transient exception
does not erase the tombstone or turn a partial propagation into completion.

Configuration is bounded by the command:

- `APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE` (1-10,000, default 1,000)
- `APPSEA_DELETION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_RETENTION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_SOURCE_SNAPSHOT_RECONCILIATION_BATCH_SIZE` (0-100, default 1)
- `APPSEA_CAMPAIGN_REFRESH_BATCH_SIZE` (0-100, default 1)
- `APPSEA_CAMPAIGN_ORCHESTRATION_BATCH_SIZE` (0-100, default 1)
- `APPSEA_PRODUCTION_WORKFLOW_CANCELLATION_BATCH_SIZE` (0-100, default 1)
- `APPSEA_SOURCE_QUOTA_RETENTION_DAYS` (1-3,650, default 30)
- `APPSEA_DELETION_WORKSPACE_ID` (optional persistence-safe workspace ID)
- `APPSEA_OBJECT_STORE_ROOT` (required absolute object-store adapter root)
- `APPSEA_MAINTENANCE_DATABASE_URL` (required dedicated `appsea_maintenance`
  connection for lease acquire/renew/release)
- `APPSEA_SCHEDULER_OWNER_ID` (required stable process identity in production;
  development/test commands generate an ephemeral identity)
- `APPSEA_MAINTENANCE_LEASE_SECONDS` (30-3,600, default 900)
- `APPSEA_MAINTENANCE_INTERVAL_SECONDS` (10-86,400, default 60; loop only)
- `APPSEA_MAINTENANCE_FAILURE_BACKOFF_SECONDS` (10-3,600, default 30; loop only)
- `APPSEA_MAINTENANCE_METRICS_RETENTION_DAYS` (1-3,650, default 30)
- `APPSEA_MAINTENANCE_METRICS_PURGE_BATCH_SIZE` (1-10,000, default 1,000)

The worker emits secret-free quota expiry/purge, production collection and
analysis admission purge, source-collection-lease purge, snapshot
reconciliation state/coverage counters, retention enqueue, deletion
propagation, output-object purge, campaign refresh, orchestration dispatch,
one-source cancellation retry,
and separate bounded failure/completion events. Snapshot and campaign counters never
include raw source content or caller idempotency keys.
`sourceMaintenanceInputSchema` validates the configuration
before repository work, and `runSourceMaintenance` returns bounded counters
for the correlation job ID. Quota expiry and settled-reservation purge each
use the full quota batch budget; retention enqueue and deletion propagation have
independent bounded budgets.
Workspace enumeration is sorted and deduplicated, and a retry may reuse
`APPSEA_SOURCE_MAINTENANCE_JOB_ID` (the default is a UTC-minute bucket). Run it
from a reviewed scheduler with retry and alerting. The database lease prevents
concurrent scheduler instances from duplicating a bounded pass; migration
`0052` also fences the selected SQL mutations, but is not a fencing token for
external source/provider/object-store work. It does not
replace deployment ownership or incident response. Migration `0047` persists a
bounded outcome row for every acquired, contended, or failed invocation through
the maintenance role; it contains only fixed state/failure codes, duration, and
numeric counters. The command purges rows older than the configured retention
window. Production still needs bounded transaction times, deployment-level
alerting, and an owner for responding to metric/heartbeat failures.
Cloud object storage/backups,
exports, and production deployment behavior remain explicit release blockers.
Explicit one-record re-collection after a completed deletion is implemented in
[`source-recollection.md`](source-recollection.md), but remains an intentional
private action and is not scheduled or triggered by maintenance. Operators may still start a reviewed
analysis over the remaining active evidence; the migration guard prevents
reactivation until that output is linked. Production Temporal, scheduler
alerting, and crash fault-injection remain deployment work.
