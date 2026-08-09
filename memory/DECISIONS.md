# Decisions

## 2026-08-06: Provider-neutral model boundary before provider activation

Route imported complaint text through `packages/model-gateway` as context plus
`untrusted-data`; bind each request to a workspace. Allowlist versions,
redact secrets/PII, refuse instructions, enforce budgets/idempotency, and store
hashes/findings/counters only. Deterministic
or human-corrected analysis stays authoritative; external providers wait for
model-use, DPA/retention/training, egress, malware, durable cost/idempotency,
and calibration.

## 2026-07-24: Temporal orchestration with PostgreSQL commit authority

Use pinned Temporal workflows for retry, cancellation, and recovery with
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

Keep report governance private: editors/owners review, owners approve/withdraw,
and a database trigger repeats role/order checks. Export only a schema-validated
approved read model and manifest hash; non-fixture storage/retention is open.

## 2026-07-24: Explicit session inventory and revocation

Expose active sessions privately with stable IDs/timestamps. Revoke another
only after same-origin password reauthentication; provider recovery and
deletion remain separate.

## 2026-07-24: Bounded maintenance runners and scheduler correlation

Quota/deletion and auth retention stay pure, bounded, independently budgeted,
and keyed by stable scheduler IDs; PostgreSQL owns idempotency.

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

Keep the fixture artifact contract unchanged while adding collection. Migration
`0027` stores immutable source-policy review evidence; workers read only an
active approved snapshot. The CFPB checkpoint persists allowed non-synthetic
items, redacted evidence, complaints, tombstones, gaps, and identifier receipts;
clustering, scoring, reports, plans, orchestration, and legal approval remain
separate.

## 2026-07-25: Production collection workflow boundary

Keep production collection Temporal additive to fixtures. Migrations
`0028`/`0029` store RLS checkpoints, policy retention, budgets, terminal guards,
hashed idempotency, and attribution. PostgreSQL is non-cancellable authority;
settled quota without a result stops for reconciliation. This is local proof,
not production Temporal/live-source/purge/downstream analysis.

## 2026-07-25: Policy-derived source retention

Enforce `retentionDays`/`deletionRequired` with bounded database-time
tombstones and skip-locked propagation. Keep fixture/purge-only policies,
field-level/object-store/backup purge, and recomputation separate.

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

Require downstream analysis inputs to carry policy version/content hash,
approval review ID, distinct analysis-run ID, and evidence/source-item IDs and
hashes for every retained complaint. Product, competitor, contrary-signal, and
score assumptions stay in a reviewed seed envelope; reports map observations
to evidence IDs. The production projection, object references, and workflow
preserve this boundary.

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

Migration `0032` keeps curation separate: active editors/owners change review
state, identifier-only receipts preserve provenance, and production analysis
consumes confirmed observations without changing source policy.

## 2026-07-26: Start analysis from persisted reviewed evidence

The private analysis-start route reconstructs policy/evidence lineage in one
workspace transaction, accepts only active confirmed excerpt evidence plus a
reviewed seed, and never accepts caller-supplied complaint payloads.

## 2026-07-26: Persist and approve opportunity seeds before analysis

Opportunity product, competitor, contrary-signal, and score assumptions are
workspace-owned input, not inferred evidence. Migration `0033` stores immutable
content-hashed seeds; editors review and owners approve/withdraw. Private start
and persistence require the approved seed ID/version/hash, preventing retries
or direct workers from substituting an unreviewed envelope.

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

Migration `0067` adds an editor/owner-only, run-bound redaction receipt. It
retains source/policy lineage, hashes, and immutable analysis snapshots while
masking selected current display fields across private reads/exports; derived
objects are not rewritten. Text masking requires prior raw-object deletion;
receipts replay idempotently and conflict on reuse.

## 2026-08-03: Persist purge intent without authorizing deletion

Migration `0073` records an owner-confirmed `awaiting_external_controls`
snapshot with identifier-only receipts; it never authorizes cloud/object/
export/backup deletion, and replay/cancellation remain explicit.

## 2026-08-04: Keep purge manifests metadata-only and provider-neutral

Migration `0083` stores an expiring archived-workspace object inventory/hash;
`0084`/`0085` repair PostgreSQL/read-only behavior. URI kinds and receipts stay
behind owner/password-MFA step-up, RLS, confirmation, and a non-deleting gate.

## 2026-08-03: Require conditional MFA for password-gated mutations

Migration `0081` adds a session MFA timestamp consumed by password-gated
high-risk mutations; accounts without MFA retain password-only auth.

## 2026-08-03: Drain legacy Temporal histories without decoding them

Production-analysis v2 starts carry an identifier-only memo; the visibility-only
checker and reviewed manifest fail closed before v1 removal. Archive/deletion is
an approved deployment operation, never workflow code.

## 2026-08-05: Guard decisions, ingress, and cluster review

Migrations `0105`/`0106` make lifecycle decisions and cluster curation
forced-RLS, append-only, idempotent, stale-checked, step-up-protected, and
identifier-only. Deep-research/report/plan gates and human cluster review stay
required; fixtures/MCP remain read-only. Auth mutations cap bodies at 32 KiB.

## 2026-08-06: Keep source observability and policy payloads bounded

`0107`–`0111` keep health/quota/alerts private and additive; missing data never
means absence. `readCollectible` returns a hash-verified policy snapshot, and
connectors fail closed when immutable review metadata is absent. No fetch or
activation occurs in these reads.

## 2026-08-06: Audit exports and isolate instruction-like evidence

Approved report/plan exports record identifier-only receipts after hydration and
redaction; this is accountability, not purge authority. Complaint analysis
v0.2.0 flags instruction-like fixture/import text in `manipulationRisk` and
`policyFlags`, preserves provenance, requires private review, and never executes
or writes repository controls. No migration is needed.

## 2026-08-06: Enforce complete reviews and policy-decay safety

`0114`–`0118` require complete independent role/hash reviews, reject identity
reuse, and close direct activation/replay/lineage bypasses. `0119` adds fenced
non-destructive expiry when a completed analysis loses collectibility; pointers
repair or clear, private reads/exports fail closed, lineage remains reviewable,
and later source deletion performs destructive purge. Reapproval never
auto-reactivates an expired output.

## 2026-08-09: Render private Markdown on demand until purge proof exists

Versioned rows already provide immutable history and lineage, so history and
selected reads reuse membership, current-policy, deletion, hydration, redaction,
and approval gates. Markdown renders only after that projection; persisting
`report-markdown` waits for deletion, export-retention, and backup purge proof.
JSON/Markdown have separate audit idempotency keys. The leaderboard and latest-
only MCP stay unchanged; the UI shows a 50-row `truncated` bound and plan
comparison returns only sorted path status/hash/byte metadata.
The transitive `nanoid` high finding is pinned to patched `3.3.17`; the
production audit is clean.
