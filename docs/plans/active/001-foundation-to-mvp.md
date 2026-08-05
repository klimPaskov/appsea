# Plan 001: Foundation to production MVP

- Status: active
- Owner: main coding agent
- Started: 2026-07-10
- Current audit: [`production-readiness-audit-2026-08-04.md`](../../status/production-readiness-audit-2026-08-04.md)

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

- PostgreSQL 18 schema and one hundred one forward, checksummed migrations
- normalized source, evidence, complaint, cluster, competitor, opportunity, score, report, plan, audit, cost, deletion, outbox, and lineage tables
- no-login owner, separate migrator, and least-privilege runtime role contract
- forced workspace RLS and transaction-scoped workspace context
- source collection and evidence display policy gates
- immutable, run-scoped score, plan, cluster, source-policy, and acquisition lineage
- replay-safe fixture repository with concurrent idempotency conflict handling
- populated upgrade, fresh install, privilege, RLS, provenance, policy, cross-wire, and replay tests
- local runbook and CI persistence gate
- isolated local PostgreSQL backup/restore runbook and CI gate; the drill
  restores a disposable dump through all one hundred one migrations and verifies
  forced workspace RLS plus runtime/maintenance privileges without accepting a
  remote URL
- one-command loopback private-workspace stack with migration, worker, and web
  startup (`pnpm dev:local`), including disposable MinIO bucket initialization
  and signed S3-compatible object-store configuration
- end-to-end loopback stack smoke (`pnpm verify:local-stack`) covering
  dependency readiness, migrations, worker/web startup, authenticated
  private-workspace signup, owner-authorized manual intake through durable
  consumption, every private workspace page with encoded identifiers, auth
  pages, fixture disclosure, and Compose cleanup in CI; the smoke row is not
  market evidence
- PostgreSQL-backed source quota reservations shared across workspaces, with
  idempotent commit/release and bounded expiry
- policy-derived, bounded retention tombstone enqueue reusing the deletion
  propagation path
- content-addressed object-reference contract with deterministic in-memory,
  local filesystem, and signed S3-compatible adapters for production analysis
  artifact/report/plan blobs; migration `0043` now queues complete invalidated
  output references and the adapters perform retention-aware mark/purge retries;
  provider encryption, lifecycle/versioning, destructive workspace closure,
  exports, and backup purge remain open; owner archival is implemented as a
  separate non-destructive boundary
- durable production-analysis run, policy/evidence/output lineage, report
  object-reference, RLS, terminal-transition, and source-deletion invalidation
  migration; idempotent repository stores redacted artifact/report/plan objects
  and deterministic projections
- production opportunity projections now persist as `candidate` until an
  explicit deep-research gate proves source-backed competitive evidence and
  reviewed checklist coverage; migration `0100` repairs legacy non-synthetic
  rows while migration `0101` persists the append-only gate and stale-snapshot
  read validation, leaving fixture lifecycle state unchanged. The private
  competitors route now exposes the same checklist for editor submission and
  owner pass/withdraw actions; the API and database remain authoritative and
  still reject incomplete or stale evidence.
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
- secret-free `pnpm production:preflight` validates production database role
  separation/TLS, authenticated Temporal, the exact reviewed
  `appsea-research-v1` task queue declaration, signed object storage, scheduler
  ownership, HTTPS origin, delivery switches, and trusted-proxy configuration
  without contacting dependencies or activating a source; the provider
  namespace/task-queue ACL remains deployment evidence

Migration `0066_workspace_archival.sql` adds an owner-only, step-up-backed
workspace archival boundary. It blocks while durable workflow/run/handoff/
lease/reconciliation/recomputation work is active, archives campaign refresh
state, revokes pending invitations, and records identifier-only audit/outbox
receipts. Research lineage and object/export/backup references remain intact;
destructive purge is a separate reviewed retention operation.

Migration `0067_field_level_evidence_redaction.sql` adds a policy-bound,
owner/editor-only redaction receipt. It masks selected evidence fields in
private collection, analysis, and report reads while preserving source
identifiers, capture/policy lineage, content hashes, and immutable analysis
snapshots. Text redaction requires the raw source reference to have already
been removed through the source-policy deletion path; cloud/backup purge and
downstream recomputation remain separate deployment work.

The owner-only purge-readiness projection and private members-page inventory
now expose bounded active-work and raw/analysis/report/plan object-reference
counts. Its `database_ready` state is a PostgreSQL checkpoint only; the
response always names cloud object-store purge, export-retention purge, and
backup deletion verification as external requirements. Migration `0073` adds a
forced-RLS owner-confirmed purge-intent ledger with idempotent request and
cancellation functions, identifier-only audit/outbox receipts, and private
members-page/API controls. The intent snapshots `database_ready` but remains
`awaiting_external_controls`; it never queues or performs destructive deletion.

Migration `0083_workspace_purge_manifests.sql` adds a separate archived-owner
manifest boundary. The private members page and API collect only sorted,
deduplicated workspace-bound object URI/kind pairs from persisted source,
report, plan, and production-analysis references. A deterministic SHA-256 hash
and manifest ID make replay idempotent; the database-generated manifest expires
after 24 hours, and audit/outbox receipts store only identifiers, hash, count,
and expiry. The manifest is metadata for external coordination, not approval
and not a delete command.

Migrations `0084_workspace_archival_function_qualification.sql` and
`0085_workspace_purge_manifest_read_only.sql` are append-only PostgreSQL 18
repairs: the first qualifies the archival function's workspace predicates, and
the second keeps the private manifest read compatible with a read-only
transaction. Migration `0086_auth_mfa_key_versions.sql` adds a version to every
encrypted TOTP secret, and migration `0087_auth_mfa_rotation_events.sql` adds
an identifier-only rewrap event. Current/previous-key configuration,
transactional opportunistic rewrap, a bounded dormant-account rewrap command,
and a count-only operator status command are now covered. Migration
`0088_auth_oidc_identities.sql` adds the optional global external-identity
table, MFA-bound service-only link/unlink/sign-in functions, and account-closure
cleanup. The web
boundary verifies discovery, state/nonce/PKCE, RS256 JWKS signatures, audience,
freshness, and `email_verified`; it links only an existing account after
password/MFA step-up and never auto-links by email. The provider switch remains
disabled by default, and production preflight requires an explicit reviewed
deployment attestation when it is enabled. The CI release workflow now runs
the complete `pnpm verify` fixture/build/route-smoke proof with read-only
repository permissions and bounded stale-run cancellation.

The invalidated production-analysis output queue is a deliberate narrow slice:
it does not claim source-wide retention purge, cloud backup deletion, or
destructive workspace-closure deletion (archival is separate).

Migration `0089_manual_owner_import.sql` adds the first usable non-fixture
intake path. An authenticated workspace owner can stage a bounded CSV/JSON
export after an explicit authority attestation; the connector allow-lists and
PII-scrubs fields, stores only normalized tenant-private rows, and sends only
the batch identifier through Temporal. Collection consumes the staged batch in
the same transaction as source/evidence persistence. Owner deletion clears
staged payloads and emits existing deletion tombstones. This path is not public
market coverage, does not fetch imported URLs, and does not activate CFPB,
Stack Exchange, or any other third-party source. See
[`manual-import-source-policy.md`](../../product/manual-import-source-policy.md)
and [`manual-import.md`](../../runbooks/manual-import.md).
The private `/workspace/:workspaceId/imports` screen provides the owner upload,
metadata-only batch history, collection follow-up, and deletion action while
leaving the public leaderboard unchanged.
The PostgreSQL integration suite also exercises the staged/replayed/consumed/
deleted lifecycle, forced-RLS owner boundary, payload clearing, and tombstone
propagation; the fresh local Docker stack now runs this smoke path successfully.
The worker activity reconstruction preserves the staged batch identifier when
Temporal invokes the identifier-only persistence boundary, with a regression
test covering the owner-import path.
Migration `0090_manual_import_policy_read_gate.sql` keeps the runtime policy
check behind a narrow security-definer decision function instead of requiring
row-lock privileges on global source tables.
Migration `0091_manual_import_delete_state.sql` preserves `consumed_at` when
an already-consumed owner batch is later deleted.
Migration `0092_campaign_source_read_privileges.sql` explicitly grants the
runtime service role the source and reviewed-policy reads required by private
campaign admission.
Migration `0093_source_quota_reservation_column_qualification.sql` qualifies
quota reservation columns that collided with function OUT parameters.
Migration `0094_production_run_snapshot_update_privilege.sql` grants the worker
the narrow finalization update for `research_runs.artifact_snapshot`.
Migration `0095_workspace_purge_readiness_lease_grant.sql` grants the
authenticated runtime only the `workspace_id` and `state` lease columns needed
for the private members purge-readiness count; lease lifecycle mutations and
other lease columns remain maintenance-only.

Migration `0096_opportunity_score_v1_envelope.sql` adds nullable, range-checked
balanced v1 score fields, reviewed evidence/coverage/freshness references, and
a private ranking index. Legacy score rows remain readable and keep `score` as
their raw-score compatibility field. `pnpm verify:backup-restore` now passes
through `0096`; provider backup, HA, retention, and production restore remain
deployment work.

Migration `0097_mcp_agent_access_admission.sql` rechecks workspace membership
for bearer authentication and adds a forced-RLS request-lease projection. The
repository-owned MCP gate allows 60 requests per 60-second token window, four
in-flight requests, and a 30-second server-clock lease with stale recovery.
The web handler releases leases in a `finally` path and returns bounded
`Retry-After` responses. Edge limiting, secret storage, and deployment
monitoring remain external controls.

Migration `0098_audit_event_history_index.sql` adds the ordered workspace
index for the private audit-history projection. The authenticated
`GET /api/workspaces/:workspaceId/audit-events` route uses the existing forced
RLS transaction and an opaque time/id cursor; its strict read model keeps only
bounded identifiers and scalar metadata, filtering nested values and never
exposing raw source payloads or exception text.

Migration `0099_runtime_skill_governance.sql` adds global runtime-skill records
and immutable transition events behind forced RLS. The operator-only repository
hydrates every record through the HMAC registry, persists with expected-hash
concurrency, replays event IDs safely, and requires an `operator:` actor for
privileged activation. Service, maintenance, and worker paths have no table or
function access; this remains a dormant reviewed adapter rather than an
autonomous skill activation loop.

Remaining deployment work and the non-fixture object-store integration are
tracked in `docs/status/known-gaps.md` and are not part of the completed
repository persistence foundation. The local backup/restore drill is repository
evidence only; encrypted provider backups, HA, retention/deletion, and
production restore/failover remain deployment work.

Migration `0049_source_quota_reconciliation.sql` adds a forced-RLS case
projection for committed source reservations that lack a completed production
result. Authenticated workspace inspection is bounded and no-store; the
standalone maintenance role can record only an exact linked result or an
explicit no-result void. The boundary never refunds quota or authorizes a
re-fetch. A lease-owned read-only alert inspection now emits fixed
alert/incomplete/clear events and durable bounded counters while exposing
truncated coverage. Alert/incomplete/failure outcomes now use the shared
scalar-only operational alert outbox and signed delivery boundary;
`pnpm worker:alerts:deliver` recovers stale/retryable claims, while deployed
scheduler ownership, endpoint operations, provider recovery, and incident
response remain open.

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
substitute research remains unresolved. Migration
`0059_competitor_research_observations.sql` adds a separate bounded claim table:
non-synthetic rows must reference an active source item/evidence pair collected
under an independently approved `competitor-research` purpose, and an
editor/owner must confirm the row before it can make the read model
source-backed. No connector is activated by this migration.

Migration `0063_competitor_feature_matrix.sql` adds a normalized, bounded
JSONB feature matrix to competitor rows. Fixture entries are labelled
synthetic, production seeds accept only `reviewed-seed` assumptions, and
source-backed or mixed entries require retained competitive observation IDs.
The public and private competitor routes render the matrix and its evidence
basis without exposing raw provider payloads. Source-backed matrix population
remains blocked until an approved competitor-purpose connector is available.

Migration `0060_source_canonical_locator_integrity.sql` adds a database-level
HTTP(S) host/path check for persisted attribution locators. The TypeScript
contract remains the primary validator, while the constraint is defense in
depth for direct database writers.

Migration `0061_complaint_analysis_corrections.sql` adds an immutable,
editor/owner correction history for derived complaint analysis. The correction
function keeps source evidence/provenance immutable, invalidates active
analysis/opportunity projections, and requires an explicit new reviewed
analysis before stale report/plan outputs can reappear. The private evidence
view now exposes field-level controls for the derived snapshot and entity
references; source provenance and entity evidence basis remain read-only. The
next analysis input carries the corrected snapshot. Migration
`0062_correction_recompute_jobs.sql` extends the existing forced-RLS repair
queue with a deferred correction trigger; each affected opportunity receives
one deterministic re-analysis request, while missing or withdrawn seeds remain
blocked. The feature-matrix contract, migration, fixture persistence, and
public/private read surfaces are implemented in migration `0063`; source-backed
matrix population remains an external policy and evidence dependency.

Migration `0064_recompute_alert_read_boundary.sql` adds a maintenance-only,
bounded projection for inspecting open recomputation repairs. The worker
command uses a scheduler lease, emits fixed alert/incomplete/clear events, and
keeps failed, blocked, stale, age, and truncation state visible without
claiming, retrying, resolving, dispatching, or starting Temporal work. Deployed
scheduler ownership, endpoint operations, and incident response remain
deployment responsibilities.

Migration `0065_cost_alert_read_boundary.sql` adds a maintenance-only,
bounded currency aggregate for deployment cost-threshold inspection. The
worker compares one configured currency using exact micro-unit strings;
unsupported currencies and capped scans remain incomplete. It does not block
admission, convert prices, or provide billing authorization.

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

Migration `0058_campaign_refresh_scheduler.sql` adds server-owned due times,
crash-recoverable claim tokens, pending source-policy-bound request lineage,
bounded attempts, and fixed failure state to the campaign aggregate. The
existing lease-backed source-maintenance worker claims and dispatches due
non-fixture campaigns through the same policy and production admission gates
as manual starts; archive and draft edits clear pending claims. Deployment
Temporal, scheduler ownership, and external CFPB approval remain open.

The campaign run boundary now consumes that persisted intent through the
authenticated `POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`
route. One-source starts recheck the current approved policy, purpose, display
mode, expiry, budget, and any approved seed review, derive all collection
inputs server-side, and commit the existing idempotent admission before
starting Temporal. Migration `0068_research_campaign_orchestration.sql` adds
the reviewed multi-source slice: an idempotent parent request and one durable
child per configured non-fixture source, forced-RLS claims, bounded retries,
service-principal admission, existing Temporal starts, and child-to-parent
reconciliation. Campaign edits now replace draft
intent through a validated PATCH boundary, while DELETE archives without
deleting run/evidence lineage. The private
campaign surface now exposes bounded cursor-paginated one-source and
multi-source workflow history, with a dedicated private history route and
stable request-time/identifier cursors; completed runs still link to evidence
inspection without exposing workflow hashes or raw source payloads.
Owners/editors can now choose an approved seed on the
collection page and launch an explicit downstream analysis. The linked private
status page/API reconciles safe Temporal state with a PostgreSQL projection,
validates workflow workspace prefixes, and excludes hashes, object references,
source payloads, and seed content. Migration `0055` records the highest
bounded Temporal activity attempt on the run without changing input idempotency;
`0056` now supplies bounded attempt timing and heartbeat history. Signed
alert delivery covers bounded outcomes; deployed scheduler ownership and
production Temporal remain open; repository-level campaign refresh and multi-source dispatch are
implemented locally. Draft campaign forms now select from the private source
registry while retaining visible pending-policy states. Deployed Temporal and
scheduler crash/retry proof, live source-policy approval, and Docker-backed
integration remain release gates.

The source coverage tranche adds a strict `workspaceSourceReadModel` and an
authenticated read-only registry at `/workspace/:workspaceId/sources` plus
`GET /api/workspaces/:workspaceId/sources`. It projects existing source-policy
rows without a migration, derives production collectibility from independent
approval evidence, and keeps quota, deletion duties, and coverage gaps
visible. No policy payload, reviewer identity, hash, or activation control
crosses the private read boundary.

Migration `0069_agent_access_tokens.sql` adds the first authenticated
coding-agent access boundary. Owners of active private workspaces can issue,
list, and revoke expiring scoped tokens after recent step-up authentication;
only token hashes are persisted. `POST /api/mcp` accepts those bearer tokens
and exposes workspace-bound, read-only opportunity, evidence, source-coverage,
report, and plan reads. Scope filtering, evidence representation policy,
coverage gaps, synthetic disclosure, and report/plan approval gates are
enforced in the handler. Workflow starts, connector activation, policy
changes, deletion, deployment, and credential operations remain outside MCP.
The private owner workspace now also exposes `/workspace/:workspaceId/agent-access`
for least-privilege token creation and revocation; the raw token is shown only
in the immediate create response and later reads remain metadata-only. See
[`mcp-agent-access.md`](../../runbooks/mcp-agent-access.md).

Private workspace members can inspect exact cost-ledger totals and settled
source-quota reconciliation cases at `/workspace/:workspaceId/usage`. The page
is read-only; maintenance-role resolution, quota refunds, and source re-fetches
remain outside the browser boundary.

Migration `0070_research_campaign_orchestration_cancellation.sql` adds an
immutable owner/editor cancellation intent to multi-source orchestration. The
private cancellation route commits the intent before a best-effort Temporal
cancel, queued children are stopped transactionally, and the lease-backed
worker retries started-child cancellation and reconciles the parent at a safe
terminal boundary. Dispatching claims remain claim-owned until a workflow
identity is recorded, preventing an orphan external start. Migration `0071`
adds the matching owner/editor intent and maintenance retry boundary for
one-source production workflow jobs; the workflow still owns safe terminal
reconciliation. Deployed scheduler/Temporal authorization and crash-drill
proof remain open.

### 2. Durable workflows

Status: fixture and production-collection workflow boundaries plus an
authenticated private-workspace start/status gateway are implemented and
validated by package tests; production workflow provisioning remains blocked.

Implemented:

- Temporal TypeScript workflow/client package with fixed version/task queue,
  production preflight allowlisting the declared `appsea-research-v1` queue,
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
  workspace-bound rows before calling the idempotent analysis repository; new
  starts carry a strict identifier-only history memo and the bounded
  visibility-only legacy-history checker refuses an unreviewed worker drain
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
  passes a worker-owned lease assertion into the connector immediately before
  each external request; a denied preflight releases the reserved quota and
  fails closed without HTTP. Persistence also receives the lease for a
  same-transaction assertion and releases it only after commit. The preflight
  check and provider socket call are not an atomic database transaction, so
  deployment-level revocation drills remain required
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
- the long-lived worker has an idempotent SIGINT/SIGTERM lifecycle that shuts
  down Temporal, stops heartbeat and dispatch loops, awaits their drain, and
  closes database/Temporal connections before process exit.

Remaining production work: run the legacy v1 history checker against the
authenticated deployment and complete its separately approved archive/
retention operation; deployed Temporal topology and namespace/task-queue authorization,
HA, provider object-store/backups retention and purge, deployment, metric
aggregation/alerts, deployed
snapshot scheduler ownership, and worker crash fault-injection proof. Migrations
`0037` and `0062` now queue deletion- or correction-triggered
active-evidence repairs and the dispatcher reclaims stale dispatch claims with
bounded terminal failure. Migration `0064` provides a separate bounded
maintenance-role alert inspection; migration `0082` adds a scalar-only durable
operational-alert outbox, stale-claim recovery, bounded retries/exhaustion,
retention purge, and a supervised `worker:alerts:deliver` drain. Deployed
scheduling, endpoint operation, provider recovery, and production Temporal
remain open. The repository-level collection and manual-analysis
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
- disabled Stack Exchange candidate at `packages/connectors/src/index.ts`,
  with official API origin pinning, bounded sanitized excerpts, HTTPS
  attribution locators, optional secret-bound API key, quotas, and explicit
  no-tombstone coverage warnings; see
  `docs/product/stackexchange-source-policy.md`
- the production collection workflow and scheduled refresh dispatcher select
  only the CFPB or Stack Exchange connector after the database returns a
  matching approved source-policy snapshot; the Stack Exchange review CLI
  registers or approves it only through the operator boundary

Remaining: assign legal/privacy/security owners, confirm intended commercial use
and retention/display terms, approve a policy version, then activate only through
the reviewed source registry. Migration `0027` now records that review and the
runtime can persist an approved CFPB collection checkpoint through either the
bounded command or the production-collection Temporal boundary, with idempotent
source/evidence/complaint/deletion lineage plus a private inspection route. A
separate production-shaped offline analysis checkpoint now composes validated
collection payloads into clusters, an explicitly seeded opportunity, a
deterministic score, a generic report, and a generic coding package. The
reviewed seed contract now also supports an additive balanced v1 score
envelope with risk-adjusted ranking, confidence, coverage, freshness, and
component explanations; seeds without that envelope retain the legacy score
with a visible gap. It remains test-only and does not activate a source or
public UI. The additive contract
now carries policy review hashes, distinct analysis-run identity,
evidence/source-item mappings, and a reviewed seed envelope resolved from the
workspace seed-review registry. Migration `0033` and the private seed-review
routes now persist immutable seed content and editor/owner approval state.
Durable analysis
persistence/reference wiring, an idempotent post-collection repository, a
Temporal activity, an opt-in approved-seed handoff queue, a deletion- or
correction-triggered
recomputation queue, and private active-output reads are implemented after a
completed collection; live activation, cloud object-store deployment, deployed
scheduling, and handoff/recomputation alert endpoint operation remain open. Source deletion now
invalidates/de-ranks mutable opportunity projections through migration `0035`.
Migration `0036` allows an explicit reviewed analysis over the remaining active
evidence to re-cluster and reactivate only after its new output is linked; it
does not automatically re-collect deleted evidence. Migration `0037` queues a
recovery analysis from that active evidence and waits for an approved immutable
seed before dispatch. The private
review-start route now reconstructs the confirmed/corrected collection subset and starts
the durable workflow explicitly; the local adapter does not
authorize a production source activation. Stack Exchange remains unregistered
and pending independent attribution, privacy, deletion, and commercial-use
review; its connector is fixture-tested and registry-selected in the worker,
but no source-policy row is registered or active in this repository.

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
- optional, disabled-by-default OIDC identity linking/sign-in with explicit
  issuer/subject binding, state/nonce/PKCE and ID-token verification,
  step-up-protected link/unlink, and MFA-aware challenge handoff
- owner-safe account closure at `/account/security`: recent step-up plus typed confirmation, session/reset revocation, profile anonymization, and workspace-owner blockers while shared research remains retained
- private workspace opportunity/evidence/report/plan reads behind web API routes
- migration `0081_auth_mfa_step_up.sql` and the private MFA step-up route now
  require a fresh second factor before password-gated high-risk mutations when
  MFA is enabled; the marker is session-bound and expires with the existing
  fifteen-minute step-up window. This covers account closure, session
  revocation, membership/invitation changes, workspace archival, purge intent,
  evidence redaction, owner agent-token issue/revoke, report and plan approval,
  opportunity-seed review, production complaint review/correction, and
  competitor observation create/review through the shared
  `requireRecentMutationStepUp` server gate.
- private campaign configuration page and list/create/read API with source
  policy readiness metadata and draft-only, non-activating writes
- public leaderboard remains database-free and explicitly synthetic

Remaining: verified account recovery/delivery policy, production
secret/session-retention operations, live OIDC provider/verified-email policy,
provider-backed step-up, approved deployment/status review for MFA key rotation,
and explicit contracts for unrelated high-impact mutations that do not have a
password-step-up boundary (for example, future source-policy or deployment
operations). The AppSea-owned TOTP boundary is implemented in migrations
`0080`/`0081`/`0086`/`0087` with encrypted enrollment secrets, hash-only recovery
codes, expiring login challenges, a session-bound MFA step-up marker for
password-gated high-risk mutations, and account-security routes; external
provider approval and identity-provider operations remain separate.
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
versioned complaint classification/entity-resolution checkpoint and derived
correction invalidation boundary are implemented;
cloud object storage, recomputation alert endpoint operation, and export retention remain. Report and plan
approval/export now hydrate validated object-backed production payloads before
applying their separate governance boundaries. Production analysis read models
carry the linked report/plan approval states from PostgreSQL so private
opportunity pages do not infer stale draft defaults.
The private report and plan pages now expose the same governance boundary in
the browser: editors can mark generated artifacts reviewed, owners can approve
or withdraw them, viewers remain read-only, and the plan page surfaces the
readiness blocker before an approval attempt. These controls are a client
projection only; the existing same-origin API, step-up check, and database
transition guards remain authoritative.

The report contract keeps retained observations and their derived analysis,
deterministic score inference,
contrary evidence, recommendation, source coverage, and coverage gaps separate.
Balanced v1 reports preserve raw, risk-adjusted, ranking, uncertainty, and
evidence-confidence semantics from the reviewed score snapshot; legacy fixture
reports continue to expose the v0.2 raw score. The ranking envelope is a
reviewed-input checkpoint, not calibration or live market evidence. Optional
artifact/report quality snapshots now record the versioned synthetic benchmark,
deduplication/clustering/ranking stability, and bounded calibration metrics;
they are regression evidence only and do not derive source coverage or market
evidence. The additive `research-quality-gate-v1.0.0` object and
`pnpm research:quality` check enforce explicit synthetic floors; they do not
calibrate live sources or authorize activation. Every balanced v1 factor now carries an explicit `source-evidence` or
`reviewed-seed` binding; production analysis checks source bindings against
retained complaint evidence and keeps reviewed-seed assumptions separate from
market evidence. See [`0027-score-factor-provenance.md`](../../adrs/0027-score-factor-provenance.md).
Complaint artifacts and reports now also carry an additive, versioned
provenance-linked `deduplication` array. Safe source-native duplicates are
collapsed, while high-similarity distinct records remain retained with a
human-review flag and visible coverage gap; legacy JSON artifacts default to
an empty array, so this slice requires no relational migration.
Private opportunity reads now expose a separate competitive-research coverage
record, per-claim provenance observations, and a competitors/contrary-signals
route; it does not promote reviewed seed assumptions to source-backed market
evidence. Observation creation/review is private and policy-gated through
`/api/workspaces/:workspaceId/opportunities/:slug/competitor-observations`.
Reports are versioned in `report_versions` and linked to their plan package. Reads
exclude inactive source rows and non-redacted non-fixture evidence.
Approval transitions are role-checked in the private API and guarded by migration
`0022_report_approval_governance.sql`; only approved reports can be exported.
The shared production seed contract now requires the six-file coding-package
manifest at new writes and analysis admission; legacy portable-path rows remain
readable for inspection but are blocked from analysis until replaced.

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
`0065` adds a lease-owned maintenance projection and cost-threshold alert
inspection while production preflight requires explicit comparison and
threshold settings; `0082` adds the maintenance-owned scalar operational-alert
outbox, v2 scheduler allowlist, bounded retries/exhaustion, retention purge,
and the durable drain;
the worker also exposes a supervised `maintenance:loop` command that starts
one lease-backed pass at a time, retries child failures with bounded backoff,
and forwards shutdown without logging raw errors;
the long-lived worker emits a bounded 30-second heartbeat and the web service
exposes fail-closed liveness/readiness probes; deployed process-supervisor
ownership, alert endpoint operations, traces, role separation, incident drills,
and production security review remain. A local/CI worker replacement drill now
force-stops a real worker during fixture persistence and verifies replacement
recovery, one-time PostgreSQL effects, and sanitized Temporal history through
`pnpm verify:worker:recovery`; hosted restore/failover proof remains open.
Provider idempotency, object-store conditional-delete, and deployed scheduler
ownership remain deployment responsibilities.

### 7. Desktop release

After web stability, complete Tauri packaging, signing, updates, platform tests, and release documentation for Windows and macOS.

### 8. Production runtime packaging

Status: repository container packaging is implemented and CI-built; provider
provisioning and operated deployment remain open.

Implemented:

- `Dockerfile.web` builds the Next.js standalone server and serves the existing
  health probes from a non-root runtime image.
- `Dockerfile.worker` packages the durable worker and reviewed preflight,
  migration, and maintenance entry points under a non-root runtime boundary.
- `infra/production/compose.yaml` gates web, worker, and maintenance on the
  one-shot production preflight, keeps migrations behind an explicit profile,
  binds web to loopback by default, and drops capabilities on long-lived
  services.
- GitHub CI validates the Compose model, builds both images, smoke-tests web
  liveness/health, and checks fail-closed worker preflight.
- `pnpm verify:release` adds a provider-neutral release boundary check for
  Compose topology, hardened image defaults, secret-free configuration, and
  fail-closed empty-environment preflight; CI runs its dynamic mode.

Remaining: push signed images through an approved registry, provision the
role-separated external services and secrets, run deployment/restore/crash
drills, and record provider/incident/source-policy evidence. The package does
not activate a source or perform a production migration automatically.

### 9. Desktop shell boundary

Status: the Tauri shell is compilable and security-bounded; a signed
Windows/macOS release remains open.

Implemented:

- Tauri build hook, committed Rust lockfile, deterministic PNG/ICO icons, and
  minimal capability file.
- Independent Windows and macOS CI compile/boundary checks.
- Restrictive local CSP with explicit development-origin allowance.
- Windows CI job for the desktop contract and Rust compile.

Remaining: hosted-origin review, updater trust, signed installers, macOS
notarization, platform installation tests, and desktop-specific release review.
