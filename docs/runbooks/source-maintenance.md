# Source maintenance

`@appsea/worker` owns the bounded maintenance command for source quota
reservations, policy-bound collection leases, policy-derived retention
tombstones, and deletion propagation:

```text
pnpm --filter @appsea/worker source:maintenance
```

The command enumerates active workspaces through
`appsea.list_active_workspaces_for_maintenance()`, a narrowly granted
migration-owner security-definer function; it does not rely on a runtime
cross-workspace RLS bypass. It expires abandoned PostgreSQL quota reservations
through a workspace-scoped security-definer function. It queues retention
tombstones from each stored source policy's `retentionDays` and
`deletionRequired` fields, then processes
every workspace's deletion queue unless `APPSEA_DELETION_WORKSPACE_ID` is
supplied to narrow a run. Claims use `FOR UPDATE SKIP LOCKED` and reclaim
processing claims older than the lease. Propagation is idempotent, retains
tombstone identifiers, removes source-item raw references, replaces normalized
evidence/report/plan payloads with deletion markers, marks dependent versions
unavailable, and invalidates/de-ranks any mutable opportunity projection whose
completed production analysis used the deleted source record. The invalidation
clears current score and plan pointers while preserving immutable clusters,
score snapshots, and lineage. A later completed analysis from a new collection
run, or an explicit reviewed analysis over the remaining active evidence,
reactivates the projection only after the new active output is linked.
Migration `0037` also inserts one durable recomputation job per invalidated
opportunity/tombstone when prior analysis lineage provides a seed review. The
durable worker claims due jobs with `FOR UPDATE SKIP LOCKED`, reconstructs the
remaining active evidence, and starts the existing analysis workflow. A
withdrawn seed is visible as `blocked` and becomes dispatchable only after a
new approval; no job performs source acquisition.

Migration `0038` adds transient production workflow admission rows before a
user-triggered Temporal start. The admission function serializes each
workspace's five-start/15-minute and two-active-job limits, returns a replay
for an already admitted digest, and lets workflow initialization consume the
reservation. The bounded maintenance pass also purges consumed, released, or
expired admissions older than the retention cutoff; it never deletes workflow
jobs or research evidence.

Migration `0039` adds digest-only source collection leases. Acquisition is
bound to the active source-policy review and stores one observed timestamp for
retry replay. The worker asserts the lease immediately before collection
persistence and releases it only after commit. The same bounded maintenance
pass purges released, expired, or revoked lease rows older than the retention
cutoff; it never deletes source evidence or policy history. An inactive lease
or quota settlement without a completed result remains an operator-
reconciliation case.

Full-snapshot deletion reconciliation is a separate durable worker boundary;
it does not run as part of the ordinary maintenance pass:

```text
pnpm --filter @appsea/worker source:cfpb:reconcile
pnpm --filter @appsea/worker source:cfpb:reconcile:next
```

The direct command hashes the caller idempotency key before enqueueing. The
resume command claims only due CFPB jobs and needs only the workspace ID. Page
checkpoints store source identifiers, hashes, and bounded warnings; tombstones
are inserted only after the worker observes a warning-free short page and the
database locks/asserts the source lease in the same transaction. A capped or
malformed traversal records a coverage gap and emits no deletion absence claim.
Run the resume command from a reviewed scheduler with bounded retries and
alerting; deployed scheduler ownership and legal/privacy/security activation
remain release gates.

Retention policies using `redact` or `tombstone` reuse this path. Policy drafts
using `purge` are rejected until a separately reviewed object-store/database
purge implementation is available.

Configuration is bounded by the command:

- `APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE` (1-10,000, default 1,000)
- `APPSEA_DELETION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_RETENTION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_SOURCE_QUOTA_RETENTION_DAYS` (1-3,650, default 30)
- `APPSEA_DELETION_WORKSPACE_ID` (optional persistence-safe workspace ID)

The worker emits secret-free quota expiry/purge, production admission and
source-collection-lease purge,
retention enqueue, deletion propagation, and failure events.
`sourceMaintenanceInputSchema` validates the configuration
before repository work, and `runSourceMaintenance` returns bounded counters
for the correlation job ID. Quota expiry and settled-reservation purge each
use the full quota batch budget; retention enqueue and deletion propagation have
independent bounded budgets.
Workspace enumeration is sorted and deduplicated, and a retry may reuse
`APPSEA_SOURCE_MAINTENANCE_JOB_ID` (the default is a UTC-minute bucket). Run it
from a scheduler with retry and alerting. External object storage/backups,
exports, explicit re-collection after source deletion, and production deployment
behavior remain explicit release blockers. Operators may still start a reviewed
analysis over the remaining active evidence; the migration guard prevents
reactivation until that output is linked. Production Temporal, scheduler
alerting, and crash fault-injection remain deployment work.
