# Active work

## State

The fixture product, PostgreSQL persistence, durable workflows, policy-gated
CFPB collection checkpoint, authenticated private workspaces, report/plan
approval/export, recovery, and invitations are implemented. Migrations
`0027`-`0063` add policy evidence, collection checkpoints, deletion repair,
leases, snapshot reconciliation, workflow admissions, source-reconciliation
admission, retryable tombstones, maintenance-run telemetry, and a durable
source-quota reconciliation case ledger. Migration `0050` adds explicit,
one-record tombstone-bound re-collection with immutable workflow/run/source-item
lineage and an exact CFPB complaint route; it never runs automatically and the
source remains disabled. Migration `0051` requires the direct CFPB command to
reserve and consume the shared production admission ledger through the
`appsea-worker` service principal. Deployed Temporal/scheduler ownership, policy
approval, role separation, non-fixture outputs, and identity-provider approval
remain open. Collection routes are Temporal gateways; signup workspaces remain
non-fixture by design.

On 2026-08-02, the production collection activity was generalized to select
the CFPB or Stack Exchange connector only after `readCollectible` returns a
matching approved source-policy snapshot. The scheduled campaign-refresh worker
uses the same production connector allowlist. The Stack Exchange policy remains
unregistered and disabled, so this adds no activation or market-research claim.

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

Production analysis read models include the linked report and plan approval
states from their PostgreSQL governance projections. The private opportunity
mapper uses those states, so a later report/plan approval transition is visible
without inferring `draft` or `unreviewed` from an immutable object payload.

Operational monitoring includes `/api/health/live`, `/api/health/ready`, and a
secret-free worker heartbeat every 30 seconds. Web and durable worker share a
fail-closed Temporal endpoint contract: production requires non-loopback
address, namespace, API key, and pinned CA. Deployment topology, authorization,
HA, retention, and failure drills remain open.

Migration `0046`/`0052` leases and fences protect maintenance mutations;
metrics, cost summaries, and quota cases are durable/private. The worker's
bounded, signal-safe `maintenance:loop` remains deployment-owned, and explicit
re-collection requires a completed matching tombstone.

## Validated commands

- `pnpm verify` passed 2026-08-02 after the source tranche: 56 Turbo tasks,
  samples, web smoke, formatting, and repository checks pass.
- PostgreSQL and Temporal integration are staged but Docker-blocked because the
  Docker Desktop Linux engine pipe is unavailable.

- Maintenance loop tests pass; no deployed scheduler, Temporal, or source
  activation claim.

Migrations `0053` and `0054` added deterministic complaint
analysis snapshots and identity/independence-bound source approvals. The CFPB
source remains disabled pending external review.

Private opportunity details now expose `competitiveResearch` and a separate
competitors/contrary-signals page: fixture records are synthetic/unresolved,
production seeds are reviewed-seed-only with provenance, and source-backed
status requires a confirmed non-synthetic observation with permitted source/
evidence IDs and an observation time. Migration `0059` persists bounded
per-claim provenance and owner/editor review; no approved competitor source is
connected. Migration `0063` adds a bounded, provenance-labelled competitor
feature matrix through persistence and public/private reads; source-backed
rows remain gated. Complaint/source-item provenance
now carries an HTTPS canonical locator for attribution; a disabled,
fixture-tested Stack Exchange candidate remains pending independent review;
the worker now has a registry-selected path but no active source row.
Migration `0060` adds a database-level HTTP(S) host/path check for those
locators, while policy still controls whether a locator may be displayed.

Campaigns now have a private one-source `campaign-v1` run/history, draft
lifecycle, policy-gated refresh claims, and registry picker. Multi-source
orchestration, live activation, deployed scheduler/Temporal, and Docker proof
remain open; CFPB is disabled.

The 2026-08-02 analysis tranche adds a reviewed seed handoff: owner/editor
members choose an approved seed, the admission route starts
`production-analysis-v2`, and a private status API reconciles safe Temporal
state with PostgreSQL. Workflow prefixes are workspace-bound; hashes, object
references, source payloads, and seed content stay hidden. Migration `0056`
adds bounded server-clock attempt history with fixed failures. Deployed
scheduler ownership, production Temporal, and periodic alerting remain open.

The 2026-08-02 source-coverage tranche adds a private read-only registry/API
over existing policy tables. It derives production collectibility from the
independent approval gate and exposes quotas, deletion duties, and gaps while
keeping payloads, hashes, reviewer identities, and activation controls out.

2026-08-02 correction tranche adds migrations `0061` and `0062`, a strict
derived-only editor/owner correction contract, immutable prior/next snapshot
hashes, active analysis/opportunity invalidation, and a deferred correction
trigger that queues one deterministic repair per affected opportunity. Source
evidence/provenance remains immutable; stale report/plan reads are hidden until
reviewed re-analysis; the persisted corrected snapshot feeds that next
artifact. Editor has field controls; evidence basis is read-only.
Missing or unapproved seeds block repair.

## Next production tranche

1. Legal/privacy/security approval and CFPB policy activation.
2. Production Temporal/DB provisioning and Docker crash/retry proof.
3. Provider/identity approval, delivery, deployed maintenance, and export.
4. Monitoring, scheduler ownership, pricing/billing controls, and security
   review.
5. Supply a separately reviewed competitor/contrary-signal source under the
   `competitor-research` purpose before treating any competitive output as
   source-backed; the Stack Exchange candidate is not registered or active,
   though its reviewed-policy worker path is now present.

## Current blockers

- CFPB is disabled pending source approval; no real source is enabled.
- Production DB/Temporal, identity delivery, role separation, cloud/backup
  purge, and deployment validation remain.
- Recovery/invitations await provider, DPA/retention, key rotation, monitoring,
  and failure-drill approval.
- Deletion retries and explicit one-record recollection exist; workspace/export
  purge, cloud storage, recomputation alerts, deployed scheduler ownership, and quota
  case alert ownership remain open.
- Windows/macOS release remains open.
