# Active work

## State

The fixture product, PostgreSQL persistence, durable workflows, policy-gated
CFPB collection checkpoint, authenticated private workspaces, report/plan
approval/export, recovery, and invitations are implemented. Migrations
`0027`-`0058` add policy evidence, collection checkpoints, deletion repair,
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

Scheduler leases and transaction fencing now protect selected maintenance SQL
mutations; maintenance-run metrics, cost summaries, and quota-reconciliation
cases are durable and private. External source/provider/object-store effects,
deployed scheduler alert routing, and reconciliation resolution remain separate
operations. The worker now exposes `maintenance:loop`, which supervises the
existing one-shot lease-backed pass with bounded interval/backoff and
signal-safe child shutdown; a production process supervisor and alert policy
are required. Explicit re-collection requires a completed
matching tombstone.

## Validated commands

- `pnpm verify` passed 2026-08-02; affected contract/database/worker checks and
  guidance, formatting, memory, and docs checks pass.
- PostgreSQL and Temporal integration are staged but Docker-blocked because the
  Docker Desktop Linux engine pipe is unavailable.

- Maintenance loop tests pass; no deployed scheduler, Temporal, or source
  policy activation claim.

On 2026-08-01, migrations `0053` and `0054` added deterministic complaint
analysis snapshots and identity/independence-bound source approvals. The CFPB
source remains disabled pending external review.

Private opportunity details now expose `competitiveResearch` and a separate
competitors/contrary-signals page: fixture records are synthetic/unresolved,
production seeds are reviewed-seed-only with provenance, and source-backed
status requires permitted source IDs, retained evidence IDs, and an observation
time. Per-competitor observations and feature matrices remain open.

The 2026-08-02 campaign tranche adds a private one-source run route plus
bounded history/status reads on the strict `campaign-v1` boundary. The server
derives collection inputs from persisted intent, rechecks approved policy,
purpose, expiry, and optional seed review, then commits admission before
Temporal. History exposes only state, checkpoint, counters, IDs, and times;
hashes/payloads stay hidden. Migration `0057` adds validated draft edits and a
soft archive state with run/evidence lineage preserved. Migration `0058` adds
durable daily/weekly/monthly refresh claims, pending request lineage, bounded
retry state, and source-maintenance dispatch through the same policy/admission
gates. Multi-source, source picker, live activation, deployed scheduler/
Temporal, and Docker PostgreSQL proof remain open; CFPB is disabled.

The follow-on 2026-08-02 analysis tranche adds the missing reviewed handoff:
owner/editor members choose an approved seed on the completed collection page,
the existing analysis admission route starts `production-analysis-v2`, and a
private status page/API reconciles a safe Temporal response with the durable
PostgreSQL projection. Workflow prefixes are workspace-bound; hashes, object
references, source payloads, and seed content stay outside the read contract.
Migration `0056` adds at most ten server-clock attempt rows with stage
heartbeats, duration, and fixed failure codes; status reads merge this safe
history without hashes or source content. Deployed scheduler ownership,
production Temporal availability, and periodic alerting remain open.

The 2026-08-02 source-coverage tranche adds a private read-only registry/API
over existing policy tables. It derives production collectibility from the
independent approval gate and exposes quotas, deletion duties, and gaps while
keeping payloads, hashes, reviewer identities, and activation controls out.

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
  purge, cloud storage, recomputation alerts, deployed scheduler ownership, and quota
  case alert ownership remain open.
- Windows/macOS packaging remains open.
