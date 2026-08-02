# Plan 001: Foundation to production MVP

- Status: active
- Owner: main coding agent
- Started: 2026-07-10
- Current audit: [`production-readiness-audit-2026-07-25.md`](../../status/production-readiness-audit-2026-07-25.md)

## Completed foundation

- native Codex project layout
- durable agent memory and documentation system
- fixture source policy and connector
- validated contracts
- complaint normalization and clustering
- deterministic opportunity scoring
- coding-agent plan generation
- sparse website routes
- staged desktop boundary

## Production milestones

### 1. Persistence

Status: production-shaped foundation implemented and validated locally; production provisioning remains blocked.

Implemented:

- PostgreSQL 18 schema and fifty-seven forward, checksummed migrations
- normalized source, evidence, complaint, cluster, competitor, opportunity, score, report, plan, audit, cost, deletion, outbox, and lineage tables
- no-login owner, separate migrator, and least-privilege runtime role contract
- forced workspace RLS and transaction-scoped workspace context
- source collection and evidence display policy gates
- immutable, run-scoped score, plan, cluster, source-policy, and acquisition lineage
- replay-safe fixture repository with concurrent idempotency conflict handling
- populated upgrade, fresh install, privilege, RLS, provenance, policy, cross-wire, and replay tests
- local runbook and CI persistence gate
- PostgreSQL-backed source quota reservations shared across workspaces, with
  idempotent commit/release and bounded expiry
- policy-derived, bounded retention tombstone enqueue reusing the deletion
  propagation path
- content-addressed object-reference contract with deterministic in-memory,
  local filesystem, and signed S3-compatible adapters for production analysis
  artifact/report/plan blobs; migration `0043` now queues complete invalidated
  output references and the adapters perform retention-aware mark/purge retries;
  provider encryption, lifecycle/versioning, workspace closure, exports, and
  backup purge remain open
- durable production-analysis run, policy/evidence/output lineage, report
  object-reference, RLS, terminal-transition, and source-deletion invalidation
  migration; idempotent repository stores redacted artifact/report/plan objects
  and deterministic projections
- migration `0031_plan_approval_governance.sql` adds object-reference format
  checks and owner/editor plan approval transitions with report-readiness gates,
  audit, and outbox receipts
- migration `0032_complaint_review_governance.sql` adds an editor/owner review
  boundary for production complaint observations, with active-evidence checks
  and identifier-only audit/outbox receipts
- migration `0039_source_collection_leases.sql` binds an external collection
  attempt to an approved policy review, preserves one server-observed capture
  timestamp across retries, rechecks policy/expiry immediately before
  persistence, and bounds terminal-lease retention through source maintenance
- migrations `0040_source_snapshot_reconciliation.sql` and
  `0041_source_snapshot_page_checkpoints.sql` add policy-gated, identifier-only
  full-snapshot jobs, immutable page checkpoints with persisted warnings,
  skip-locked scheduler claims, and same-transaction tombstone finalization
- skip-locked deletion tombstone propagation that redacts source/evidence rows
  and marks dependent report/plan versions unavailable
- migration `0044_retryable_deletion_propagation.sql` adds server-clock stale
  claim recovery, bounded retry scheduling, and terminal exhausted tombstones
  without weakening the immutable deletion identity boundary
- migration `0045_source_snapshot_reconciliation_admission.sql` adds an
  authenticated editor admission route, workspace-scoped source-reconciliation
  rate/concurrency limits, immutable user/service actor attribution, and an
  explicit `appsea-worker` service-principal guard for the direct command
- migration `0046_maintenance_scheduler_leases.sql` adds a server-clock,
  owner/token-checked acquire/renew/release lease for scheduled maintenance and
  delivery commands; only the dedicated `appsea_maintenance` role may call the
  functions and direct table access remains revoked from runtime roles
- global-auth password-reset tokens with latest-only semantics, encrypted
  delivery outbox, security events, narrow security-definer functions, bounded
  purge, and a retryable signed provider worker; delivery remains kill-switched
  pending identity/provider approval

The invalidated production-analysis output queue is a deliberate narrow slice:
it does not claim source-wide retention purge, cloud backup deletion, or
workspace-closure deletion.

Remaining deployment work and the non-fixture object-store integration are
tracked in `docs/status/known-gaps.md` and are not part of the completed
repository persistence foundation.

Migration `0049_source_quota_reconciliation.sql` adds a forced-RLS case
projection for committed source reservations that lack a completed production
result. Authenticated workspace inspection is bounded and no-store; the
standalone maintenance role can record only an exact linked result or an
explicit no-result void. The boundary never refunds quota or authorizes a
re-fetch. Deployed alert ownership and incident response remain open.

Migration `0050_explicit_source_recollection.sql` adds the reviewed explicit
re-collection boundary. A completed matching deletion tombstone is required;
the request is limited to one source-native record; workflow/run/source-item
lineage is immutable; and the old deleted row remains historical. The CFPB
connector uses its exact complaint route for this request and emits no deletion
tombstone. This is a private operator action, not an automatic retry or source
activation; see [`source-recollection.md`](../../runbooks/source-recollection.md).

Migration `0051_service_production_workflow_admission.sql` extends the existing
production collection admission function for the direct CFPB command. The
command must run inside the explicit `appsea-worker` service-principal
transaction on the runtime service role and the target must be an active,
private, non-fixture workspace. It shares the fixed rate/concurrency ledger
with authenticated starts, consumes the reservation immediately before the
external request, and cannot create a second unauthenticated source-ingress
path.

Migration `0052_maintenance_scheduler_fencing.sql` adds a service-only,
server-clock scheduler assertion that holds the per-scheduler advisory and
lease-row locks through selected maintenance transactions. Source quota,
deletion, admission, lease purge, authentication retention, and delivery state
transitions fail closed for a stale token; external source/provider/object-store
effects and snapshot reconciliation remain outside the atomic fence.

Migration `0053_complaint_analysis_snapshots.sql` persists one validated,
versioned derived classification/entity-resolution snapshot per complaint and
upgrades historical run snapshots without changing source evidence. The private
opportunity read model now makes competitive-research state explicit: fixture
records are unresolved/synthetic, reviewed seeds are seed-only, and missing
permitted competitor evidence remains a visible gap. Live competitor and
substitute research remains unresolved.

Migration `0054_source_policy_review_integrity.sql` binds new source-policy
approvals to a lowercase reviewer identity, an independent review role, and an
explicit independence attestation. Historical approvals remain immutable audit
history but are returned to pending review until re-approved; no source is
activated by this migration.

Migration `0055_production_analysis_attempt_telemetry.sql` adds a bounded,
monotonic activity-attempt projection to production-analysis runs. The worker
passes the Temporal attempt as execution metadata, while the idempotency hash
continues to cover only the validated research input. Migration
`0056_production_analysis_attempt_history.sql` adds at most ten server-clock
attempt rows with stage heartbeats, duration, and fixed terminal failure codes;
the private status projection merges that history without exposing source
content, hashes, or object references.

The private campaign configuration slice now uses the existing
`research_campaigns` JSONB columns with a strict `campaign-v1` write contract
and a legacy read union. Owners/editors can create draft campaigns and all
members can list/read them. Source registry metadata, policy readiness,
fixture/non-fixture compatibility, approved-purpose checks, and
identifier-only audit/outbox receipts are enforced in the authenticated
repository. Migration `0057_research_campaign_lifecycle.sql` adds the archived
lifecycle state and narrowly grants user-editable name/purpose columns;
connector activation and workflow admission remain separate reviewed
boundaries.

The campaign run boundary now consumes that persisted intent through the
authenticated `POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`
route. It is intentionally one-source for this tranche: the route rechecks
the current approved policy, purpose, display mode, expiry, budget, and any
approved seed review, derives all collection inputs server-side, and commits
the existing idempotent admission before starting Temporal. Multi-source
orchestration and scheduling remain open. Campaign edits now replace draft
intent through a validated PATCH boundary, while DELETE archives without
deleting run/evidence lineage. The private
campaign surface now lists the latest 100 production workflow projections and
links completed runs to evidence inspection without exposing workflow hashes
or raw source payloads. Owners/editors can now choose an approved seed on the
collection page and launch an explicit downstream analysis. The linked private
status page/API reconciles safe Temporal state with a PostgreSQL projection,
validates workflow workspace prefixes, and excludes hashes, object references,
source payloads, and seed content. Migration `0055` records the highest
bounded Temporal activity attempt on the run without changing input idempotency;
`0056` now supplies bounded attempt timing and heartbeat history. Periodic
deployment alerting, scheduling, and production Temporal remain open.

The source coverage tranche adds a strict `workspaceSourceReadModel` and an
authenticated read-only registry at `/workspace/:workspaceId/sources` plus
`GET /api/workspaces/:workspaceId/sources`. It projects existing source-policy
rows without a migration, derives production collectibility from independent
approval evidence, and keeps quota, deletion duties, and coverage gaps
visible. No policy payload, reviewer identity, hash, or activation control
crosses the private read boundary.

### 2. Durable workflows

Status: fixture and production-collection workflow boundaries plus an
authenticated private-workspace start/status gateway are implemented and
validated by package tests; production workflow provisioning remains blocked.

Implemented:

- Temporal TypeScript workflow/client package with fixed version/task queue,
  sanitized history, deterministic idempotency/input hashes, duplicate-start
  conflict handling, status query, bounded retries, budget rejection,
  cancellation, safe-point completion, and terminal reconciliation
- PostgreSQL job/checkpoint projections, RLS, transition triggers, output lineage,
  and one-time cost/audit/outbox effects
- worker activity adapters, local Compose Temporal service, restart/replay smoke,
  retry/cancellation/duplicate tests, and raw-history leakage assertion
- web gateway with strict workspace/body matching, owner/editor and fixture-only
  authorization, private status projection, and production-fail-closed Temporal
  address/TLS/API-key configuration; authenticated starts bind a user principal
  and service starts use an explicit worker principal in the durable job and
  terminal audit event
- production collection workflow with a separate PostgreSQL job/checkpoint
  projection, policy trigger, source-item budget preflight, idempotent
  persistence safe point, terminal reconciliation, hashed cross-entry
  idempotency, and user/service actor attribution
- post-collection `productionAnalysisWorkflow` v2 and worker activity that pass
  only a hashed idempotency digest plus workspace/collection/analysis/seed
  identifiers to Temporal; the activity reconstructs the artifact from
  workspace-bound rows before calling the idempotent analysis repository
- migration `0038_production_workflow_ingress_admission.sql` adds a database-
  serialized per-workspace start rate/concurrency gate before Temporal;
  replayed digests do not consume another slot, workflow initialization
  consumes reservations, and bounded source maintenance purges terminal or
  expired admission rows
- migration `0042_production_analysis_ingress_admission.sql` adds the reviewed
  manual-analysis admission ledger: the private route binds an authenticated
  user actor, reserves a digest/input hash before Temporal, and the worker
  consumes/releases the reservation with run persistence; actor identity is
  immutable, owner/editor membership is checked at insert, and consumed or
  released digests replay without another slot
- private reviewed-analysis launch action plus status page/API: the collection
  page offers approved seed reviews only to owner/editor members; the status
  contract is strict, workflow-prefix bound, and reconciles Temporal with the
  authenticated PostgreSQL projection without exposing hashes or object refs
- the production runner acquires a digest-only source lease before the fetch,
  supplies its immutable observed timestamp to complaint/quota provenance, and
  passes the lease into a same-transaction persistence assertion; the lease is
  released only after commit
- explicit tombstone-bound re-collection uses completed deletion lineage,
  exact source-native lookup, active-row uniqueness, and fail-closed mismatch
  handling; no maintenance or quota-reconciliation path triggers it
- the CFPB snapshot runner fetches only unfiltered identifier pages, resumes
  from durable offsets without the raw caller key, records visible coverage
  gaps for malformed/capped traversals, and emits tombstones only after a
  warning-free short page
- the private source-reconciliation route admits only active owner/editor
  requests; the direct worker command uses a separate explicit service
  principal, and both paths share the same policy-gated durable job projection
- migration `0034_production_analysis_handoffs.sql` adds an approved-seed-bound,
  skip-locked handoff queue written in the collection completion transaction;
  the durable worker reconstructs active policy/evidence lineage and starts the
  existing idempotent analysis workflow with crash-reclaimable dispatch claims.
  The private production collection read model exposes bounded handoff state,
  retry, and failure metadata without exposing raw idempotency keys or source
  payloads.

Remaining production work: legacy v1 history drain/retention for the analysis
workflow, deployed Temporal topology and namespace/task-queue authorization,
HA, provider object-store/backups retention and purge, deployment, metric
aggregation/alerts, deployed
snapshot scheduler ownership, and worker crash fault-injection proof. Migration `0037` now queues deletion-triggered
active-evidence repairs and the dispatcher reclaims stale dispatch claims with
bounded terminal failure; deployed scheduling, alerting, and production
Temporal remain open. The repository-level collection and manual-analysis
ingress gates are now implemented; deployed scheduler ownership,
service-role/secret separation, and infrastructure authorization remain
separate release work.

### 3. First real connector

Status: connector boundary and production collection workflow implemented and
disabled pending policy approval and deployment proof.

Implemented:

- CFPB public JSON search connector with typed policy metadata, official-route
  boundary, conservative request/run quotas, no credentials, provenance mapping,
  narrative consent/scrubbing gate, malformed-record warnings, and full-snapshot
  deletion events; the connector requires the durable quota capability outside
  tests
- the production runner binds the request to the approved policy review and
  does not fetch without a durable lease; the CFPB source remains disabled
  pending legal/privacy/security approval
- deterministic synthetic HTTP fixtures covering disabled/pending/expired
  policy, quota, malformed, partial, and deletion paths
- identifier-only CFPB snapshot pages use the unfiltered official route,
  durable quota idempotency, bounded malformed-ID warnings, and no narrative
  retention; the reconciliation worker finalizes only from a warning-free
  short page
- explicit, one-record tombstone re-collection uses the official complaint
  route, preserves the deleted predecessor, and emits no deletion tombstone;
  the connector remains disabled pending review
- source-policy record at `docs/product/cfpb-source-policy.md`

Remaining: assign legal/privacy/security owners, confirm intended commercial use
and retention/display terms, approve a policy version, then activate only through
the reviewed source registry. Migration `0027` now records that review and the
runtime can persist an approved CFPB collection checkpoint through either the
bounded command or the production-collection Temporal boundary, with idempotent
source/evidence/complaint/deletion lineage plus a private inspection route. A
separate production-shaped offline analysis checkpoint now composes validated
collection payloads into clusters, an explicitly seeded opportunity, a
deterministic score, a generic report, and a generic coding package. It remains
test-only and does not activate a source or public UI. The additive contract
now carries policy review hashes, distinct analysis-run identity,
evidence/source-item mappings, and a reviewed seed envelope resolved from the
workspace seed-review registry. Migration `0033` and the private seed-review
routes now persist immutable seed content and editor/owner approval state.
Durable analysis
persistence/reference wiring, an idempotent post-collection repository, a
Temporal activity, an opt-in approved-seed handoff queue, a deletion-triggered
recomputation queue, and private active-output reads are implemented after a
completed collection; live activation, cloud object-store deployment, deployed
scheduling, and handoff/recomputation alerting remain open. Source deletion now
invalidates/de-ranks mutable opportunity projections through migration `0035`.
Migration `0036` allows an explicit reviewed analysis over the remaining active
evidence to re-cluster and reactivate only after its new output is linked; it
does not automatically re-collect deleted evidence. Migration `0037` queues a
recovery analysis from that active evidence and waits for an approved immutable
seed before dispatch. The private
review-start route now reconstructs the confirmed collection subset and starts
the durable workflow explicitly; the local adapter does not
authorize a production source activation.

### 4. Workspaces and authentication

Status: first private-workspace slice implemented; production identity operations remain.

Implemented:

- bounded shared auth/session/workspace contracts
- scrypt password hashing, opaque bearer-session hashing, expiry, and revocation
- private workspace signup with owner membership
- membership-checked transaction helper before setting forced-RLS context
- owner-only member listing, role changes, and removal with a last-owner database guard, audit, and outbox events
- password step-up for owner membership mutations with a 15-minute session window
- existing-account workspace invitations with hash-only tokens, encrypted delivery outbox, owner step-up, acceptance/revocation, bounded retries, and a production kill switch
- authenticated active-session inventory at `/account/security` and same-origin, reauthenticated revocation of another session
- owner-safe account closure at `/account/security`: recent step-up plus typed confirmation, session/reset revocation, profile anonymization, and workspace-owner blockers while shared research remains retained
- private workspace opportunity/evidence/report/plan reads behind web API routes
- private campaign configuration page and list/create/read API with source
  policy readiness metadata and draft-only, non-activating writes
- public leaderboard remains database-free and explicitly synthetic

Remaining: verified account recovery/delivery policy, production
secret/session-retention operations, MFA/OIDC, and external identity review.
Recovery and invitation mechanics exist behind explicit production kill
switches; invitations intentionally do not create accounts until identity policy
is approved.
Login/signup/reauthentication throttling and membership administration are
durable but require scheduled cleanup and distributed deployment validation.

### 5. Evidence and reports

Status: private evidence inspection, source-policy coverage, complaint curation, immutable seed review/approval, reviewed analysis-start, deterministic report
generation, stored report/plan reads, report approval governance, approved JSON
export, a separate approved-source collection evidence view, durable production
analysis/object references, active-output private reads, and a
production-shaped report/package composition checkpoint, and a persisted
versioned complaint classification/entity-resolution checkpoint are implemented;
cloud object storage, recomputation alerting, and export retention remain. Report and plan
approval/export now hydrate validated object-backed production payloads before
applying their separate governance boundaries. Production analysis read models
carry the linked report/plan approval states from PostgreSQL so private
opportunity pages do not infer stale draft defaults.

The report contract keeps retained observations and their derived analysis,
deterministic score inference,
contrary evidence, recommendation, source coverage, and coverage gaps separate.
Private opportunity reads now expose a separate competitive-research coverage
record and competitors/contrary-signals route; it does not promote reviewed
seed assumptions to source-backed market evidence.
Reports are versioned in `report_versions` and linked to their plan package. Reads
exclude inactive source rows and non-redacted non-fixture evidence.
Approval transitions are role-checked in the private API and guarded by migration
`0022_report_approval_governance.sql`; only approved reports can be exported.

### 6. Operations

Status: bounded worker events, workflow budgets, schema-validated/idempotent
auth and source maintenance runners with stable job IDs, independent quota,
snapshot-resume, and retention budgets, source-policy warnings, centralized source-quota
reservations, owner-scoped all-workspace maintenance, policy-derived retention
tombstones, terminal/expired source-lease purge, server-clock stale-claim
recovery, bounded identifier-only snapshot resume with terminal/retry/coverage
counters, bounded retryable deletion propagation, and retryable password-recovery/workspace-invitation
delivery are implemented. Deletion propagation durably queues source-scoped
active-evidence recomputation jobs with bounded retries, blocked-seed recovery,
and Temporal-start idempotency. Production collection now carries settled source
request cost from quota settlement through its immutable snapshot/result,
workflow checkpoint, and audit/outbox metadata; known policy-cost overages are
rejected before source lease acquisition;
scheduled commands now share migration `0046`'s server-clock owner/token lease
with renewal, stale takeover, migration `0052` transaction fencing for selected
SQL mutations, and fixed lease-loss failures;
`0047` persists maintenance-role-only run outcomes with bounded
numeric counters, fixed failure codes, and retention purge;
`0048` adds an indexed, membership-authorized private workspace cost summary
over the immutable ledger with exact micro-unit aggregates by currency and
cost type;
the long-lived worker emits a bounded 30-second heartbeat and the web service
exposes fail-closed liveness/readiness probes; deployed scheduler ownership,
alert ownership, traces, role separation, incident drills,
and production security review remain. Provider idempotency, object-store
conditional-delete, deployed scheduler ownership, and Docker-backed lock
recovery proof remain open.

### 7. Desktop release

After web stability, complete Tauri packaging, signing, updates, platform tests, and release documentation for Windows and macOS.
