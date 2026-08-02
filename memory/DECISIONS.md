# Decision memory

The six foundation decisions from 2026-07-10 are archived in
[`archive/DECISIONS-foundation-2026-07-10.md`](archive/DECISIONS-foundation-2026-07-10.md).

Foundation decisions remain archived; see linked file.

## 2026-07-24: Temporal orchestration with PostgreSQL commit authority

Use pinned Temporal workflows for scheduling, bounded retries, cancellation,
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

Keep recovery in the global authentication boundary. Persist only a SHA-256
reset-token hash plus an encrypted outbox copy protected by a deployment key;
install latest-only active-token uniqueness and expose only narrow
`SECURITY DEFINER` functions to the runtime role. The web request returns the
same generic accepted response for known and unknown addresses and never calls
an external provider synchronously. A bounded worker sends a fragment-only,
HMAC-signed, idempotent delivery with redirect blocking and fixed retry codes.
Production delivery stays kill-switched until verified identity/email policy,
provider retention/DPA, key rotation, monitoring, and failure-drill evidence
are approved.

## 2026-07-25: Existing-account workspace invitations

Implement workspace invitations as a separate owner-scoped, provider-neutral
outbox boundary. Store only a SHA-256 token hash in the invitation row and keep
the opaque token in encrypted delivery material; use three-day expiry,
pending-email uniqueness, bounded leases/retries, and identifier-only audit and
outbox receipts. Require the owner password step-up for issue/revoke and require
the accepting session's normalized email to match an existing AppSea account.
Do not create accounts, verify email ownership, or grant owner role until the
production identity/provider policy is reviewed. Keep both API and worker
delivery kill-switched by default.

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
production collection contract. Migration `0027` stores immutable source-policy
review evidence and grants draft registration/approval only to the migration
operator role; runtime workers may read an active approved snapshot but cannot
activate a source. The first production CFPB checkpoint persists only
policy-allowed, non-synthetic source items, redacted evidence, unreviewed
complaints, deletion tombstones, coverage gaps, and identifier-only audit/outbox
receipts through an idempotent PostgreSQL repository. It is intentionally not
called a full research run: clustering, competitors, scoring, reports, plans,
and production Temporal orchestration remain later stages. This preserves the
public synthetic leaderboard and makes the next boundary testable without
pretending legal approval or market completeness.

## 2026-07-25: Production collection workflow boundary

Keep the production collection Temporal workflow additive to the fixture
workflow. Migrations `0028`/`0029` store an RLS job/checkpoint projection,
policy-derived retention enqueue, source/cost budgets, terminal guards, hashed
idempotency, and immutable user/service attribution. PostgreSQL remains the
non-cancellable persistence authority; a settled quota without a committed
result stops for operator reconciliation. This proves the contract locally,
without claiming production Temporal, live-source approval, object/backups
purge, aggregate recomputation, or downstream opportunity analysis.

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

Keep acquisition ownership in `research_runs` and add migration `0030` for a
distinct `production_analysis_runs` projection. A production analysis may start
only from a completed production collection, the exact approved policy review
hash in that collection, and active complaint/evidence/source-item mappings.
Store redacted artifacts, reports, and plans through content-addressed object
references; retain only compact snapshots, hashes, output IDs, and lineage in
PostgreSQL. Replays return the existing result, while source deletion marks the
analysis unavailable without erasing its provenance. The Temporal
`productionAnalysisWorkflow` owns retry scheduling, but the repository owns
the commit/idempotency boundary. This preserves collection/analysis separation
and prevents a synthetic or unreviewed seed from entering production rows.

## 2026-07-26: Govern plan packages separately from reports

Treat coding-agent plans as executable-looking private artifacts with their own
editor/owner approval transition and export boundary. Migration `0031` keeps
reviewed plans distinct from report approval, requires a ready package and an
approved linked report before owner approval, and writes identifier-only
audit/outbox receipts. Private reads and exports hydrate and validate the
workspace-bound object before returning files; fixture inline files remain
supported. Its URI check also accepts only the existing deletion tombstone
marker for non-active non-synthetic rows, so source-deletion propagation remains
compatible without weakening the active object boundary. This prevents a draft
plan from being exported merely because its report was approved and keeps
object-backed production payloads out of JSONB.

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

Source deletion must not leave an invalidated opportunity dependent on a human
remembering to restart analysis, but it also must not re-fetch deleted source
records or invent a seed. Migration `0037` records one tenant-scoped job per
opportunity/tombstone in the propagation transaction, retaining collection,
seed, and tombstone lineage. A skip-locked worker dispatches only when the
opportunity is still invalidated, no active output exists, the seed is approved,
and active confirmed policy-allowed evidence can be reconstructed. Seed
withdrawal is visible as `blocked`; readiness and transient dispatch failures
are bounded retries; Temporal start is idempotent. Production scheduling,
alerting, and source re-collection remain separate deployment/review work.

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
`deletion-reconciliation` purpose and stores identifiers, page hashes, warnings,
and checkpoints. Migration `0041` persists warnings and idempotent pages; only
a warning-free short page in the lease tx may enqueue tombstones. A settled
quota without its checkpoint needs reconciliation; no auto-refetch.

## 2026-08-01: Admit manual analysis separately and bind its initiator

Manual production analysis is downstream, not source collection, so migration
`0042` gives it a separate digest/input admission ledger. The private route
binds the owner/editor; the worker consumes/releases with run persistence, and
the run stores an immutable membership-checked actor. The digest excludes the
actor so a workspace key cannot fork; actor remains in the input hash and a
mismatch conflicts. Consumed/released digests replay; expired reservations
alone are reclaimable.

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

## 2026-08-01: Fence

`0052` fences SQL mutations; external effects remain outside.

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

Use existing `research_campaigns` JSONB columns for strict `campaign-v1` writes
and a bounded legacy read union. Owners/editors create only `draft` campaigns;
members inspect source lifecycle/policy readiness. The repository rejects
unknown sources, fixture mixing, and approved-purpose mismatches, then writes
identifier-only audit/outbox receipts. It never starts Temporal or activates a
connector; workflow admission rechecks policy, quota, deletion, and budget.
No migration was needed because the table shape is additive.

## 2026-08-02: Start collection only from persisted campaign intent

The private campaign run route accepts only a bounded run/idempotency envelope.
It reconstructs source, query, purpose, display mode, limit, budget, and seed
lineage from the authenticated stored campaign, rechecks the current approved
policy, and commits the existing admission ledger before Temporal. The first
production boundary is exactly one non-synthetic source; multi-source fan-out,
scheduling, and connector activation remain explicit reviewed work.
