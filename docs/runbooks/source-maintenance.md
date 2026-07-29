# Source maintenance

`@appsea/worker` owns the bounded maintenance command for source quota
reservations, policy-derived retention tombstones, and deletion propagation:

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
run reactivates the projection.

Retention policies using `redact` or `tombstone` reuse this path. Policy drafts
using `purge` are rejected until a separately reviewed object-store/database
purge implementation is available.

Configuration is bounded by the command:

- `APPSEA_SOURCE_QUOTA_EXPIRY_BATCH_SIZE` (1-10,000, default 1,000)
- `APPSEA_DELETION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_RETENTION_BATCH_SIZE` (1-1,000, default 100)
- `APPSEA_SOURCE_QUOTA_RETENTION_DAYS` (1-3,650, default 30)
- `APPSEA_DELETION_WORKSPACE_ID` (optional persistence-safe workspace ID)

The worker emits secret-free quota expiry/purge, retention enqueue, deletion propagation, and
failure events. `sourceMaintenanceInputSchema` validates the configuration
before repository work, and `runSourceMaintenance` returns bounded counters
for the correlation job ID. Quota expiry and settled-reservation purge each
use the full quota batch budget; retention enqueue and deletion propagation have
independent bounded budgets.
Workspace enumeration is sorted and deduplicated, and a retry may reuse
`APPSEA_SOURCE_MAINTENANCE_JOB_ID` (the default is a UTC-minute bucket). Run it
from a scheduler with retry and alerting. External object storage/backups,
exports, complaint/cluster recomputation, explicit re-collection after source
deletion, and production deployment behavior remain explicit release blockers.
