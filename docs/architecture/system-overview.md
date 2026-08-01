# System overview

The starter uses a TypeScript monorepo.

```text
workflow client ──► Temporal durable workflow ──► worker activities
                         │                         │
                         │                         ├─ fixture/source policy gate
                         │                         ├─ normalization and clustering
                         │                         ├─ deterministic scoring/reports
                         │                         └─ PostgreSQL transaction
                         │                                  │
                         └─ sanitized status/query        ▼
                                      PostgreSQL job state, provenance,
                                      immutable run lineage, source quota
                                      reservations, deletion projections,
                                      and outbox
                                                          │
                                                          ▼
                                                website and API routes
```

The fixture path now writes the same normalized provenance and immutable run
lineage into PostgreSQL through `packages/db`. Temporal owns scheduling, retry,
cancellation, and recovery while PostgreSQL owns the workspace-scoped
projection and invariants. Workflow history contains only sanitized identifiers,
hashes, budgets, and fixed summaries. PostgreSQL and Temporal are verified in
loopback local environments and CI, with separate database roles plus forced
workspace RLS.

Non-fixture report, plan, and production-analysis artifact blobs cross the
`packages/object-store` content-addressed reference seam. Its in-memory, local
filesystem, and signed S3-compatible adapters prove workspace isolation,
immutable replay, tombstone reads, corruption detection, and retention-aware
purge. Report and plan serializers validate their payloads before storage, and
production analysis persists policy-review and evidence/source-item lineage in
migration `0030`; migration `0031` keeps report and plan
approval/export governance separate; migration `0032` adds an
editor/owner complaint-review boundary before downstream analysis. Complaint
IDs are never used as evidence IDs. Provider encryption, versioning, backup
deletion, and deployment credentials remain separate operational approval gates.
Migration `0033` adds an immutable workspace seed-review registry with
editor/owner approval transitions; analysis start and persistence both resolve
and verify approved seed content by ID, version, and hash.
Migration `0034` adds a deterministic, approved-seed-bound handoff queue written
with collection completion; the worker claims stale-recoverable rows and starts
the existing analysis workflow only after rebuilding active evidence lineage.
Migration `0036` protects the same-run deletion-recovery path: a new analysis
may re-cluster remaining active evidence, but an invalidated opportunity cannot
reactivate until its active output is linked. Migration `0037` records a
deletion-triggered recomputation job in the same propagation transaction; the
durable worker claims it with bounded retries and starts the existing analysis
workflow only from active evidence and an approved immutable seed.
Migration `0038` adds a pre-Temporal, workspace-serialized production start
admission with fixed rate/concurrency limits, digest-only replay identity, and
bounded terminal/expired-row purge.
Migration `0039` adds a forced-RLS, digest-only source collection lease. It
requires a matching operator-approved policy review, preserves one observed
collection timestamp across retries, rechecks/locks policy and lease inside the
collection persistence transaction, and exposes only bounded terminal-lease
purge to maintenance.
Migrations `0040` and `0041` add a forced-RLS, policy-gated full-snapshot
reconciliation projection. The worker stores only source identifiers, page
hashes, bounded warnings, and server-observed checkpoints; a scheduler can
claim queued or stale jobs without the original caller key. A warning-free
short page is required before the persistence transaction compares the staged
identifier set with active source items and enqueues deletion tombstones.
Migration `0046` adds a global, non-workspace scheduler lease for bounded
maintenance and delivery commands. Its security-definer acquire, renew, and
owner/token-checked release functions use PostgreSQL server time and are
callable only through the standalone `appsea_maintenance` role supplied by
`APPSEA_MAINTENANCE_DATABASE_URL`; `appsea_service` cannot execute them or
select/mutate the lease table directly. The per-acquisition token prevents
same-owner overwrites and stale release. The lease prevents duplicate passes
across scheduler instances but is not by itself a fencing token for a
long-running mutation and does not replace deployed scheduler ownership, alert routing, or
metric alert ownership. Migration `0047` adds a maintenance-role-only
record/list/purge boundary for bounded run outcomes: generated run IDs, owner,
fixed state/failure code, duration, and numeric counters. Rows are purged by a
configured retention window; lease tokens, source content, and raw errors are
not stored. The private workspace cost route reads the existing immutable cost
ledger through authenticated workspace RLS and returns bounded exact micro-unit
aggregates by currency and cost type; it does not expose raw run or source
identifiers. Migration `0049` adds a forced-RLS source-quota reconciliation
projection. It discovers committed reservations without a completed production
run, exposes only bounded identifiers/counters through authenticated workspace
inspection, and permits `appsea_maintenance` to record an exact linked-result
or explicit no-result resolution. It never refunds quota or authorizes a
re-fetch.
Migration `0050` adds explicit, one-record tombstone-bound re-collection
lineage across workflow projections, research runs, and source items. Completed
deletion state is required by database triggers; deleted history is preserved
and active native-record uniqueness remains enforced. Re-collection is a
private, reviewed action and is not an automatic retry or source activation.
Migration `0051` extends the production start admission for the direct CFPB
command: the command must establish the `appsea-worker` service principal on
the runtime service role, share the same workspace rate/concurrency ledger,
and consume the reservation before the external request. It cannot bypass
private-workspace, fixture, or source-policy checks.
Migration `0052` adds the service-only
`appsea.assert_maintenance_scheduler_lease` transaction fence. It uses server
time and holds the per-scheduler advisory and lease-row locks through selected
source, deletion, admission, retention, and delivery-state transactions;
external source/provider/object-store effects remain outside this atomic
boundary.
The post-collection production analysis workflow is versioned as `v2`: only
workspace/collection/analysis/seed identifiers and immutable digests cross
Temporal, while the worker rebuilds the evidence-backed artifact inside its
activity. This keeps complaint text and source payloads out of new workflow
histories; legacy v1 executions require a controlled drain/retention plan.

Production evolution still requires authenticated/TLS-protected Temporal,
production identity/recovery policy and scheduled/distributed validation of the
new login/source maintenance jobs, approved live connectors, production
database provisioning, encrypted cloud object storage and backup purge,
recomputation alerting,
and operational controls. The local
fixture workflow is not a production deployment or market-research claim.
