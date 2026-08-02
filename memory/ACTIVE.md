# Active work

## State

Fixture product, PostgreSQL persistence, durable workflows, policy-gated CFPB
collection, private workspaces, report/plan approval/export, recovery, and
invitations are implemented. Migrations
`0027`-`0068` add policy evidence, collection checkpoints, deletion repair,
leases, snapshot reconciliation, workflow admissions, source-reconciliation
admission, retryable tombstones, maintenance-run telemetry, a durable source-
quota case ledger, recomputation alerts, cost-threshold projection, and
owner-only non-destructive workspace archival.
The 2026-08-02 purge-readiness tranche adds an owner-only read-only
`WorkspacePurgeReadiness` API/settings inventory with deterministic active-work
and object-reference blockers. It names cloud/object/export/backup requirements
and never deletes; see `docs/runbooks/workspace-purge-readiness.md`.

The 2026-08-03 tranche adds migration `0068`: a forced-RLS parent/child queue
for two to sixteen non-fixture sources. The authenticated route is idempotent;
source maintenance rechecks policy, admits/starts the existing workflow, and
reconciles safe child state. No connector was activated.
Migration `0050` adds explicit one-record tombstone-bound CFPB re-collection
with immutable lineage; it never runs automatically and the source remains
disabled. `0051` binds direct CFPB admission to `appsea-worker`. Deployed
Temporal/scheduler ownership, policy approval, role separation, non-fixture
outputs, and identity-provider approval remain open.

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

Read models include linked report/plan approval states from PostgreSQL; the
private opportunity mapper reflects later transitions without inferring state
from immutable object payloads.

Monitoring includes health routes, a secret-free 30-second heartbeat, and
lease-owned quota/recomputation/cost scans. `pnpm production:preflight`
validates role-separated TLS databases, authenticated Temporal, signed object
storage, scheduler ownership, HTTPS origin, delivery switches, and proxy
secret shape without network calls. Deployment topology, HA, retention, alert
routing, and failure drills remain open.

## Validated commands

- `pnpm verify` passed 2026-08-02 after the source tranche. On 2026-08-03,
  focused contracts (82), db (119), worker (96), and web (118) suites plus
  package typechecks/lints passed after orchestration.
- PostgreSQL and Temporal integration are staged but Docker-blocked because the
  Docker Desktop Linux engine pipe is unavailable.

- Maintenance loop, quota-alert, and recomputation-alert tests pass; no
  deployed scheduler, Temporal, or source activation claim.

Competitive research remains synthetic/reviewed-seed-only until an approved
competitor source supplies retained evidence; the Stack Exchange candidate is
disabled. Campaigns have private run/history, refresh, and multi-source
orchestration; live activation and deployed workflow proof remain open.

The 2026-08-02 analysis tranche adds a reviewed seed handoff: owner/editor
members choose an approved seed, the admission route starts
`production-analysis-v2`, and a private status API reconciles safe Temporal
state with PostgreSQL. Workflow prefixes are workspace-bound; hashes, object
references, source payloads, and seed content stay hidden. Migration `0056`
adds bounded server-clock attempt history with fixed failures. Deployed
scheduler ownership, production Temporal, and periodic alerting remain open.

2026-08-02 correction tranche adds migrations `0061` and `0062`, a strict
derived-only editor/owner correction contract, immutable prior/next snapshot
hashes, active analysis/opportunity invalidation, and a deferred correction
trigger that queues one deterministic repair per affected opportunity. Source
evidence/provenance remains immutable; stale report/plan reads are hidden until
reviewed re-analysis; the persisted corrected snapshot feeds that next
artifact. Editor has field controls; evidence basis is read-only.
Missing or unapproved seeds block repair.

The 2026-08-02 alert tranches add migrations `0064`/`0065`, maintenance-only
recomputation/cost projections, bounded lease-aware scans, fixed states,
secret-free counters, and explicit cost thresholds. They never mutate work;
deployment owns scheduler routing, threshold selection, billing, and response.

Migration `0066` adds `appsea.archive_workspace`: owner + recent step-up,
active durable-work blocker, campaign refresh cleanup, pending-invitation
revocation, and identifier-only receipts. Archival retains lineage and is not
workspace/object/export/backup purge. Web `DELETE /api/workspaces/:workspaceId`
and the member settings control expose the strict `ARCHIVE WORKSPACE` action.

Migration `0067` adds owner/editor field-level evidence redaction. The strict
run/complaint/evidence route requires a recent step-up and records immutable
redaction receipts plus identifier-only audit/outbox events. Source identity,
capture/policy lineage, content hashes, and immutable analysis snapshots remain;
private collection, opportunity/leaderboard, analysis, report, coding-plan, and
export mappers apply stable masks.
Text masking is denied while a raw source object reference exists, leaving
source-policy deletion and cloud/backup purge as separate operations. The
collection page exposes the small privacy-redaction control.

Current audit: `docs/status/production-readiness-audit-2026-08-02.md`.

## Next production tranche

1. Legal/privacy/security approval and CFPB policy activation.
2. Production Temporal/DB provisioning, orchestration crash/retry proof, and
   Docker-backed integration execution.
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
  purge, cloud storage, recomputation alert routing, deployed scheduler
  ownership, and quota case routing remain open.
- Windows/macOS release remains open.
