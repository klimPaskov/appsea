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
Migration `0062` extends that same forced-RLS queue for derived complaint
corrections. A deferred database trigger records one deterministic correction-
bound repair per affected opportunity after invalidation commits; the worker
reuses the same active-evidence and approved-seed gates, and blocked seeds stay
inspectable instead of bypassing review.
Migration `0038` adds a pre-Temporal, workspace-serialized production start
admission with fixed rate/concurrency limits, digest-only replay identity, and
bounded terminal/expired-row purge.
Migration `0039` adds a forced-RLS, digest-only source collection lease. It
requires a matching operator-approved policy review, preserves one observed
collection timestamp across retries, and exposes only bounded terminal-lease
purge to maintenance. The connector accepts a worker-owned preflight assertion
and invokes it immediately before each external request; denial releases the
reserved quota and produces no HTTP call. Persistence independently
rechecks/locks policy and lease inside the collection transaction. The
preflight-to-provider call remains a small non-atomic network window and needs
deployment-level revocation drills.
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
long-running mutation and does not replace deployed scheduler ownership,
alert endpoint operation, or metric alert ownership. Migration `0047` adds a maintenance-role-only
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
Migration `0082` adds the durable operational-alert outbox. Producers enqueue a
validated scalar-only projection before attempting the external HMAC endpoint;
the standalone maintenance role claims rows with a server-clock lease, records
fixed-code retry/exhaustion state, and purges terminal rows after retention.
The outbox table is not directly readable by either runtime role, and the v2
scheduler functions extend the allowlist for the three alert scans and the
bounded drain without rewriting released migration history.

Migration `0083` adds the owner-scoped workspace purge-manifest ledger. An
archived owner can prepare a deterministic, expiring inventory of persisted
workspace-bound object references for external retention coordination. The
manifest is metadata-only, forced-RLS, and idempotent; it never performs or
authorizes provider, export, backup, or database deletion.
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
Migration `0053` adds a JSONB complaint-analysis snapshot with a validated
deterministic classification/entity-resolution contract. Historical run
snapshots are upgraded from already persisted complaint observations; missing
competitor and substitute evidence remains an explicit unresolved gap.
Migration `0054` hardens source-policy activation by requiring a canonical
reviewer identity, an independent review role, and an explicit independence
attestation. Historical approvals remain audit evidence but are returned to
pending review until re-approved; the CFPB connector stays disabled.
The post-collection production analysis workflow is versioned as `v2`: only
workspace/collection/analysis/seed identifiers and immutable digests cross
Temporal, while the worker rebuilds the evidence-backed artifact inside its
activity. This keeps complaint text and source payloads out of new workflow
histories. New starts carry a strict non-sensitive history memo, and the
visibility-only checker plus reviewed manifest in
[`temporal-history-drain.md`](../runbooks/temporal-history-drain.md) account for
legacy v1 executions without decoding their payloads. Deployment-owned
archive, retention, and deletion still require an external approved operation.
Migration `0055` adds a bounded, monotonic activity-attempt projection to the
analysis run. Migration `0056` adds forced-RLS attempt history with
server-clock timing, bounded stage heartbeats, and fixed terminal failure
codes. The worker writes only operational metadata, so retries become visible
in private status reads without changing the content hash or exposing workflow
payloads.

Migration `0059` adds a separate forced-RLS competitive-observation table.
Each row attaches one bounded claim to an existing opportunity/competitor
relationship and source-item/evidence pair. Non-synthetic rows require an
independently approved `competitor-research` purpose, and editor/owner review
is required before the private read model can report source-backed research.
The migration retains provenance metadata only and activates no connector.

Migration `0063_competitor_feature_matrix.sql` adds a bounded feature matrix
to each normalized competitor row. Entries carry a status, an explicit
evidence basis, bounded notes, and (for source-backed or mixed claims) retained
competitive observation IDs. Fixture matrices remain synthetic, production
seed matrices are restricted to reviewed-seed assumptions, and the public and
private competitor routes render only this normalized contract. Raw provider
payloads remain outside the matrix; approved competitor-purpose source
coverage is still required before source-backed entries can be populated.

Migration `0066_workspace_archival.sql` adds the owner-controlled workspace
lifecycle boundary. A security-definer function locks the workspace, verifies
the authenticated owner, counts active durable work, and either returns a
bounded blocker or archives the workspace idempotently. Archival cancels no
history and deletes no evidence, reports, plans, object references, exports,
or backups; it only stops new workspace research, archives campaign refresh
state, revokes pending invitations, and emits identifier-only receipts.
Destructive retention/purge remains a separately reviewed operation.

Migration `0067_field_level_evidence_redaction.sql` adds the private privacy
projection boundary. A step-up-authenticated owner/editor can record a strict
field mask for one run-bound evidence item. The database function validates
membership and provenance, retains identity/hash/capture lineage, and emits
identifier-only receipts; read mappers mask current evidence, analysis, and
report projections. Raw source deletion, object-store purge, and backup
deletion remain source-policy operations.

Migration `0068_research_campaign_orchestration.sql` adds the multi-source
campaign boundary. A private owner/editor request creates one idempotent
parent orchestration and one forced-RLS child row per configured non-fixture
source (two to sixteen). The child queue stores only identifiers, policy and
workflow identities, bounded attempt/lease state, and fixed failure metadata.
The existing lease-backed source-maintenance worker claims one child with
`FOR UPDATE SKIP LOCKED`, rechecks the current independently approved source
policy, consumes the service production-workflow admission, and starts the
existing one-source Temporal workflow. Reconciliation reads the durable
workflow projection and updates child, parent, and campaign state in one
workspace transaction. The private history/detail routes expose only the
bounded read model. History pages use validated opaque request-time plus
identifier cursors, so pagination cannot cross workspaces or expose hashes; no
raw complaint content, caller key, policy hash, or workflow input is returned.
Paused or archived campaigns cannot receive new
claims, and failed policy checks remain visible rather than being treated as
coverage absence. Deployed Temporal/scheduler ownership, live policy approval,
and crash/retry integration proof remain release gates.

Migration `0069_agent_access_tokens.sql` and the private `/api/mcp` route add
the read-only coding-agent projection. Workspace owners issue expiring,
scope-limited bearer tokens through the authenticated workspace API; the
database stores only a hash and binds each token to one private workspace and
user. MCP reads reuse the authenticated private opportunity/source projections,
preserve coverage and redaction metadata, and admit non-synthetic report/plan
artifacts only after approval. The boundary has no workflow or connector
activation tools and does not accept browser cookies.

Migrations `0070_research_campaign_orchestration_cancellation.sql` and
`0071_production_collection_workflow_cancellation.sql` extend the
multi-source boundary with an immutable owner/editor cancellation intent. The
intent is committed before Temporal cancellation, queued children are stopped
transactionally, and the lease-backed worker retries started-child cancellation
and parent reconciliation. Dispatching claims remain owned until their
workflow identity is known, preserving idempotent external effects. The same
safe-stop boundary covers one-source production jobs; each workflow remains the
terminal reconciliation authority. This is not a data purge operation.

The connector package now includes a disabled Stack Exchange candidate for
bounded competitor/contrary-signal collection. It uses the official API only,
sanitizes question excerpts, preserves an HTTPS attribution locator, and emits
no deletion tombstones from filtered search. The source remains pending
independent review and is not registered or active as a production source. The
production collection activity and scheduled refresh path select a connector
only after `readCollectible` returns a matching approved source-policy
snapshot; no connector can self-activate.

The source-maintenance worker also exposes a supervised `maintenance:loop`
entrypoint. It starts one existing lease-backed pass at a time, applies a
bounded interval or failure backoff, forwards shutdown to the child, and emits
fixed loop counters. The loop is only deployment scheduling glue; PostgreSQL
leases, transaction fencing, and idempotent repositories remain the durable
recovery boundary.

Production evolution still requires authenticated/TLS-protected Temporal,
production identity/recovery policy and scheduled/distributed validation of the
new login/source maintenance jobs, approved live connectors, production
database provisioning, encrypted cloud object storage and backup purge,
deployed recomputation/cost alert endpoint operation and threshold ownership,
and operational controls. The local
fixture workflow is not a production deployment or market-research claim.

## Production runtime packaging

`Dockerfile.web` builds the Next.js application with standalone output and
copies only the traced server/static runtime into a non-root image. It serves
the existing liveness/readiness endpoints on port `3000` and does not run
migrations. `Dockerfile.worker` packages the durable worker's reviewed
TypeScript entry points and workspace dependencies under the same non-root
runtime boundary; its default command is the Temporal worker, while the
production Compose profile uses the same image for preflight, migration, and
the singleton maintenance loop.

`infra/production/compose.yaml` gates web, worker, and maintenance startup on
the one-shot `pnpm production:preflight` service, keeps the migration service
behind an explicit `migrate` profile, defaults web binding to loopback, and
uses read-only filesystems, dropped capabilities, and `no-new-privileges`.
The profile connects to externally operated PostgreSQL, Temporal, object
storage, identity/delivery, and alert providers; it is a packaging and process
topology contract, not provider provisioning or source activation proof.

## Desktop shell boundary

`apps/desktop` is a Tauri 2 wrapper around the web contract. Its Rust build
hook, committed lockfile, deterministic Windows icon, minimal `core:default`
capability, and restrictive local CSP are compiled and checked in the Windows
CI job. The shell does not duplicate research, authentication, or persistence
logic. `bundle.active` stays disabled until hosted-origin review, updater trust,
signing, notarization, platform installation tests, and a desktop security
review are complete.
