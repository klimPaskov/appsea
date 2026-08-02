# Decision memory

Foundation decisions from 2026-07-10 are archived in
[`archive/DECISIONS-foundation-2026-07-10.md`](archive/DECISIONS-foundation-2026-07-10.md).

## 2026-07-24: Temporal orchestration with PostgreSQL commit authority

Use pinned Temporal workflows for scheduling, retries, cancellation,
and recovery, with sanitized history and side effects in activities. PostgreSQL
owns RLS, checkpoints, lineage, and ledgers; the persistence safe point and
terminal reconciliation handle late cancellation. Local Compose is development
proof, not production deployment.

## 2026-07-24: Authenticated private workspaces

Store users/memberships in PostgreSQL, hash passwords/tokens, and use
HttpOnly SameSite cookies. Every private read checks membership before RLS
context. Keep the public leaderboard synthetic. Owner membership mutations use
last-owner and password-step-up guards with identifier-only receipts; recovery,
invitations, closure, MFA/OIDC, and production identity remain reviewed work.

## 2026-07-24: Durable source quota and deletion projections

Source quotas use security-definer reservations with global minute windows,
workspace/run/idempotency lineage, and idempotent commit/release/expiry. A
narrow connector capability fails closed outside tests. Deletion tombstones
clear raw references, mark dependent reports/plans unavailable, and retain
provenance; recomputation and external purge remain open.

## 2026-07-24: Review before report export

Keep report governance in the private workspace boundary. Owners and editors may
move a draft to `reviewed`; only owners may approve or withdraw; transitions are
monotonic and the database trigger repeats the role/order check while emitting
identifier-only audit/outbox receipts. Export returns only a schema-validated,
approved report read model with its manifest hash, never raw source payloads.
This proves an operator-safe fixture export without implying that non-fixture
object storage, retention, or deletion duties are complete.

## 2026-07-24: Explicit session inventory and revocation

Expose active sessions privately using stable IDs/timestamps. Revoke another
session only after same-origin password reauthentication and reject the current
session; the database resolves the current token before updating the target.
Recovery, MFA/OIDC, and account deletion remain separate identity work.

## 2026-07-24: Bounded maintenance runners and scheduler correlation

Keep quota/deletion and auth retention as pure, contract-validated runners with
capped inputs, independent budgets, and stable scheduler IDs. PostgreSQL is the
idempotency boundary; deployment, alerting, and recovery ownership require
review before production scheduling.

## 2026-07-24: Provider-neutral password recovery boundary

Keep recovery in the global authentication boundary with hash-only reset
tokens, encrypted outbox material, latest-only uniqueness, narrow
`SECURITY DEFINER` functions, generic web responses, and bounded idempotent
worker delivery. Production delivery stays kill-switched until identity/email,
provider DPA/retention, key rotation, monitoring, and failure evidence are
approved.

## 2026-07-25: Existing-account workspace invitations

Keep invitations owner-scoped and provider-neutral: store a hash-only token,
encrypted delivery material, bounded expiry/retries, and identifier-only
receipts. Require owner step-up and an existing account email match. Do not
create accounts or verify ownership until identity/provider review; API and
worker delivery remain kill-switched.

## 2026-07-25: Shared-workspace-safe account closure

Account closure uses the existing password step-up marker plus a typed
`DELETE MY ACCOUNT` confirmation. Migration `0026_account_closure.sql` checks
the authenticated user at a security-definer boundary and blocks closure while
that user owns any workspace; ownership transfer remains an explicit owner
mutation. Once unblocked, sessions and reset material are revoked, pending
encrypted reset deliveries are discarded, and the profile is anonymized with a
non-deliverable placeholder. Memberships and shared research remain so other
members retain access and provenance. This is an account/profile closure, not
workspace-data, export, object-store, or backup deletion.

## 2026-07-25: Policy-gated production collection checkpoint

Keep the complete fixture artifact contract unchanged while adding an additive
collection contract. Migration `0027` stores immutable source-policy review
evidence and keeps activation in the migration-operator boundary; runtime
workers can only read an active approved snapshot. The first CFPB checkpoint
persists policy-allowed non-synthetic items, redacted evidence, unreviewed
complaints, tombstones, coverage gaps, and idempotent identifier-only receipts.
It is not a full research run: clustering, competitors, scoring, reports,
plans, Temporal orchestration, legal approval, and market completeness remain
separate boundaries.

## 2026-07-25: Production collection workflow boundary

Keep the production collection Temporal workflow additive to the fixture
workflow. Migrations `0028`/`0029` store RLS job/checkpoint state,
policy-derived retention, budgets, terminal guards, hashed idempotency, and
immutable user/service attribution. PostgreSQL is the non-cancellable
persistence authority; a settled quota without a result stops for operator
reconciliation. This proves the contract locally without claiming production
Temporal, live-source approval, purge, aggregate recomputation, or downstream
opportunity analysis.

## 2026-07-25: Policy-derived source retention

Enforce a source policy's `retentionDays` and `deletionRequired` through a
bounded migration-owner function that queues deterministic retention tombstones;
reuse the existing skip-locked deletion propagation path for redaction and
dependent report/plan invalidation. The function clamps caller time to the
database clock, and skips fixture/purge-only policies until a matching purge
implementation exists, and keeps enqueue and propagation budgets independent.
This satisfies the CFPB redaction/tombstone obligation without adding a second
payload-deletion implementation. `redact` and `tombstone` therefore currently
share the same source-deletion propagation semantics; field-level redaction,
object-store/backups purge, and aggregate recomputation remain separate work.

## 2026-07-26: Offline production analysis composition boundary

Keep an offline, production-shaped composition boundary that accepts only
reviewed non-fixture input and a reviewed seed. Code owns normalization,
clustering, and scoring; the sample is visibly test-only and never activates a
source or claims market evidence. Durable persistence, orchestration, object
storage, and approval remain separate boundaries.

## 2026-07-26: Keep non-fixture blobs behind an object-store seam

Keep non-fixture plan/report payloads behind a content-addressed object seam,
with workspace-bound, hash-validated, immutable references and tombstone-before-
read behavior. The in-memory/filesystem adapter is not cloud deployment;
encrypted storage, lifecycle, backup deletion, lineage, and private reads need
separate review.

## 2026-08-01: Queue invalidated analysis output purge separately

Keep source invalidation and external deletion separate. Migration `0043`
queues artifact/report/plan refs before commit; maintenance claims with stale
recovery, marks deleted, waits for `retentionUntil`, then purges with bounded
retries. Local orphan bodies are cleaned after sidecar loss. This is narrower
than source-wide, cloud backup/version, closure, or export purge.

## 2026-07-26: Preserve production analysis provenance before persistence

Require downstream analysis inputs to carry a policy version, policy content
hash, approval review ID, distinct analysis-run ID, and explicit evidence/source
item IDs and hashes for every retained complaint. Product, competitor,
contrary-signal, and score assumptions remain inside a separately reviewed seed
envelope. Reports map observations to evidence IDs (not complaint IDs). This is
an additive contract hardening step; the reviewed production analysis
projection, object references, and post-collection workflow now preserve that
boundary.

## 2026-07-26: Persist production analysis as a separate idempotent projection

Migration `0030` keeps acquisition and production analysis in separate
projections. Analysis starts require a completed policy-bound collection,
active evidence, and an approved seed; compact lineage and hashes remain in
PostgreSQL while artifacts use content-addressed objects. Replays are
idempotent, and deletion invalidates outputs without erasing provenance.

## 2026-07-26: Govern plan packages separately from reports

Migration `0031` gives coding-agent plans their own editor/owner approval and
export boundary. Owner approval requires a ready package and approved linked
report; private reads hydrate workspace-bound objects, preserve deletion
markers, and write identifier-only receipts. A draft plan cannot be exported
just because its report was approved.

## 2026-07-26: Review complaints before downstream analysis

Treat collection persistence and complaint curation as separate boundaries.
Migration `0032` permits only active workspace editors/owners to confirm or
reject active observations, records identifier-only receipts, and makes the
review state part of the evidence read contract. Downstream production
analysis must consume the confirmed subset; no review action changes source
policy or deletes provenance.

## 2026-07-26: Start analysis from persisted reviewed evidence

Keep downstream analysis explicit after collection and curation. The private
analysis-start route reconstructs request and approved-policy lineage in the
workspace transaction, admits only active confirmed excerpt evidence, and
passes a reviewed seed to the existing idempotent Temporal workflow. It never
accepts caller-supplied complaint payloads; collections without an explicit
handoff seed retain the manual route.

## 2026-07-26: Persist and approve opportunity seeds before analysis

Opportunity product, competitor, contrary-signal, and score assumptions are
workspace-owned input, not inferred evidence. Migration `0033` stores each
validated seed as immutable content-hashed JSON. Editors may mark a record
reviewed; only owners may approve or withdraw it. Both the private analysis
start route and the production persistence repository require the approved
stored seed identifier, version, and hash, so a retry or direct worker caller
cannot substitute an unreviewed envelope.

## 2026-07-26: Queue optional post-collection analysis durably

An automatic handoff is opt-in and names an already approved seed review in the
collection request. Migration `0034` writes a deterministic handoff row in the
same transaction as collection completion, and a skip-locked worker
reconstructs active policy/evidence lineage before starting the idempotent
analysis workflow. This keeps Temporal outages and worker crashes recoverable
without making collection persistence depend on a remote start call, while
preserving the complaint-confirmation gate.

## 2026-08-01: Require linked active output before same-run recovery

Source deletion invalidates mutable opportunity projections. Migration `0036`
allows same-run reactivation only after a new analysis links active score/plan
output built from active, confirmed, policy-allowed evidence; coverage gaps
remain visible. Automatic scheduling and source re-collection stay separate
approval-gated work.

## 2026-08-01: Queue deletion-triggered active-evidence recomputation

Source deletion must not leave an invalidated opportunity waiting for a manual
restart, but it must not re-fetch deleted records or invent a seed. Migration
`0037` records one tenant-scoped job with collection/seed/tombstone lineage. A
skip-locked worker dispatches only with an invalidated opportunity, no active
output, an approved seed, and reconstructable active policy-allowed evidence;
withdrawal is `blocked`, retries are bounded, and Temporal start is idempotent.
Scheduling, alerting, and source re-collection remain separate deployment work.

## 2026-08-01: Gate production workflow starts before Temporal

Authenticated production collection starts must not create unbounded failed
Temporal executions while source policy or infrastructure is pending. Migration
`0038` keeps a digest-only admission row, serializes a workspace rate bucket
under advisory lock, and fixes five starts/15 minutes plus two active
jobs/reservations. Replays consume no slot; initialization consumes the
reservation and maintenance purges terminal/expired rows. Missing consumption
fails closed, and ambiguous Temporal errors do not release a reservation.
Deployment configuration and Temporal authorization remain open.

## 2026-08-01: Bind external collection to a policy lease

Migration `0039` adds a workspace-scoped digest-only lease so collection cannot
fetch under a revoked/expired policy. Persistence asserts and locks the active
policy/approval lease in its write transaction; terminal leases are purged and
uncertain quota settlement remains operator reconciliation, not auto-refetch.

## 2026-08-01: Keep production analysis artifacts out of Temporal history

New starts use `production-analysis-v2` because v1 placed redacted artifacts in
Temporal history. Only identifiers/digests cross Temporal; the worker
reconstructs the artifact and PostgreSQL remains commit authority. Legacy v1
histories need a drain/retention plan; retention uses server-observed time.

## 2026-08-01: Make full-snapshot deletion inference identifier-only and durable

Filtered pages cannot prove deletion. CFPB uses an unfiltered
`deletion-reconciliation` purpose with identifier/page checkpoints; only a
warning-free short page may enqueue tombstones, and a settled quota without a
checkpoint needs reconciliation rather than auto-refetch.

## 2026-08-01: Admit manual analysis separately and bind its initiator

Manual analysis is downstream, so migration `0042` gives it a separate
digest/input admission ledger and immutable membership-checked initiator. The
actor stays in the input hash while consumed/released digests replay; expired
reservations alone are reclaimable.

## 2026-08-01: Reclaim stale recomputation dispatches from the server clock

Deletion-triggered analysis repair claims are committed before a worker calls
Temporal. A crash in that gap must not strand the job, and caller time must not
control recovery. The repository reclaims `dispatching` rows older than 15
minutes from PostgreSQL's clock, allows 24 claims, and records fixed terminal
failure for exhausted stale rows. Deterministic workflow identity makes a late
start replay the same run; per-attempt claim tokens remain future fencing work.

## 2026-08-01: Retry deletion propagation before terminal failure

The first propagation exception must not erase a source deletion or make a
partial redaction look complete. Migration `0044` adds an attempt counter and
server-clock `next_attempt_at`; claims use a 15-minute stale lease and failed
rows retry after 60 seconds until eight attempts. Exhausted rows retain fixed
failure metadata and cannot re-enter processing; completion remains idempotent.

## 2026-08-01: Versioned complaint analysis snapshots

`0053` stores derived analysis beside each complaint; unresolved entity types
stay explicit.

## 2026-08-01: Source-policy review integrity

`0054` requires reviewer identity, independent role, and attestation; legacy
approvals require re-review.

## 2026-08-01: Keep competitive research state explicit

Private opportunity reads separate competitive-research state from competitor
rows: fixtures are synthetic/unresolved, approved seeds are reviewed-seed-only,
and source-backed requires permitted source IDs, retained evidence IDs, and an
observation time. This prevents missing coverage becoming a market claim.

## 2026-08-01: Persist campaign intent before collection

Use existing `research_campaigns` JSONB for strict `campaign-v1` intent and a
bounded legacy read union. Draft writes resolve policy readiness, reject source
or purpose mismatches, record identifier-only receipts, and never start
Temporal or activate a connector; admission rechecks quota, deletion, and
budget. No migration was needed.

## 2026-08-02: Make reviewed analysis handoff explicit and safe

Collection completion is not analysis. The private handoff accepts only an
approved workspace seed and exposes a safe Temporal/PostgreSQL projection;
hashes, object references, source payloads, and seed content stay out of the
read contract. Migrations `0055`/`0056` keep bounded activity attempts and
server-clock heartbeat history outside the idempotency hash.

## 2026-08-02: Reuse the maintenance lease for campaign refresh dispatch

Migration `0058` stores due time, claim token, workflow identity, pending
request, attempts, and fixed failure state. Source maintenance claims due
non-fixture campaigns, rechecks policy, binds before admission, and starts an
idempotent workflow; stale claims reclaim; denied sources inactive.

## 2026-08-03: Orchestrate multi-source campaigns as durable child requests

Keep the existing one-source workflow/admission as the execution boundary.
Migration `0068` adds a forced-RLS parent and one child per configured
non-fixture source (two to sixteen), with deterministic identity, leases,
bounded attempts, and fixed failures. Maintenance rechecks policy and
reconciles child projections into parent/campaign state, preserving partial
outcomes without treating policy denial as missing evidence.

## 2026-08-03: Keep coding-agent access workspace-scoped and read-only

Migration `0069` and `/api/mcp` provide the first agent-access boundary. A
private-workspace owner issues an expiring, hash-only token after step-up;
MCP is workspace-bound, scope-filtered, read-only, and preserves coverage,
redaction, and approved report/plan state. Workflow, activation, policy,
deletion, deployment, and credential tools remain outside MCP; deployment
secret storage and rate limiting remain release work.

## 2026-08-02: Reuse the recomputation queue for complaint corrections

Correction invalidation must not create a second repair architecture or call
Temporal from the web transaction. Migration `0062` makes the existing
forced-RLS recomputation row accept one source-tombstone or correction
identity and adds a deferred trigger that queues one deterministic repair per
affected opportunity after correction invalidation. Worker reuses evidence and
seed checks; missing or unapproved seeds
remain blocked for operator inspection.

## 2026-08-02: Keep evidence redaction as a provenance-preserving projection

Migration `0067` adds an editor/owner-only, run-bound field-redaction receipt.
The database function retains source identifiers, capture/policy lineage,
original content hashes, and immutable analysis snapshots while replacing only
selected current display fields. Private collection, opportunity/leaderboard,
analysis, report, coding-plan, and export mappers apply the persisted masks;
stored derived objects are not
rewritten. A text mask is rejected while a raw source object reference exists,
so source-policy deletion and cloud/backup purge remain separate reviewed
operations. The stable generic marker avoids revealing the redaction reason or
original content, and receipt replay is idempotent with conflict on reuse.
