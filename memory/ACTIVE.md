# Active work

## State

The fixture product, PostgreSQL persistence, durable workflows, policy-gated
CFPB collection checkpoint, authenticated private workspaces, report/plan
approval/export, recovery, and invitations are implemented. Migrations
`0027`-`0052` add policy evidence, collection checkpoints, deletion repair,
leases, snapshot reconciliation, workflow admissions, source-reconciliation
admission, retryable tombstones, maintenance-run telemetry, and a durable
source-quota reconciliation case ledger. Migration `0050` adds explicit,
one-record tombstone-bound re-collection with immutable workflow/run/source-item
lineage and an exact CFPB complaint route; it never runs automatically and the
source remains disabled. Migration `0051` requires the direct CFPB command to
reserve and consume the shared production admission ledger through the
`appsea-worker` service principal. Deployed Temporal/scheduler ownership, policy
approval, role separation, non-fixture outputs, and identity-provider approval
remain open. Fixture and production collection routes are Temporal gateways;
signup workspaces remain non-fixture by design.

On 2026-08-01, production analysis Temporal starts were versioned to
`production-analysis-v2`. New starts carry only workspace, collection,
analysis, seed-review, timestamp, and digest identifiers. `apps/worker`
reconstructs the policy-validated artifact from workspace-bound rows inside the
persistence activity, preserving the no-raw-source-in-history boundary. Legacy
v1 executions need a drain/retention plan.

Retention uses server-observed activity time rather than caller `requestedAt`;
future timestamps are rejected. Final lineage locks the active, current,
unexpired policy, requires allowed/restricted commercial use, and rechecks
confirmed redacted evidence before linking outputs. Collection initialization
fails closed without a consumed admission reservation.

Collection persistence locks and rechecks the source lease in its write
transaction. Settled source-request cost travels from `CfpbConnector` through
the immutable collection snapshot/result, Temporal checkpoints, and
audit/outbox metadata. The reviewed CFPB policy declares zero API cost; the
runner rejects known cost overages before lease acquisition.

The object-store boundary includes a signed S3-compatible adapter and one
environment factory used by web, durable worker, and source maintenance. It
uses conditional content-addressed body/sidecar writes, ETag-guarded deletion,
bounded hash-checked reads, and the retention purge queue. Provider
encryption/versioning, backup deletion, credential rotation, and deployed cloud
proof remain open; local filesystem fallback is not a production claim.

Production analysis read models now include the linked report and plan approval
states from their PostgreSQL governance projections. The private opportunity
mapper uses those states, so a later report/plan approval transition is visible
without inferring `draft` or `unreviewed` from an immutable object payload.

Operational monitoring includes `/api/health/live`, `/api/health/ready`, and a
secret-free worker heartbeat every 30 seconds. Web and durable worker share a
fail-closed Temporal endpoint contract: production requires non-loopback
address, namespace, API key, and pinned CA. Deployment topology, authorization,
HA, retention, and failure drills remain open.

Migration `0046_maintenance_scheduler_leases.sql` adds a global server-clock
lease per fixed scheduler name. Only standalone, non-inheriting
`appsea_maintenance` can call acquire/renew/release; runtime table access and
`appsea_service` function execution are revoked. Acquisitions have fresh
tokens. Source maintenance, auth retention, recovery, and invitation delivery
renew during bounded passes, guard mutations, skip contention, and emit fixed
lease-loss/release failures.

Migration `0052_maintenance_scheduler_fencing.sql` adds a private,
server-clock transaction fence for selected source, deletion, admission,
retention, and delivery-state mutations. The scheduler passes its fence
identity only in memory; PostgreSQL holds the per-scheduler advisory and
lease-row locks through commit, and stale tokens fail closed. External
source/provider/object-store effects and snapshot reconciliation remain outside
the fence.

Migration `0047_maintenance_scheduler_run_metrics.sql` adds
maintenance-role-only record/list/purge functions. The wrapper records a
generated run ID, owner/state, fixed failure code, bounded duration, and
validated numeric counters, purges rows older than the configured retention
window, and never persists lease tokens, source content, credentials, or raw
exception messages. This improves durable operator telemetry but does not
provide deployed scheduler ownership or alert routing. Migration `0048` adds the ledger time index and a
membership-authorized private workspace cost summary that groups exact
micro-unit totals by currency and cost type over a bounded period; it is
operational accounting, not billing. Migration `0049` discovers committed
source reservations without completed production results, exposes private
member inspection at `/api/workspaces/:workspaceId/research/quota-reconciliation`,
and permits only the standalone maintenance role to record an exact linked
result or explicit no-result resolution. It never refunds quota or authorizes
a re-fetch. The explicit re-collection path is separate and requires a
completed matching tombstone.

## Validated commands

- `pnpm verify` passed 2026-08-01; affected contract/database/worker checks and
  guidance, formatting, memory, and docs checks pass.
- PostgreSQL integration is staged but Docker-blocked because the Docker Desktop
  Linux engine pipe is unavailable.

On 2026-08-01, migrations `0053` and `0054` added deterministic complaint
analysis snapshots and identity/independence-bound source approvals. The CFPB
source remains disabled pending external review.

Private opportunity details now expose `competitiveResearch` and a separate
competitors/contrary-signals page: fixture records are synthetic/unresolved,
production seeds are reviewed-seed-only with provenance, and source-backed
status requires permitted source IDs, retained evidence IDs, and an observation
time. Per-competitor observations and feature matrices remain open.

The 2026-08-01 campaign slice adds strict `campaign-v1` contracts and a
private draft repository/API/page. Source IDs resolve to lifecycle/policy
readiness; fixture mixing, unknown sources, and approved-purpose mismatches
fail closed. Creation writes identifier-only audit/outbox receipts and never
starts Temporal or activates a connector. Legacy campaign JSON remains
readable. Edit/delete, run controls, refresh scheduling, source picker, live
activation, and Docker PostgreSQL proof remain open.

## Next production tranche

1. Legal/privacy/security approval and CFPB policy activation.
2. Production Temporal/DB provisioning and Docker crash/retry proof.
3. Provider/identity approval, delivery, deployed maintenance, and export/
   recollection operations.
4. Monitoring, scheduler ownership, pricing/billing controls, and security
   review.
5. Connect a separately reviewed competitor/contrary-signal source and extend
   the read model with per-record provenance before treating competitive output
   as source-backed.

## Current blockers

- CFPB is disabled pending source approval; no real source is enabled.
- Production DB/Temporal, identity delivery, role separation, cloud/backup
  purge, and deployment validation remain.
- Recovery/invitations await provider, DPA/retention, key-rotation, monitoring,
  and failure-drill approval.
- Deletion retries and explicit one-record recollection exist; workspace/export
  purge, cloud storage, recomputation alerts, deployed scheduling, and quota
  case alert ownership remain open.
- Windows/macOS packaging remains open.
