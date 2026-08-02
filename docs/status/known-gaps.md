# Known gaps

## Research coverage

No live social platform is enabled. Fixture data cannot estimate market size, complaint frequency, or current momentum.

Private campaign configuration is now persisted and source-policy readiness is
visible. Owners/editors can start a bounded one-source run from the campaign
page; the route derives collection inputs from the stored campaign and admits
the idempotency digest before Temporal. Owners/editors can now replace draft
intent through a validated PATCH boundary, and DELETE archives without
removing run or evidence lineage. Pagination remains open. Migration `0068`
now adds a forced-RLS multi-source parent/child orchestration queue for two to
sixteen approved non-fixture sources. The run route is idempotent; the existing
lease-backed maintenance worker claims children, rechecks policy, reserves the
existing service admission, starts the existing collection workflow, and
reconciles safe child state into private campaign history/detail routes. This
slice is production-shaped but not operational until deployed scheduler/Temporal
ownership, crash/retry drills, and live source-policy approval exist. The
campaign forms now use a private source picker backed
by the read-only registry; policy state remains visible and the picker cannot
activate a connector. Scheduled refresh now has a
durable campaign claim/dispatch boundary in the existing lease-backed source
maintenance worker; deployment-level scheduler ownership and Temporal remain
open. The read-only source registry now exposes policy readiness,
quotas, deletion duties, and coverage notes, but it cannot activate a source.
The page now lists the latest 100 production run projections and
links completed runs to evidence inspection without exposing hashes or source
payloads. Pending policies can be named to make coverage gaps explicit;
they cannot be collected or treated as enabled sources. The CFPB connector
remains disabled pending external legal, privacy, and security approval.

Completed collections now have an explicit owner/editor handoff to a reviewed
production-analysis run. The status route falls back from Temporal to a safe
PostgreSQL projection and fails closed for foreign workflow identifiers.
Migration `0055` persists the highest bounded Temporal activity attempt on the
analysis run and the worker keeps it outside the idempotency hash; migration
`0056` adds at most ten server-clock attempt rows with stage heartbeats,
duration, and fixed terminal failure codes. Queued and running fallback rows
expose observed attempts without source content. The start action is still
manual and approved-seed-only. Periodic deployment alerting, production
Temporal availability, and production scheduler ownership remain open.

Source-policy approval integrity is now database-bound: new approvals require a
canonical reviewer identity, an independent legal/privacy/security role, and an
explicit attestation; pre-0054 approvals are conservatively disabled until
re-reviewed. Legal/privacy/security owners still must approve the CFPB policy,
and production deployment controls remain absent.

Complaint observations now carry a deterministic, versioned classification and
entity-resolution snapshot with severity and uncertainty fields. The rules are
not a trained classifier, do not estimate unique authors, and intentionally
leave substitute/competitor resolution unresolved until separately reviewed
permitted research is available. Private opportunity reads now expose a
competitive-research status and provenance record, and a private competitors /
contrary-signals page keeps reviewed seed values separate from source-backed
research. Migration `0059` adds a policy-gated, human-reviewable observation
boundary that retains source-item/evidence identifiers per competitive claim;
no approved competitor-purpose source is connected yet, so production research
remains `reviewed-seed-only` until confirmed non-synthetic observations exist.
The private correction editor now exposes field-level controls for the derived
interpretation and entity references while retaining evidence basis, source
provenance, policy flags, and derivation metadata as read-only. A complete
competitor feature matrix contract and fixture/private/public read surface are
now implemented by migration `0063`; source-backed matrix entries remain
blocked until approved competitor-purpose observations exist.

Migration `0061_complaint_analysis_corrections.sql` now closes the first part
of that gap: an editor/owner can submit a strict derived-only correction from
the private evidence view. The immutable correction history stores prior/next
snapshot hashes, source evidence and provenance are not editable, and active
analysis/opportunity projections are invalidated so stale reports and plans
are hidden. Migration `0062_correction_recompute_jobs.sql` extends the existing
forced-RLS repair queue with a deferred correction trigger. Each affected
opportunity gets one deterministic re-analysis request; missing or withdrawn
seeds remain blocked rather than bypassing review. The competitor feature
matrix is now persisted and rendered with explicit fixture/reviewed-seed/source
observation provenance; the source-backed portion remains open pending external
policy review.

## Infrastructure

The PostgreSQL schema, repository, migrations, RLS, local role bootstrap, and CI integration suite exist. `pnpm production:preflight` now rejects missing or role-confused production URLs, insecure endpoints, incomplete Temporal/object-store settings, and unsafe delivery switches before startup. Production role provisioning, secrets, verified TLS trust, backups, high availability, deployment, live dependency proof, and migration approval automation do not.

The fixture and production-collection workflow boundaries are durable locally
and in CI. Web and worker clients now fail closed and support a non-loopback
Temporal endpoint with namespace, API-key, and pinned-CA settings, but there is
no production Temporal topology, namespace/task-queue authorization, HA,
backup/restore policy, worker deployment, or alerting. Production billing and
deployment configuration are also absent.

Private workspace authentication is implemented for the web boundary with durable
hashed sessions, PostgreSQL-backed login/signup throttling, bounded session
retention, membership-checked RLS transactions, and fixture/production workflow
start/status gateways. Signup creates an active private non-fixture workspace;
source-policy approval and deployment controls still gate production starts,
while a reviewed provisioning path for broader limits and roles remains open.
Account recovery mechanics
(hash-only single-use tokens, encrypted delivery outbox, retryable worker,
fragment links, and generic responses) are implemented behind a production
kill switch. Provider delivery, verified email/identity policy, gateway
DPA/retention, key rotation, and deployment evidence remain unapproved.
Existing-account workspace invitations are implemented with hash-only tokens,
encrypted outbox delivery, owner step-up, acceptance/revocation state, and
bounded worker retries, but invitation delivery is kill-switched and the
current slice intentionally does not create accounts or verify email ownership.
An external identity provider policy remains unimplemented. Authenticated
session inventory and per-session revocation are implemented at
`/account/security`. The same page now supports a step-up-protected account
closure that anonymizes authentication material, discards reset deliveries,
revokes sessions, and retains shared workspace research; closure is blocked
until every owned workspace has another owner. Owner-only member listing, role changes, and removal are
implemented through the private workspace settings route and protected by a
15-minute password step-up window. Owner-only workspace archival is now also
implemented through the same route: it blocks active workflow/run/lease work,
retains lineage, and records identifier-only receipts. MFA/OIDC and a production
identity-provider control plane remain open.

The owner-only `GET /api/workspaces/:workspaceId/purge-readiness` projection and
members-page inventory now expose bounded active-work and raw/analysis/report/
plan object-reference counts. `database_ready` means only that the
PostgreSQL-observable blockers are clear; the response always keeps cloud
object-store purge, export-retention purge, and backup-deletion verification
visible. It is read-only and does not queue or perform destructive deletion.

The repository refuses to auto-create fixture workspaces when `NODE_ENV` is
`production`; deployment must provision fixture-enabled workspaces explicitly.

Authenticated workflow jobs persist an immutable user or `appsea-worker`
requesting actor, with a database check for owner/editor membership. This is
not a substitute for production Temporal namespace authorization or complete
identity operations such as MFA/OIDC and provider-backed identity controls.
Account closure is a shared-workspace-safe profile closure, not workspace
research deletion. Recovery mechanics exist behind a production kill switch;
delivery and identity verification remain unapproved.

Deletion tombstones now have a bounded skip-locked propagation worker with
server-clock stale-claim recovery and retryable failures that terminalize only
after eight attempts. Source-item raw references are cleared, active
source/evidence payload rewrites are blocked,
terminal tombstone state/count rewrites are blocked, normalized evidence is
replaced with a redaction marker, dependent report/plan versions are marked
unavailable, active production analysis runs are marked `invalidated`, and
mutable opportunity projections are invalidated/de-ranked when no newer active
analysis remains while provenance remains. Migration `0043` now queues the
complete artifact/report/plan references for an authorized, retention-aware
purge pass; the local adapter also removes orphaned bodies after a metadata
sidecar crash. Migration `0044` makes failed tombstone propagation retryable
with a server-clock deadline and bounded exhausted terminal state. An explicit
reviewed analysis can now re-cluster the
remaining active evidence after deletion, but automatic recomputation
scheduling now persists source-tombstone- or correction-bound jobs and dispatches
through the existing analysis workflow. Automatic re-collection, object
storage/backups, destructive workspace purge, export purge, and deployed
scheduler alerting are not implemented. Workspace archival is a separate,
non-destructive lifecycle boundary and does not satisfy those purge duties. The
readiness inventory documents the sequence but does not change this gap.
Complaint review transitions and the
explicit reviewed analysis-start route are implemented. Migration `0034` also
provides an opt-in, seed-bound post-collection handoff with stale-claim
recovery; deployed scheduling, Temporal authorization, and alert ownership
remain open.

Source and authentication maintenance entry points now use schema-validated,
bounded pure runners with stable scheduler job IDs and secret-free structured
result events. Migration `0046` adds a PostgreSQL server-clock lease with
per-acquisition tokens, a dedicated `appsea_maintenance` role, and
owner/token-checked acquire/renew/release functions; source maintenance, auth
retention, password recovery, and workspace-invitation delivery skip a
contended pass and fail with fixed lease-loss codes. The source-maintenance pass
resumes at most one due snapshot per sorted workspace under an independent batch
budget and reports terminal, retry, and coverage-gap counters; the targeted
resume command remains for operator recovery. The existing repository
operations are idempotent for safe reruns. The long-lived worker now emits a
bounded `worker_heartbeat` event every 30 seconds, and the web service exposes
no-store liveness/readiness probes that fail closed on PostgreSQL, authenticated
Temporal, or object-store dependency checks. These signals improve deployment
validation. The worker also exposes a deployment-owned `maintenance:loop`
supervisor that starts one existing lease-backed pass at a time, retries child
failures with bounded backoff, and forwards shutdown without logging raw
errors. It improves repository-level ownership but still requires a production
process supervisor, alert routing, and deployment liveness policy. Migration
`0047` now persists each acquired, contended, or failed
maintenance invocation through maintenance-role-only record/list/purge
functions, with generated run IDs, fixed states/codes, bounded durations, and
numeric counters; it purges rows on the configured retention window and never
stores lease tokens or raw errors. Migration `0048` and the private
`GET /api/workspaces/:workspaceId/costs` route now provide bounded,
membership-authorized cross-run ledger aggregation by currency and cost type
using exact micro-unit strings. Migration `0049` and the private
`GET /api/workspaces/:workspaceId/research/quota-reconciliation` route now
discover settled reservations without completed production results; the
maintenance-only CLI records an exact linked-result or explicit no-result
resolution without changing quota or re-fetching. The repository now also
provides `pnpm worker:source:quota:alert`, a lease-owned read-only bounded scan
that emits fixed alert/incomplete/clear events and durable counters while
keeping truncated coverage visible.
Migration `0065` and `pnpm worker:workspace:cost:alert` add a lease-owned,
maintenance-only cost projection and exact micro-unit threshold inspection.
Non-target currencies and truncation keep a non-alerting scan incomplete; the
command is observability only and does not block admission or provide billing.
Migration `0052` now fences selected
SQL-only maintenance mutations with the server-clock lease identity; external
source/provider/object-store effects and snapshot reconciliation remain outside
that atomic boundary. Deployment still lacks scheduler process ownership,
alert routing/incident response, provider pricing/billing controls,
per-scheduler maintenance credentials, and a fresh Docker-backed recovery
proof. The current
`appsea_maintenance` coordinator is trusted across
the four allowlisted names; production data-work role separation and optional
per-scheduler isolation remain release gates.

The production workflow start route caps both declared and chunked JSON bodies
and now calls the migration `0038` admission function before Temporal. The
database serializes each workspace's five-start/15-minute and two-active-job
limits, preserves replayed digests, consumes a short-lived reservation during
workflow initialization, and source maintenance purges terminal or expired
admission rows. The limits are repository-owned defaults, not caller-configurable
payload fields. Workflow initialization fails closed if the reservation is
missing or already consumed, including the duplicate-job path. A deployed
scheduler, authenticated Temporal namespace, and multi-instance failure proof
are still required before this boundary can be called production-operated.
Migration `0042` adds the same boundary to the reviewed manual production-
analysis route: the route binds a user actor, reserves a digest/input hash
before Temporal, and the worker consumes/releases that reservation in the same
transaction as run creation or terminal failure. Actor identity is immutable
and the database checks owner/editor membership on insert. A released or
consumed analysis digest replays without consuming another slot.

Production analysis workflow version `v2` now carries only identifiers and
immutable digests into Temporal; the worker reconstructs its redacted artifact
from workspace-bound rows inside the activity. This closes new raw-history
leakage, but v1 histories need a controlled drain/retention plan. The activity
still persists object-backed outputs before finalization; migration `0043` and
the maintenance worker now cover invalidated output-object marking, retention,
bounded retry, and local orphan cleanup. Cloud object-store/backup deletion and
external conditional-delete verification remain deployment work. Migration
`0045` adds an authenticated editor admission route and explicit
`appsea-worker` service-principal guard for source snapshot reconciliation; the
deployed service-role split, secret rotation, and scheduler ownership remain
open. The recomputation dispatcher now
reclaims stale `dispatching` rows from
the server clock and terminalizes exhausted claims, so a worker crash cannot
strand that queue indefinitely. Retention is anchored to
server-observed activity time and final
lineage rechecks active/current/unexpired policy, commercial-use eligibility,
and confirmed or corrected redacted evidence. The manual analysis route now has a workspace
admission/rate gate and authenticated initiator attribution through migration
`0042`; deployment still needs a scheduler, Temporal authorization, and
crash/failure proof for that boundary.

Non-fixture report, plan, and production-analysis artifact payloads require
object storage; inline JSONB is deliberately restricted to compact metadata
and synthetic fixture packages. `@appsea/object-store` now provides bounded
in-memory/filesystem adapters plus a signed S3-compatible adapter wired through
the shared environment factory. Migration `0043` adds the durable
invalidated-output purge queue. Provider encryption, lifecycle/versioning,
least-privilege credential deployment, destructive workspace/object/backup
purge, and fresh Docker-backed proof remain open. Owner workspace archival is
implemented separately and retains the referenced data.

## Sources

The private source registry at `/workspace/:workspaceId/sources` and its
no-store API make current policy readiness, quotas, retention/deletion duties,
and coverage notes visible to workspace members. It is intentionally a
read-only projection over existing source-policy tables: it does not activate
connectors or expose policy payloads, hashes, or reviewer identities. A source
remains a visible gap until the independent approval gate is satisfied.

The CFPB Consumer Complaint Database connector is implemented with an explicit
typed policy, conservative quotas, narrative-only mapping, bounded request
timeouts, and a separate identifier-only full-snapshot deletion reconciliation
worker, but remains disabled (`pending_review`). Migration `0027` now records operator-only draft
registration and immutable approval evidence; an approved snapshot can feed
the bounded production collection workflow, which persists non-synthetic
source/evidence/complaint lineage, idempotent job/checkpoint state, and a
private inspection route. The filtered collection request emits no deletion
events; migration `0041` adds immutable identifier page checkpoints, persisted
warnings, a bounded direct command, and a private resume command. Durable cross-workspace quota reservations,
bounded all-workspace maintenance through a migration-owner security-definer
workspace enumerator, stale-claim recovery, and deletion propagation now exist.
No source is currently enabled for market research, and production Temporal
provisioning/cloud-storage deployment, scheduler-triggered re-collection,
cloud object-store/backups purge, recomputation alert routing, and
legal/privacy/security approval remain required. Explicit one-record
re-collection after a completed deletion tombstone is implemented behind a
private reviewed route, but it is not automatic and does not activate the
source. Collection now carries the
settled source-request cost from the quota reservation through the immutable
snapshot/result, workflow checkpoint, and audit/outbox metadata. CFPB currently
records zero source cost because the reviewed policy declares zero API cost;
non-zero billing adapters, provider pricing, and deployment threshold selection
are not implemented. Migration `0065` adds repository-level cost-threshold
inspection, but deployed routing and billing remain external. Known policy-cost overages are now rejected before a source lease
is acquired. Retention enqueue now derives
bounded tombstones from the stored policy and reuses deletion propagation;
policy drafts requesting a general `purge` retention action remain rejected
until source/object/backups scope is approved. Invalidated analysis output
purge is now bounded through migration `0043`; cloud object-store/backups purge
remains open;
automatic recomputation dispatch now exists through migrations `0037` and
`0062`, and a separate maintenance-role read projection plus lease-owned,
bounded alert inspection now makes failed, blocked, stale, oldest-age, and
truncated coverage visible without dispatching or retrying a repair. The
deployment scheduler, event routing, and incident response remain open. The
migrations `0040`/`0041` provide a policy-gated identifier-only reconciliation
job, page checkpoints, warning-preserving retries, and atomic tombstone
finalization. A production-shaped
offline composition checkpoint now proves normalization, deduplication, clustering,
explicit seeded scoring, generic report generation, and generic plan generation;
it is test-only/in-memory and is not a live-source analysis run. The reviewed
production analysis repository/workflow persists non-test artifacts after a
completed collection, but only the local/CI object-store adapter is available
here. Migration `0033` now persists immutable workspace seed reviews with
editor/owner review and approval transitions; analysis start accepts only an
approved seed-review identifier and the persistence repository rechecks its
stored content hash and version.

The Stack Exchange connector is now a second policy-drafted candidate for
`competitor-research` and `contrary-evidence`. The production collection worker
and scheduled refresh dispatcher select it only from the approved source-policy
registry, but it remains disabled and unregistered: the API terms/CC BY-SA
attribution path, 14-day excerpt retention, deletion behavior, and restricted
commercial use still require independent review. Its filtered search path
emits no deletion tombstones and cannot be used to infer absence.
Migration `0067_field_level_evidence_redaction.sql` now adds a separate,
editor/owner-only field-redaction boundary. It records an immutable receipt,
retains source identifiers, capture/policy metadata, and the original content
hash, and masks the selected evidence fields in collection, private evidence,
opportunity/leaderboard, analysis, report, and coding-plan read projections.
Redacted analysis snapshots and stored
objects are not rewritten; read mappers apply the mask before returning them.
Text redaction is denied while a raw source object reference remains, so the
source-policy deletion path still owns raw-object and backup deletion. This
slice does not claim workspace/export purge, cloud object-store deletion, or
automatic downstream recomputation after a privacy request.
Migration `0039` adds a workspace-scoped, digest-only source collection lease.
The lease binds acquisition to the current active policy and matching operator
approval review, stores one observed collection timestamp for retry replay, and
is asserted by the connector immediately before each external request and is
also asserted and row-locked inside the same transaction as persistence. A
denied preflight releases its durable quota reservation before any HTTP call;
the persistence snapshot uses that observed timestamp while `requestedAt` remains
caller/idempotency metadata. Terminal or expired leases are bounded by source
maintenance. This closes the repository-level policy read/fetch and
assert-to-persist races, but the database assertion and provider socket call
are not one atomic transaction; production still needs lease-revocation drills,
scheduler ownership, Temporal namespace authorization, and Docker-backed
crash/retry evidence. A quota settled without
a persisted result now creates a durable operator-reconciliation case; the
worker does not release or re-fetch optimistically. The repository-level alert
inspection is bounded and read-only; case alert routing, incident response,
and maintenance-role provisioning remain deployment work.

## Models

No model gateway is wired. The fixture path uses deterministic labels and explicit data.

## Reports

Fixture persistence now emits a deterministic evidence-backed report with
separate observations, score inference, contrary evidence, recommendation, and
source coverage sections, and links that report version to the coding plan.
The composer now supports a production-shaped offline artifact and generates a
generic report/package template. Fixture reports retain inline JSON while
production reports hydrate validated object-backed JSON through the same
approval/export governance. The production contract carries policy-review hashes, distinct
analysis-run identity, evidence/source-item mappings, and a reviewed seed
envelope. Report approval transitions are role-checked in the private
workspace API and database, and exports are authorized only for approved,
validated report JSON. Migration `0033` adds a first-class workspace
seed-review registry, private list/read/create/transition routes, and a seed
review page; the analysis-start boundary now accepts only an approved
`seedReviewId`. Production analysis persistence, opt-in post-collection
handoff orchestration, private active-output reads, and source-deletion
invalidation are implemented, with editor/owner complaint review transitions
on the private collection surface. Cloud object storage, external retention/
backup propagation, destructive workspace closure, and export purge remain open.
Plan packages now have a separate owner/editor
approval boundary and approved JSON export; both report and plan routes hydrate
validated object-backed payloads before export. Source-item retention enqueue is
implemented from the stored policy; invalidated analysis outputs now enqueue
retention-aware local object purges, but source-wide object-store and backup
purge remain deployment work.

Production analysis private reads now carry the current report and plan
approval states from PostgreSQL governance projections, so later review
transitions remain visible without inferring stale object defaults. This does
not change the separate approval or approved-only export gates.

## Desktop

The Tauri boundary is staged without signing, update infrastructure, or platform release tests.

## Autonomy

The runtime skill registry and agent memory are contract foundations. They do not run an autonomous production coding loop.

## Durable workflow proof

The local/CI proof uses a loopback unauthenticated Temporal dev server with
SQLite and deterministic fixture/production-collection/production-analysis
activity contracts. It
does not prove worker crash fault injection, production retention/encryption,
or multi-worker deployment. A quota reservation that is settled before a
collection result is persisted enters the migration `0049` operator-
reconciliation case ledger; automated retry after that boundary is intentionally
blocked, and deployment still owns case alerting and operator identity.

## Naming

AppSea remains a working codename pending legal and domain clearance.
