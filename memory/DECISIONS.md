# Decision memory

## 2026-07-10: Repository-native Codex structure

Use root and scoped `AGENTS.md`, `.agents/skills`, `.codex/agents`, and `.codex/config.toml`. Do not maintain a second custom hook or instruction system.

## 2026-07-10: Bounded guidance and memory

Keep the root `AGENTS.md` below 32 KiB. Put task state in `memory/ACTIVE.md`, reusable workflows in skills, and deep explanations in docs.

## 2026-07-10: Web first, desktop later

Treat the website contract as the source of truth. Stage a Tauri shell after the web experience and API contracts stabilize.

## 2026-07-10: Source policy before connector activation

Every source connector remains disabled until purpose, access, commercial use, quotas, retention, deletion, attribution, and display rules are reviewed.

## 2026-07-10: Sparse interface

The leaderboard page shows the ranked list only. Research, complaints, competitors, and coding plans use separate routes.

## 2026-07-10: Fixture-first implementation

Prove the complete product loop with labeled synthetic data before integrating live sources. Fixture mode is useful for deterministic tests and must never be presented as market evidence.

## 2026-07-11: PostgreSQL persistence and role separation

Use PostgreSQL 18 with forward, checksummed SQL migrations. A no-login role owns schema objects, a migrator may assume that owner for reviewed changes, and the runtime remains a non-owner without RLS bypass. Production role provisioning is deliberately out of band.

## 2026-07-11: Forced workspace RLS plus authorization

Enable and force one workspace policy on every workspace-scoped table. Set `appsea.workspace_id` only inside a transaction after application authorization. RLS is defense in depth and cannot establish workspace membership by itself.

## 2026-07-11: Immutable run lineage

Store current opportunity projections separately from immutable run links for clusters, competitors, source policies, acquired items, scores, plans, audit events, and outbox events. Use composite foreign keys to reject cross-run and cross-opportunity wiring.

## 2026-07-11: PostgreSQL is state, not the job queue

Keep workflow state, costs, idempotency records, and outbox events in PostgreSQL, but use a durable workflow engine for retries, timers, cancellation, and recovery rather than building a polling queue in database tables.

## 2026-07-11: Fixture report template is explicit

The current coding package generator supports only Inbox Relay fixture evidence. It must validate the canonical task-graph schema and serialize research-derived Markdown fields as inert JSON data until a reviewed general report composer exists.

## 2026-07-24: Temporal orchestration with PostgreSQL commit authority

Use the pinned Temporal TypeScript workflow package for scheduling, bounded
retries, cancellation, and recovery. Keep workflow history sanitized and small;
keep database/research side effects in activities. PostgreSQL remains the commit
authority for RLS, checkpoints, output lineage, and one-time ledgers. A
non-cancellable persistence safe point plus terminal reconciliation handles late
cancellation and response loss. The local Temporal Compose server is a
development-only proof, not a production deployment.

## 2026-07-24: Authenticated private workspaces

Store users and workspace memberships in PostgreSQL, hash passwords with scrypt,
hash opaque session tokens, and use HttpOnly SameSite cookies at the web boundary.
Every private read checks membership before setting the transaction-local RLS
context. Keep the public leaderboard database-free and synthetic. Durable
login/signup/reauthentication throttling and bounded session cleanup are
implemented. Member roster reads and role/removal mutations are owner-only, use
a serialized last-owner guard, require an explicit password step-up for a
15-minute session window, and emit identifier-only audit/outbox events. Account
recovery, invitations, account deletion, MFA/OIDC, and production identity
policy remain a separate reviewed tranche, with distributed deployment
validation still required.

## 2026-07-24: Durable source quota and deletion projections

Source quotas use PostgreSQL security-definer reservations: minute windows are
global across workspaces, reservation rows retain workspace/run/idempotency
lineage, and commit/release/expiry/purge are idempotent and workspace-scoped
under RLS. Connectors receive only a narrow ledger capability and fail closed
outside tests without it. Deletion tombstones use skip-locked claims with stale
lease recovery; source raw references are cleared, normalized evidence and
stored report/plan payloads are replaced with markers, and dependent
reports/plans become unavailable while provenance remains. Recomputing
complaint/cluster/opportunity projections and purging external objects/backups
remain open; active report/plan payloads are immutable after insertion.

## 2026-07-24: Review before report export

Keep report governance in the private workspace boundary. Owners and editors may
move a draft to `reviewed`; only owners may approve or withdraw; transitions are
monotonic and the database trigger repeats the role/order check while emitting
identifier-only audit/outbox receipts. Export returns only a schema-validated,
approved report read model with its manifest hash, never raw source payloads.
This proves an operator-safe fixture export without implying that non-fixture
object storage, retention, or deletion duties are complete.

## 2026-07-24: Explicit session inventory and revocation

Expose active authentication sessions through a private account-security route
using only stable session identifiers and timestamps. Revoke another session
only after same-origin password reauthentication, and reject attempts to revoke
the current session. The database query resolves the current token to a user
before updating the target, so a session identifier alone never grants access
to another user's authentication material; recovery, MFA/OIDC, and account
deletion remain separate identity work.

## 2026-07-24: Bounded maintenance runners and scheduler correlation

Keep source quota/deletion and authentication retention entry points as pure
runners behind strict contracts. Validate and cap inputs before repository
work, sort and deduplicate workspace IDs, give quota expiry and settled purge
independent budgets, and emit only bounded counters with a stable scheduler job
ID. The existing PostgreSQL operations are the idempotency boundary; do not add
a second polling queue or claim production scheduling until deployment,
alerting, and recovery ownership are reviewed.

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
workflow. Migrations `0028` and `0029` store a separate RLS-protected
job/checkpoint projection plus bounded policy-derived source-retention enqueue,
with an active-approved source-policy trigger, source-item/cost budgets,
terminal transition guards, hashed idempotency, and immutable
requesting-user/service attribution. The workflow deliberately uses the
PostgreSQL collection repository as its persistence authority and treats the
persist/complete boundary as non-cancellable. Direct CLI starts normalize into
the same canonical hashed idempotency domain as Temporal activities, and a settled quota
without a committed collection result stops for operator reconciliation rather
than issuing an unbounded retry. This proves the contract locally without
claiming production Temporal deployment, live source approval, object-store or
backup purge, aggregate recomputation, or downstream opportunity analysis.

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

Add a production-shaped, offline composition boundary that accepts only an
approved-shaped, non-fixture collection payload and an explicitly reviewed
opportunity seed. Normalization, deduplication, deterministic clustering, and
score calculation are code-owned; complaint text cannot infer factor values or
change a rank. The composer emits a production-mode artifact, evidence-backed
generic report, and six-file plan template with `testOnly` and transport
metadata. The sample uses redacted CFPB-shaped fixtures and never activates a
connector, writes production persistence, or claims market evidence. Durable
post-collection persistence, orchestration, object storage, and approval remain
the next tranche.

## 2026-07-26: Keep non-fixture blobs behind an object-store seam

Do not weaken the PostgreSQL plan/report storage boundary with inline JSONB for
non-fixture payloads. Add a content-addressed object reference contract and
deterministic in-memory/filesystem adapters first. References are workspace-
bound, hash-validated, immutable on replay, tombstoned before reads are
allowed, and purgeable only after retention expiry or an explicit deletion /
workspace-closure authorization. The local adapter proves behavior but is not
a production cloud deployment; encrypted S3-compatible storage, lifecycle and
backup deletion, database lineage, and private read wiring remain separate
reviewed work.

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

Source deletion invalidates mutable opportunity projections and must not be
undone by an ordinary update with the old collection run. Migration `0036`
allows a same-run reactivation only after a new production analysis has linked
its active score/plan output; that analysis is reconstructed from active,
confirmed, policy-allowed evidence and retains deletion coverage gaps. The
private reviewed analysis route can perform this repair explicitly, while
automatic scheduling and source re-collection remain separate approval-gated
work.

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
