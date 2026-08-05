# Decision memory

Foundation decisions from 2026-07-10 are archived in
[`archive/DECISIONS-foundation-2026-07-10.md`](archive/DECISIONS-foundation-2026-07-10.md).

## 2026-07-24: Temporal orchestration with PostgreSQL commit authority

Use pinned Temporal workflows for retries, cancellation, and recovery with
sanitized history and activity side effects. PostgreSQL owns RLS, checkpoints,
lineage, and ledgers; persistence safe points reconcile late cancellation.
Compose is local proof, not production deployment.

## 2026-08-03: Global-auth TOTP MFA boundary

Browser TOTP stays outside research: encrypt secrets, hash recovery/challenges,
and issue sessions only after verification. OIDC and high-risk enforcement stay
separate.

## 2026-07-24: Authenticated private workspaces

Store users/memberships in PostgreSQL, hash passwords/tokens, and use HttpOnly
SameSite cookies. Private reads check membership before RLS; the public
leaderboard stays synthetic and owner mutations use last-owner/step-up guards.

## 2026-07-24: Durable source quota and deletion projections

Source quotas use security-definer reservations with global minute windows,
workspace/run/idempotency lineage, and idempotent commit/release/expiry. The
connector capability fails closed outside tests. Deletion tombstones clear raw
references, mark dependent outputs unavailable, and retain provenance; purge
and recomputation remain separate.

## 2026-07-24: Review before report export

Keep report governance private: editors/owners review, owners approve or
withdraw, and a database trigger repeats the role/order check with
identifier-only receipts. Export only a schema-validated approved read model
and manifest hash; fixture export is proven, non-fixture storage/retention is
not.

## 2026-07-24: Explicit session inventory and revocation

Expose active sessions privately with stable IDs/timestamps. Revoke another
only after same-origin password reauthentication; provider recovery and
deletion remain separate.

## 2026-07-24: Bounded maintenance runners and scheduler correlation

Quota/deletion and auth retention stay pure, bounded, independently budgeted,
and keyed by stable scheduler IDs; PostgreSQL owns idempotency.

## 2026-07-24: Provider-neutral password recovery boundary

Recovery remains global with hash-only tokens, encrypted outbox, generic
responses, and bounded idempotent delivery; production delivery stays
kill-switched pending identity/email, DPA, keys, monitoring, and approval.

## 2026-07-25: Existing-account workspace invitations

Keep invitations owner-scoped and provider-neutral: store a hash-only token,
encrypted delivery material, bounded expiry/retries, and identifier-only
receipts. Require owner step-up and an existing account email match. Do not
create accounts or verify ownership until identity/provider review; delivery
remains kill-switched.

## 2026-07-25: Shared-workspace-safe account closure

Account closure uses a password step-up plus `DELETE MY ACCOUNT`. Migration
`0026_account_closure.sql` checks the user at a security-definer boundary and
blocks closure while they own a workspace; transfer remains explicit. Once
unblocked, sessions/reset material are revoked, deliveries discarded, and the
profile anonymized. Shared memberships/research remain; this is not workspace,
export, object-store, or backup deletion.

## 2026-07-25: Policy-gated production collection checkpoint

Keep the complete fixture artifact contract unchanged while adding an additive
collection contract. Migration `0027` stores immutable source-policy review
evidence and keeps activation in the migration-operator boundary; runtime
workers can only read an active approved snapshot. The first CFPB checkpoint
persists policy-allowed non-synthetic items, redacted evidence, unreviewed
complaints, tombstones, coverage gaps, and idempotent identifier-only receipts.
It is not a full research run: clustering, competitors, scoring, reports, plans,
Temporal orchestration, legal approval, and market completeness remain separate.

## 2026-07-25: Production collection workflow boundary

Keep the production collection Temporal workflow additive to the fixture
workflow. Migrations `0028`/`0029` store RLS job/checkpoint state,
policy-derived retention, budgets, terminal guards, hashed idempotency, and
immutable user/service attribution. PostgreSQL is the non-cancellable
persistence authority; a settled quota without a result stops for operator
reconciliation. This proves the contract locally without claiming production
Temporal, live-source approval, purge, aggregate recomputation, or downstream
analysis.

## 2026-07-25: Policy-derived source retention

Enforce `retentionDays` and `deletionRequired` through a bounded
migration-owner function that queues deterministic tombstones and reuses the
skip-locked propagation path for redaction and report/plan invalidation. It
uses database time, skips fixture/purge-only policies without a matching purge,
and keeps budgets independent. `redact` and `tombstone` share source-deletion
semantics; field-level, object-store/backup purge, and recomputation remain
separate.

## 2026-07-26: Offline production analysis composition boundary

Keep an offline, production-shaped composition boundary accepting only reviewed
non-fixture input and seed. Code owns normalization, clustering, and scoring;
the sample is visibly test-only and never activates a source or claims market
evidence. Persistence, orchestration, storage, and approval remain separate.

## 2026-07-26: Keep non-fixture blobs behind an object-store seam

Keep non-fixture plan/report payloads behind a content-addressed object seam
with workspace-bound, hash-validated references and tombstone-before-read
behavior. The filesystem adapter is not cloud deployment;
encrypted storage, lifecycle, backup deletion, lineage, and private reads need
review.

## 2026-08-01: Queue invalidated analysis output purge separately

Keep source invalidation and external deletion separate. Migration `0043`
queues artifact/report/plan refs before commit; maintenance claims with stale
recovery, marks deleted, waits for `retentionUntil`, then purges with bounded
retries. Local orphan bodies are cleaned after sidecar loss. This is narrower
than source-wide, cloud/backup, closure, or export purge

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

Migration `0032` keeps curation separate: only active workspace editors/owners
change review state, identifier-only receipts preserve provenance, and
production analysis consumes confirmed observations without changing source
policy.

## 2026-07-26: Start analysis from persisted reviewed evidence

The private analysis-start route reconstructs policy/evidence lineage in one
workspace transaction, accepts only active confirmed excerpt evidence plus a
reviewed seed, and never accepts caller-supplied complaint payloads.

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

Migration `0038` adds a digest-only, advisory-locked admission ledger with
fixed workspace rate/active-job limits. Replays consume no slot; initialization
must consume the reservation or fail closed; maintenance purges terminal/
expired rows. Deployment configuration and Temporal authorization remain open.

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

Commit deletion-triggered repair claims before Temporal. Reclaim dispatching
rows older than 15 minutes from PostgreSQL's clock, bound claims, and record
fixed terminal failure; deterministic workflow IDs make late starts idempotent.

## 2026-08-01: Retry deletion propagation before terminal failure

Migration `0044` adds bounded attempts, server-clock retry timing, a 15-minute
stale lease, and fixed exhausted state. Partial redaction never looks complete;
completion remains idempotent.

## 2026-08-01: Version analysis and source-policy reviews

`0053` stores derived analysis; `0054` requires independent attested review
and re-review of legacy approvals.

## 2026-08-01: Keep competitive research state explicit

Private opportunity reads separate competitive-research state from competitor
rows: fixtures are synthetic/unresolved, approved seeds are reviewed-seed-only,
and source-backed requires permitted source IDs and retained evidence IDs.

## 2026-08-01: Persist campaign intent before collection

Use existing `research_campaigns` JSONB for strict `campaign-v1` intent and a
bounded legacy read union. Draft writes resolve policy readiness, reject
mismatches, record identifier-only receipts, and never start Temporal or
activate a connector; admission rechecks quota, deletion, and budget.

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
reconciles child projections into parent/campaign state without treating
policy denial as missing evidence.

## 2026-08-03: Keep coding-agent access workspace-scoped and read-only

Migration `0069` and `/api/mcp` provide an expiring, hash-only owner token
after step-up. MCP is workspace-bound, scope-filtered, read-only, and
preserves coverage, redaction, and approved report/plan state; workflow,
activation, deletion, deployment, and credentials remain outside MCP.

## 2026-08-03: Persist cancellation intent before calling Temporal

Migrations `0070`/`0071` record immutable owner/editor intent before Temporal
for both run types. Queued children stop; dispatching claims stay owned until
their workflow identity is recorded. The worker retries external cancellation;
each workflow remains terminal authority during Temporal outages.

## 2026-08-03: Paginate private campaign history with stable cursors

Use bounded request-time plus identifier cursors, not offsets. A base64url
cursor is validated as identifier-only and carries no hash, source content, or
authorization state; authenticated transactions bind every page to its
workspace, with one- and multi-source histories advancing independently.

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
analysis, report, coding-plan, and export mappers apply persisted masks; stored
derived objects are not rewritten. Text masking is rejected while a raw source
object reference exists. Receipt replay is idempotent and conflicts on reuse.

## 2026-08-03: Persist purge intent without authorizing deletion

Migration `0073` records an owner-confirmed database-ready snapshot as an
`awaiting_external_controls` intent with identifier-only receipts; it never
authorizes cloud/object/export/backup deletion, and replay/cancellation remain
explicit.

## 2026-08-04: Keep purge manifests metadata-only and provider-neutral

Migration `0083` stores an expiring per-workspace object inventory/hash after
archival; `0084`/`0085` repair PostgreSQL/read-only behavior. Deduplicated
URI/kinds and identifier-only receipts stay behind owner/password-MFA step-up,
RLS, confirmation, and a metadata-only non-deleting boundary.

## 2026-08-03: Require conditional MFA for password-gated mutations

Migration `0081` adds a session MFA timestamp consumed by password-gated
high-risk mutations; accounts without MFA retain password-only auth, while
provider identity/key rotation and unrelated mutation contracts stay separate.

## 2026-08-03: Drain legacy Temporal histories without decoding them

New production-analysis v2 starts carry a strict identifier-only memo. A
visibility-only checker and reviewed manifest classify legacy/unknown runs and
fail closed before the v1 worker is removed; archive/deletion stays an approved
deployment operation and never occurs in workflow code.

## 2026-08-05: Guard private decisions and auth ingress

Migration `0105` makes lifecycle decisions forced-RLS, append-only,
idempotent, stale-checked, and bound to identifier-only evidence/analysis.
Owner approval requires deep-research/report/plan gates; step-up and scalar
receipts are required. Fixtures/MCP stay read-only. Auth mutations stream 32
KiB and return `413` before parsing oversized bodies.

## 2026-08-05: Require human review for complaint clusters

Migration `0106` records owner/editor curation in a forced-RLS append-only
ledger with stale hashes, bounded split/merge IDs, and redaction-safe snapshots.
Fixtures stay read-only; the gate fails closed until every non-synthetic cluster
is reviewed or confirmed.

## 2026-08-06: Keep source observability bounded and additive

Health/freshness are private projections; stale or missing observations never
imply absent complaints. Migration `0107` adds an authenticated read of shared
current-minute quota capacity; reservation and mutation stay outside it.

## 2026-08-06: Carry the reviewed policy payload into connector execution

`readCollectible` returns hash-verified policy JSON with the activation snapshot.
Production connectors compare immutable purpose/quota/retention/deletion/display
fields before a request; missing snapshots fail closed. Activation remains
database-owned; no source is activated autonomously.
