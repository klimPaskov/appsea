# Current status

- Version: `0.3.0`
- Stage: validated fixture product with production-shaped PostgreSQL persistence and a local/CI-proven durable workflow slice
- Production-readiness: not complete; see the current [`production-readiness-audit-2026-08-02.md`](production-readiness-audit-2026-08-02.md) and the historical [`production-readiness-audit-2026-07-25.md`](production-readiness-audit-2026-07-25.md)
- Website: implemented and freshly production-built; `pnpm verify` completed
  the current build, with Docker-only integration gates remaining unavailable
- Private workspace website/API: implemented and production-built; reads are membership-authorized and cache-disabled. Completed collection reads now expose the bounded private `analysisHandoff` status when an approved-seed handoff exists. Owner settings also expose a read-only purge-readiness inventory; it reports PostgreSQL blockers without authorizing deletion and keeps cloud/export/backup requirements visible.
- Fixture worker: implemented and tested
- Plan package generator: implemented and tested
- Evidence/report package: deterministic fixture report composer, a
  production-shaped offline analysis composer with policy/evidence provenance,
  reviewed seed registry and distinct analysis-run contracts, versioned report
  persistence, source-policy coverage metadata, private report rendering,
  approval governance, approved JSON export, a content-addressed
  object-storage seam with filesystem and signed S3-compatible adapters, and an explicit reviewed-evidence
  analysis-start route implemented. Production private opportunity reads also
  carry the linked report and plan approval states from PostgreSQL governance
  projections instead of inferring draft defaults from object payloads
- PostgreSQL persistence: sixty-eight forward, checksummed migrations plus least-privilege repositories, durable auth controls, owner-scoped member administration and existing-account invitations with session step-up, owner-safe account closure and non-destructive owner workspace archival, complaint review plus immutable seed-review and report/plan approval guards, field-level evidence redaction receipts and read-time masks, source quota reservations, policy-derived retention tombstones, deletion lineage, monotonic source/evidence/tombstone guards, migration-owner source-policy review/activation evidence with identity and independence attestation, a migration-owner maintenance enumerator, fixture and production-collection workflow checkpoints with principal attribution, deterministic complaint-analysis/entity snapshots, deterministic analysis handoff and deletion/correction-triggered recomputation queues, durable production-analysis lineage/object references, immutable analysis initiator attribution, source-deletion invalidation, mutable opportunity availability repair, same-run active-evidence re-analysis recovery, and database-serialized production ingress admissions through migrations `0036`-`0068`, plus a forced-RLS multi-source campaign orchestration parent/child queue with bounded claims, policy rechecks, service admission, and parent/campaign reconciliation, bounded monotonic production-analysis activity-attempt telemetry with server-clock attempt history, policy-bound source collection leases, identifier-only snapshot page checkpoints, warning-preserving retries, atomic full-snapshot tombstone finalization, retryable deletion propagation with bounded exhausted failure, manual analysis admission/replay limits, authenticated source-reconciliation admission, a worker-principal admission branch for the direct CFPB command, retention-aware invalidated analysis-object purge, a server-clock maintenance scheduler lease and transaction-fence boundary for selected SQL mutations, maintenance-role-only durable scheduler run metrics, an indexed private cross-run cost summary, a forced-RLS quota-reconciliation case ledger with maintenance-only resolution, explicit one-record tombstone-bound re-collection lineage, campaign edit/archive lifecycle receipts, crash-recoverable policy-gated campaign refresh claims, policy-gated per-claim competitor observations, a provenance-aware competitor feature matrix, a database-level HTTP(S) canonical-locator constraint, maintenance-only bounded recomputation-alert and workspace-cost projections
- Database verification: PostgreSQL 18 fresh-install and populated-upgrade lifecycle is covered by local/CI gates; this environment currently lacks Docker for a fresh rerun
- Production configuration preflight: `pnpm production:preflight` now validates secret-free role-separated database, authenticated Temporal, signed object storage, scheduler, public-origin, delivery-switch, proxy, and explicit cost-alert threshold configuration before startup; it does not connect, migrate, activate a source, or replace readiness checks
- Quota reconciliation alert inspection: `pnpm worker:source:quota:alert` now performs a lease-owned, read-only bounded scan across active workspaces, emits fixed alert/incomplete/clear events and durable scheduler counters, and keeps truncated coverage visible; deployment scheduler ownership and event routing remain open
- Production-analysis recomputation alert inspection: `pnpm worker:production:analysis:recompute:alert` performs a lease-owned, read-only bounded scan of deletion- and correction-triggered repairs through a maintenance-only projection; it emits fixed alert/incomplete/clear events and bounded failure/block/stale counters without dispatching or retrying work
- Workspace cost-threshold inspection: `pnpm worker:workspace:cost:alert` performs a lease-owned, read-only bounded scan of exact ledger aggregates for one configured currency and separate actual/estimated thresholds; unsupported currencies and truncation keep a non-alerting scan incomplete, and the command never blocks work or performs billing
- Native Codex skills: 21 synchronized skills
- Codex helper agents: 11 bounded agents
- Project memory: implemented and validated
- Documentation system: implemented and linked
- UI references: twenty-two deterministic sparse desktop/mobile reference
  sources; raster export awaits the local `cairosvg` dependency
- Real source connectors: CFPB connector boundary and policy metadata implemented, disabled pending legal/privacy/security approval; migrations `0027` and `0054` add operator-only draft/approval evidence with canonical reviewer identity and independence attestation, and the production collection checkpoint persists policy-bound non-synthetic source/evidence/complaint lineage when a reviewed version is explicitly activated. The disabled Stack Exchange candidate adds bounded official-API competitor/contrary collection, sanitized excerpts, and HTTPS attribution locators; the production worker and scheduled refresh now select it only from the approved source-policy registry, but it remains unregistered pending independent review. The direct CFPB command retains its dedicated worker-principal admission branch and cannot bypass the bounded production ingress ledger; no source is activated in this repository
- Production database deployment: not provisioned; the schema, repository, migrations, roles, RLS, and local/CI proof are implemented
- Authentication: private workspace signup/sign-in, hashed/revocable sessions with authenticated inventory and per-session revocation, durable login/signup/reauthentication/recovery/invitation/account-closure throttling, bounded retention, 15-minute password step-up for high-risk mutations, owner-scoped member role administration and existing-account invitations, membership authorization, private research read routes, single-use reset/invitation outbox mechanics, owner-safe account closure, and owner-only non-destructive workspace archival implemented; owner-only purge-readiness inspection is read-only and does not perform workspace/object/export/backup deletion; recovery and invitation delivery are kill-switched pending provider/identity review, while MFA/OIDC and external identity policy remain
- Durable workflow engine: fixture, production-collection, and post-collection production-analysis Temporal workflow/client boundaries, an approved-seed handoff queue with skip-locked stale-claim recovery, a deletion/correction-triggered recomputation queue with server-clock stale dispatch recovery and bounded exhausted-claim failure, a private collection read model for handoff state, PostgreSQL job/checkpoint/lineage projections, bounded retries, budget rejection, terminal reconciliation, authenticated private-workspace start/status routes, user/service attribution, and database-serialized per-workspace production start/admission gates are implemented and locally tested. Production analysis starts now use identifier-only workflow version `v2`; the worker reconstructs the artifact inside the activity so complaint text is not recorded in new Temporal histories. Web and worker connections now share fail-closed production TLS/API-key/namespace configuration. Production Temporal provisioning, namespace/task-queue authorization, HA, crash/failure drills, and a controlled drain plan for legacy v1 histories remain unimplemented.
- Source maintenance: bounded, schema-validated all-workspace PostgreSQL quota expiry/purge, production workflow admission and source-collection-lease purge, policy-derived retention tombstone enqueue, identifier-only full-snapshot reconciliation with durable page checkpoints, authenticated editor admission, explicit worker-principal service admission, a bounded one-per-workspace maintenance resume budget, multi-source campaign child claim/dispatch/reconciliation, and a private targeted resume command, skip-locked deletion propagation with server-clock stale-claim recovery, bounded retry and exhausted terminalization, retention-aware invalidated analysis output-object purge, opportunity availability invalidation/de-ranking, stable scheduler job IDs, migration `0046` server-clock acquire/renew/release ownership with per-acquisition tokens and a dedicated `appsea_maintenance` role, migration `0052` server-clock transaction fencing for selected SQL mutations, independent quota/snapshot/retention/orchestration budgets, secret-free structured counters, migration `0047` durable maintenance-run metrics with bounded retention, migration `0048` cost-ledger summary indexing, migration `0049` quota-reconciliation case discovery and maintenance-only resolution, private member inspection, retryable password-recovery/workspace-invitation delivery workers, and a lease-owned bounded quota-reconciliation alert inspection implemented through narrow migration-owner security-definer boundaries; the repository now also exposes a supervised `maintenance:loop` command with bounded interval/backoff, fixed failure events, and signal-safe child shutdown; the long-lived worker now emits a bounded 30-second heartbeat and the web service exposes fail-closed liveness/readiness probes; provider operations, signed S3-compatible object storage configuration, cloud encryption/versioning/backup controls, deployed process-supervisor ownership, alert routing, and fresh Docker proof remain
- Windows and macOS release: not implemented

The current leaderboard is synthetic. It validates ranking, navigation, planning-package generation, and the simple interface contract.

Migration `0053_complaint_analysis_snapshots.sql` now persists one validated,
deterministic complaint-analysis snapshot per retained complaint. Fixture and
production-shaped artifacts carry classification, severity, recurrence,
switching signals, entity confidence, and explicit unresolved competitor and
substitute dimensions into private evidence views and generated reports. The
rules are a reproducible checkpoint, not a live model or market claim.

Migration `0061_complaint_analysis_corrections.sql` adds an editor/owner,
derived-only correction history. Corrections hash-chain the prior and next
snapshots, leave source evidence/provenance immutable, invalidate stale active
analysis/opportunity projections, and hide stale report/plan reads until a new
reviewed analysis is produced. The next analysis input carries the corrected
snapshot instead of reclassifying source text. Migration `0062` extends the
same durable recomputation queue with a deferred correction trigger: each
affected opportunity receives one idempotent repair request, while an absent or
unapproved seed remains visibly blocked.

Migration `0067_field_level_evidence_redaction.sql` adds the reviewed privacy
projection boundary. Owner/editor members with a recent step-up can mask
selected text, entity candidates, or canonical locators for one run-bound
evidence item. Immutable source identity, capture/policy lineage, content
hashes, and analysis snapshots remain retained; private collection,
opportunity/leaderboard, analysis, report, and coding-plan mappers apply
read-time masks. Text masking requires the raw source
object reference to have already been cleared by the source-policy deletion
path. Cloud/backup purge and automatic recomputation remain separate gaps.

Private campaign create/edit forms now select source IDs from the authenticated
read-only source registry and keep pending-policy states visible. This is a
planning aid only; the existing approval, purpose, quota, display, and
admission gates still control collection. Migration `0068` adds the reviewed
multi-source parent/child queue and private history/detail reads; it remains
non-operational until deployed scheduler/Temporal ownership, crash/retry
drills, and live source-policy approval exist.

Migration `0054_source_policy_review_integrity.sql` now requires canonical
reviewer identity, independent review role, and explicit attestation for new
source approvals. Pre-0054 approvals remain audit history but do not make a
non-fixture source collectible until re-reviewed; legal/privacy/security and
deployment approval are still external blockers.

Private opportunity detail now includes a validated competitive-research
coverage record and a separate competitors/contrary-signals route. Fixture
records are marked synthetic/unresolved; production reviewed seed assumptions
are marked `reviewed-seed-only` with seed-review provenance and an explicit gap
until a permitted competitor source supplies retained evidence. Migration
`0059` adds bounded per-claim observations with source-item/evidence
provenance and editor/owner review; source-backed status now requires a
confirmed non-synthetic observation, and this slice does not activate a source.
Complaint/source-item contracts now retain an HTTPS canonical locator, and
private evidence/competitor views expose it for attribution when the source
provides one. Migration `0060` adds a database-level HTTP(S) host/path check
for the persisted locator. Migration `0063` adds a bounded JSONB feature matrix
to normalized competitor rows. Fixture entries are explicitly synthetic;
production seeds accept reviewed-seed assumptions only, while source-backed
entries must carry retained competitive observation identifiers. The public
and private competitor routes render the matrix without raw provider payloads;
approved competitor-purpose source coverage remains an external blocker.

Private campaign configuration is now available at
`/workspace/:workspaceId/campaigns` with authenticated list/create/read/update/
archive APIs, and owners/editors can start a bounded one-source run through the page or
`POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`. New writes use a
strict `campaign-v1` JSONB contract, resolve source registry and policy
readiness metadata, reject unknown or purpose-incompatible sources, and
persist only draft campaigns with identifier-only audit/outbox receipts. The
run route accepts only an idempotency envelope, derives query/source/limit/
budget from the stored campaign, rechecks policy/display mode/expiry and any
approved seed review, and commits the existing admission ledger before
Temporal. Legacy fixture/workflow campaign rows remain readable. Archive is a
soft lifecycle transition that preserves run/evidence lineage. The CFPB and
Stack Exchange connectors remain disabled. Migration
`0058_campaign_refresh_scheduler.sql` adds due timestamps, durable claims,
pending request lineage, retry/failure state, and narrow service updates; the
existing lease-backed source-maintenance pass now dispatches only approved,
supported production refreshes. Deployment-level scheduler ownership,
Temporal availability, and external CFPB approval remain open.

The private workspace now also exposes a read-only source registry at
`/workspace/:workspaceId/sources` and
`GET /api/workspaces/:workspaceId/sources`. It projects existing policy rows
without a migration, derives enabled/collectible state from the database
approval gate, and keeps quotas, deletion duties, and coverage notes visible.
Policy payloads, hashes, reviewer identities, and activation controls remain
outside the contract; fixture sources stay explicitly synthetic.

The campaign page and private API also expose the latest 100 production run
projections with safe state/checkpoint/counter/timestamp fields. A status page
links completed runs to the existing evidence and coverage inspection route;
idempotency hashes and raw source payloads remain excluded.

The collection page now exposes a reviewed-seed-only analysis start action for
owner/editor members. The private analysis-status page and API project only
safe Temporal/PostgreSQL state, checkpoint, bounded attempts, availability,
failure summary, identifiers, and timestamps. Workflow-prefix validation and
strict contracts prevent hashes, object references, source payloads, and seed
content from crossing the read boundary. Migration `0055` persists the
highest observed activity attempt on the production-analysis run, while
migration `0056` adds a bounded server-clock history with stage heartbeats,
terminal fixed failure codes, and duration. The attempt data remains outside
the idempotency hash. Periodic deployment alerting, production Temporal
availability, and deployed scheduler ownership remain operational follow-up;
the repository-level refresh claim/dispatch path is implemented.

`pnpm analysis:sample` produces a visibly `testOnly` production-shaped CFPB
artifact, report, deterministic score, and generic coding package under
`artifacts/analysis-sample/`. It does not activate a connector, call the
network, persist analysis, or establish market facts.

The persistence slice stores normalized fixture and reviewed production source/evidence lineage, complaints with explicit curation state, immutable workspace seed reviews, clusters, competitors, opportunities, immutable score snapshots, deterministic evidence-backed report versions linked to plan packages, content-addressed analysis output references, audit events, costs, deletion tombstones, outbox events, workflow checkpoints, recomputation dispatch state, and run lineage. Migration `0035` prevents a source-deleted production opportunity projection from remaining rankable; migration `0036` permits reactivation only after a new active analysis output has been linked, and migrations `0037`/`0062` queue bounded deletion- or correction-triggered active-evidence repairs with an approved-seed gate. The workflow proof covers retries, budgets, cancellation, duplicate starts, raw-history leakage, and local Temporal replay; PostgreSQL migration/read/deletion integration remains unproven until Docker and a secured deployment are available. It does not turn the fixture into market evidence, activate a source, or provide production Temporal/cloud-storage security.

New production-analysis v2 starts exclude raw evidence from Temporal history, but
legacy v1 histories may already contain artifact payloads and require controlled
worker draining/retention. Cloud/backup object deletion verification and
deployment-level service-role/secret rotation for the direct source CLI remain
open security and operations work. Migration
`0043` queues invalidated output objects and the configured adapter handles
orphaned-body retries. Migration `0044` makes deletion propagation failures retryable
with bounded server-clock scheduling; destructive workspace-closure and export
purge remain separate boundaries from the new archival lifecycle.
The analysis activity now anchors retention to server-observed time, rejects
materially future timestamps, and finalizes only against an active/current/
unexpired policy with allowed or restricted commercial use and confirmed or corrected,
redacted evidence. Production collection initialization now fails closed when
its database admission reservation is absent or already consumed. Manual
analysis admission/rate limits and initiator actor attribution are now
implemented by migration `0042`; deployed scheduler ownership, Temporal
authorization, and Docker-backed concurrency proof remain open. The reviewed
route reserves a digest/input hash before Temporal, binds an immutable user
actor, and consumes/releases that reservation with run persistence; duplicate
consumed/released digests replay without another slot.
Production connectors now invoke a worker-owned source-lease preflight
immediately before each CFPB or Stack Exchange request. A denied preflight
fails closed without HTTP and releases its durable quota reservation; the
runner/reconciliation path turns the denial into a terminal policy result and
releases the source lease. Persistence still locks and rechecks the lease in the
same transaction as the collection write; the preflight and provider socket
call cannot be one atomic database transaction, so deployment-level revocation
drills remain open. The settled source-request cost now travels from the quota
reservation through the immutable collection snapshot/result, workflow
checkpoint, and audit/outbox metadata; the reviewed CFPB policy still declares
zero request cost. A known policy-cost overage is rejected before source lease
acquisition and returns a bounded workflow budget rejection.
The identifier-only CFPB reconciliation path now persists warning-bearing page
checkpoints in migrations `0040`/`0041`, resumes queued or stale jobs without
the raw caller key, and finalizes missing active source items atomically only
after a warning-free short page. The source remains disabled and deployed
scheduler ownership, alerting, and Docker-backed reconciliation proof remain
open.

Migration `0050` now supports an explicit private re-collection after a
completed deletion tombstone. The request is limited to one source-native
record; the gateway, Temporal input, worker, and persistence transaction carry
the same immutable lineage; the CFPB connector uses its exact complaint route;
and the deleted predecessor remains historical. Maintenance, quota
reconciliation, and retries never trigger this path automatically. The source
is still disabled pending legal/privacy/security approval, and downstream
analysis/report/plan generation remains a separate explicit action.

Migration `0048` adds the workspace/time index used by the private
`GET /api/workspaces/:workspaceId/costs` read. The route repeats membership
authorization inside a read-only RLS transaction and returns exact bounded
micro-unit aggregates by currency and cost type; it does not provide billing,
provider pricing, or deployment alerting. Migration `0049` adds the private
`GET /api/workspaces/:workspaceId/research/quota-reconciliation` inspection
route and the maintenance-role-only linked/voided resolution boundary; it does
not change quota history or enable automatic re-fetch.
