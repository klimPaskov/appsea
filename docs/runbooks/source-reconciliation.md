# Full-snapshot source reconciliation

This runbook covers the identifier-only CFPB full-snapshot reconciliation
checkpoint. It does not activate the source or make the public leaderboard
non-synthetic. The CFPB policy must be approved, active, current, unexpired,
and explicitly permit the `deletion-reconciliation` purpose before PostgreSQL
will enqueue a job.

## Request a bounded reconciliation

The command hashes the caller key before persistence. The raw key is never
stored, logged, or sent to a workflow history:

```powershell
$env:APPSEA_SOURCE_RECONCILIATION_WORKSPACE_ID = 'workspace:research'
$env:APPSEA_SOURCE_RECONCILIATION_IDEMPOTENCY_KEY = 'cfpb-full-snapshot-2026-08-01'
$env:APPSEA_SOURCE_RECONCILIATION_POLICY_VERSION = 'cfpb-2026-07-v1'
$env:APPSEA_SOURCE_RECONCILIATION_PAGE_SIZE = '100'
$env:APPSEA_SOURCE_RECONCILIATION_MAX_RECORDS = '1000'
pnpm worker:source:cfpb:reconcile
```

The job ID is deterministic for the workspace/source/key tuple. Identical
input replays the existing row; a conflicting input is rejected. The worker
acquires a digest-only source lease before the first page and uses the lease's
server-observed timestamp for every page.

## Resume due work

A scheduler can resume the oldest queued or stale-running job without access to
the original caller key:

```powershell
$env:APPSEA_SOURCE_RECONCILIATION_WORKSPACE_ID = 'workspace:research'
pnpm worker:source:cfpb:reconcile:next
```

Claims use `FOR UPDATE SKIP LOCKED` and expire after a bounded lease. Each page
stores only a hash and the source identifiers in PostgreSQL. A repeated page
checkpoint is a no-op; a settled quota reservation without a matching
checkpoint enters explicit operator reconciliation rather than issuing an
unbounded duplicate fetch.

## Deletion proof

The worker emits deletion tombstones only when an unfiltered official API
traversal observes a short page and every returned record has a valid complaint
identifier. If the `maxRecords` bound is reached, the API returns a malformed
identifier, a request fails, or policy/lease validation fails, the job records a
visible coverage gap and emits no deletion absence claim. The final tombstone
insert and lease assertion run in one PostgreSQL transaction; a lease revocation
cannot win between the comparison and enqueue.

Downstream deletion propagation remains a separate bounded maintenance step:

```powershell
pnpm --filter @appsea/worker source:maintenance
```

It redacts source/evidence payloads and invalidates dependent report, plan, and
opportunity projections while retaining provenance. It does not recollect a
deleted source record.

## Operations and blockers

Inspect only bounded counters and coverage metadata through the private job
read model. Do not copy reconciliation counts into the public leaderboard or
describe a complete snapshot as statistical market coverage. Production
scheduler ownership, legal/privacy/security approval, encrypted object-store
and backup purge, alerting, and PostgreSQL/Docker deployment proof remain
release work.
