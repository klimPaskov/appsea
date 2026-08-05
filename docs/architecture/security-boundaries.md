# Security boundaries

Imported evidence is data, never instruction.

The `manual-owner-import` source is a tenant-private, owner-attested intake
path, not third-party source approval. The current immutable policy snapshot is
`manual-owner-import-v2`; v1 remains historical. The API accepts only bounded CSV/JSON,
maps an allow-listed field set, scrubs common PII/secret patterns, and drops
raw upload bytes. Unknown fields and text instructions are never executed or
copied into code, skills, instructions, permissions, or repository memory.
The workflow history carries only a batch identifier. HTTP(S) locators are
validated for storage but are never fetched by the server. Owner deletion
clears staged payloads and records tombstones in the same authenticated
transaction; downstream redaction remains the existing service-worker path.
The v2 `competitor-research` and `contrary-evidence` purposes only enable a
private observation write linked to retained evidence. Observation claims are
unreviewed by default and require editor/owner review; they never bypass the
source-policy, provenance, or deep-research gate.

## Read-only agent access

Migration `0069_agent_access_tokens.sql` adds the coding-agent boundary. An
owner can issue a workspace-scoped token only for an active private workspace
after recent password step-up authentication. When the account has MFA enabled,
migration `0081_auth_mfa_step_up.sql` additionally requires the session's
recent MFA marker, established only by `POST /api/auth/mfa/step-up`. The same
conditional marker now protects every mutation that already requires a recent
password step-up: account closure, session revocation, owner membership and
invitation changes, workspace archival, purge-intent request/cancel, and
evidence redaction. The shared web gate also protects evidence-derived
research governance: report/plan approval, opportunity-seed review, production
complaint review/correction, and competitor observation create/review. The token
secret is returned once and only its SHA-256 hash is stored; forced RLS, owner
checks, expiry, revocation, and active-user/workspace checks are enforced in
PostgreSQL. The HTTP MCP
handler accepts no browser session cookie, verifies the bearer on every
request, requires the workspace argument/URI to match the token, and filters
tools by one of five read scopes. It returns only policy-bounded evidence
representations, provenance, redaction state, coverage gaps, and approved
non-synthetic report/plan artifacts. No workflow, source activation, policy,
deployment, credential, or other mutation tool is exposed. Token audit/outbox
receipts contain identifiers and scope metadata only. MFA step-up consumes a
current TOTP or one recovery code without sending the code to the token
repository or exposing it in a read model. Accounts without enabled MFA remain
on the password-only compatibility path; enrollment turns on the additional
gate automatically. Migration `0097` re-checks current workspace membership
during bearer authentication and durable request admission. It enforces a
server-clock 60-per-60-second token window, four in-flight leases, and
30-second stale-lease recovery; the handler releases each lease in a `finally`
path and returns a fixed `429`/`Retry-After` on bounded denial. MCP resource
descriptor labels are static so untrusted opportunity names and summaries
cannot become agent-facing protocol instructions; those values remain payload
data.

Audit history is a separate read-only projection at
`GET /api/workspaces/:workspaceId/audit-events`. The repository repeats
authenticated membership/RLS checks and orders events by server-recorded time
with an opaque workspace-bound cursor. The response contains only bounded
identifiers, fixed actor/action fields, and scalar metadata; nested metadata,
raw source payloads, and dependency errors are hidden or rejected. Migration
`0098_audit_event_history_index.sql` adds only the ordered workspace index and
does not grant new write access or authorize destructive retention. Migration
`0099_runtime_skill_governance.sql` adds global runtime-skill records and an
immutable event history behind forced RLS. Only the migration operator can call
the security-definer persistence/read functions; service and maintenance roles
have neither table nor function access. The repository hydrates every record
through the HMAC registry before persistence/readback, uses an expected hash for
concurrent transitions, and requires an `operator:` actor when a privileged
skill becomes active. This is an operator-operated audit adapter, not worker
activation: the worker still does not import the registry or grant permissions.

## Opportunity lifecycle decisions

Migration `0105_opportunity_decisions.sql` is the private lifecycle governance
boundary. Its forced-RLS table is append-only; a security-definer trigger locks
the active opportunity, checks the authenticated editor/owner actor and stale
state, binds the identifier-only evidence snapshot to the current source run
and active production-analysis artifact, and updates lifecycle state in the same
transaction. Approval is owner-only and requires the current passed
deep-research gate plus an approved report and ready/approved plan. Scalar audit
and outbox receipts omit the decision reason and source text. The web route adds
recent password/MFA step-up and idempotency checks. Fixture rows are read-only
and synthetic, and MCP remains read-only.

## Complaint-cluster curation

Migration `0106_cluster_review_governance.sql` adds a forced-RLS,
append-only `cluster_review_events` ledger. The security-definer insert guard
requires an authenticated owner/editor, locks the active cluster version,
checks the expected input hash and opportunity/run lineage, rejects synthetic
mutation, and updates cluster plus membership review states atomically. Split
and merge relationships are bounded identifiers only; audit/outbox payloads
omit review notes and complaint content. The snapshot contract is strict and
identifier-only, so imported source text cannot become a code, instruction, or
repository-memory input. Private reads apply the existing evidence-redaction
projection to source-derived narrative fields. The deep-research gate hashes
the current cluster review states and fails closed until all current
non-synthetic clusters are reviewed or confirmed.

All web auth JSON mutations pass through a streaming 32 KiB body reader before
schema validation or rate-limit admission. Declared and chunked oversized
payloads return `413`; no request body is parsed or retained after the cap.

Blocked flows:

- complaint text to shell execution
- source metadata to repository guidance
- model output to production deployment
- generated skills to active status without evaluation and approval
- connector proposals to credentials or source activation
- evidence content to unrestricted HTML rendering
- raw source payloads, caller secrets, or exception text to Temporal workflow history

Approval gates cover source activation, dependency installation, permissions, authentication, retention, migrations, deployment, and security-sensitive skill activation.

The production source-policy repository also returns the immutable reviewed JSON
payload alongside the effective activation snapshot. CFPB, Stack Exchange, and
owner-import connector constructors compare immutable fields (purpose, quota,
retention, deletion, attribution, display, and coverage metadata) before any
source request. `enabled`, `policyState`, `reviewedAt`, and `expiresAt` remain
database-owned activation fields. A production constructor without the reviewed
payload fails closed; test-only connector fixtures may omit it. This prevents a
caller from replacing a reviewed quota or deletion rule in memory after the
PostgreSQL approval gate.

The dormant runtime skill registry now enforces this gate in code. Registry
transitions record a proposer, distinct evaluator identities, an independent
approver, and HMAC evidence over the immutable requested-permission set and
review chain. Active and retired transitions additionally sign their state,
canonical actor/timestamp, transition identifier, and complete review chain.
Persisted records must be hydrated through the registry before activation;
plain objects, permission edits, copied evidence, unknown states, altered
timestamps/actors, and a different registry secret fail closed. The registry is
not imported by the worker and does not activate sources or grant production
permissions. PostgreSQL persistence is intentionally dormant until an explicit
operator operation supplies reviewed evidence.

## Database enforcement

Authentication is a separate boundary: `users.password_hash` contains only
versioned scrypt hashes, `auth_sessions.token_hash` contains only SHA-256 token
hashes, and session reads reject expired or revoked rows. Workspace reads use
`withAuthenticatedWorkspaceTransaction`, which checks `workspace_memberships`
before setting the transaction-local RLS context. Memberships have a narrow
null-context RLS branch keyed to the authenticated-user transaction GUC solely
for that pre-context authorization lookup.

- The schema owner cannot log in; the migration login may assume it only for reviewed migrations.
- The service role is a non-owner without superuser or RLS-bypass privileges.
- Workspace tables enable and force RLS. A missing transaction-local workspace context fails closed.
- RLS is defense in depth, not authentication: an authenticated authorization layer must validate workspace membership before setting the context.
- Runtime code cannot write global source or policy tables directly, override an operator/policy kill switch, rewrite immutable snapshots, erase audit/cost history, or truncate tables.
- Migration `0027` records source-policy review evidence and exposes draft
  registration/approval only to the migration operator role. The runtime can
  read an active approved snapshot but cannot activate a connector. Production
  collection additionally compares the connector snapshot with the approved
  database policy before inserting any source item.
- Migration `0054` stores a lowercase reviewer identity, allowed independent
  review role, and explicit independence attestation on new approvals. A
  trigger rejects unattested or self-owned approvals, and pre-0054 approvals
  are conservatively disabled until re-reviewed. This strengthens the gate but
  does not grant legal, privacy, or security approval or activate a source.
- The private source-registry read is a separate authenticated, read-only
  projection. `GET /api/workspaces/:workspaceId/sources` requires private
  workspace membership and a transaction-local authorization check; the
  repository derives enabled/collectible state from lifecycle, current
  approved policy, expiry, and independent review. It excludes policy
  payloads, content hashes, reviewer identities, and activation methods, and
  never mutates the global source registry.
- The same source-registry projection exposes bounded connector health derived
  from workspace-local collection workflow state, retained active source-item
  timestamps/counts, and pending deletion tombstones. It returns fixed health
  states, timestamps, counters, and failure codes only; raw failure summaries,
  provider payloads, credentials, policy hashes, and reviewer identities stay
  outside the read model. Health is observational and cannot activate a source,
  retry a run, settle quota, or alter deletion state.
- The source-registry health projection derives a separate bounded freshness
  state from the reviewed optional policy freshness metadata and the latest
  retained source observation. It uses only fixed `fresh`, `stale`, `unknown`,
  `on_demand`, or `blocked` values plus age/threshold metadata; legacy policies
  remain unknown, and a blocked or non-collectible source cannot be shown as
  fresh. The optional JSONB field preserves legacy content hashes, while any
  reviewed threshold change still requires a new immutable policy version and
  approval. No source fetch, schedule mutation, or retry is exposed.
- Migration `0107` adds `read_source_quota_headroom`, a security-definer,
  workspace-context-required read of the shared current-minute quota window.
  The authenticated registry receives only limit, used, remaining, and window
  timestamps; direct runtime access to `source_quota_windows` remains revoked.
  The function never reserves, settles, releases, refunds, or exposes
  workspace-specific reservation rows, and pending/expired policies return no
  usable headroom.
- Migrations `0108` and `0109` add the maintenance-only source-health alert
  boundary. `read_source_health_alert_observations` is a security-definer
  function guarded by `session_user = 'appsea_maintenance'`; it returns only
  bounded source ID, collectibility, health/freshness/quota states, an attempt
  timestamp, and freshness age for one active workspace at a time. The
  scheduler and scalar operational-alert allowlists are extended by forward
  migration, while source policy JSON, complaint text, provider payloads,
  credentials, and activation/mutation capability remain inaccessible. A
  truncated scan is reported as incomplete and cannot be interpreted as clear.
- Research campaign creation is a separate private boundary. The web route
  requires an authenticated owner/editor and same-origin request; the
  repository repeats membership and private-workspace checks inside an RLS
  transaction. Source IDs must exist in the global registry, fixture and
  non-fixture sources cannot be mixed, and an approved policy must list the
  requested purpose. Pending or unavailable policies may be recorded only as
  visible readiness gaps. Creation writes identifier-only audit/outbox
  receipts and cannot activate a connector or start a workflow; later job
  admission must recheck policy and budgets. The authenticated campaign-run
  route accepts only a run/idempotency envelope and derives source, query,
  purpose, display mode, limit, and budget from the stored campaign. It
  verifies any approved seed review, and commits the existing admission ledger
  before Temporal. A two-to-sixteen-source non-fixture request enters the
  migration `0068` parent/child queue instead: each child has its own
  policy/version check, service admission, deterministic child identity, claim
  lease, and bounded retry state. It returns private no-store errors for
  pending policy and admission conflicts; it cannot activate a connector or
  fan out to an unreviewed source.
- Campaign run history is a separate read-only projection. The repository
  repeats authenticated membership/RLS checks, limits results to 100 recent
  production rows, and omits idempotency digests, input hashes, actor details,
  and source payloads. The status page can link to evidence only after a
  completed run, preserving the collection policy/display gate.
- Multi-source orchestration history is a separate forced-RLS read model. The
  authenticated list/detail routes expose at most 100 parent requests with
  bounded child state, attempt count, policy/workflow identifiers, and fixed
  failure summaries. They do not expose caller keys, hashes, source payloads,
  policy-review hashes, or imported instructions. Archived/paused campaigns
  cannot receive new child claims, and the service worker must recheck the
  current approved independent policy before admission and Temporal start.
  Migration `0070` adds an owner/editor cancellation boundary for these
  orchestrations. The request is committed in the authenticated RLS transaction
  before any Temporal call, bound to the immutable member identity, and retained
  as an identifier-only audit/outbox event. Queued children are canceled in the
  database; dispatching claims stay owned until an external workflow identity is
  recorded; started children are canceled by the server/lease-backed worker and
  only become terminal after safe reconciliation. A failed provider call cannot
  erase the intent or authorize a new dispatch, and the response never returns
  child workflow IDs.
- Migration `0071` applies the same boundary to one-source production
  collection jobs. Owner/editor intent is immutable, bound to the authenticated
  member and active private non-fixture workspace, and committed before the
  route attempts Temporal cancellation. The maintenance role may only read the
  pending projection and retry the external call; it cannot mark the job
  terminal. The workflow's non-cancellable termination activity owns that
  transition, so a cancellation racing the persistence safe point reconciles to
  a completed collection rather than erasing evidence.
- The reviewed analysis handoff has a separate safe status projection. The
  owner/editor start action sends only identifiers and an idempotency envelope;
  the status API/page validates any workflow identifier against the workspace
  prefix, reads Temporal or the authenticated PostgreSQL fallback, and returns
  only state, checkpoint, bounded attempts, availability, identifiers,
  failure summary, and timestamps. Hashes, object references, source payloads,
  and seed content are excluded by strict contracts.
- Migration `0032` makes complaint curation an explicit workspace boundary:
  only active workspace editors and owners can transition an active complaint
  observation from `unreviewed` to `confirmed`/`rejected` or from `confirmed`
  to `rejected`. Review audit/outbox receipts contain identifiers and state,
  never complaint text, and deleted evidence cannot be reviewed.
- Migration `0053` stores derived complaint analysis in a validated JSONB
  snapshot. The deterministic extractor receives already policy-checked
  evidence, records its version and confidence, and emits no competitor or
  substitute relation without a reviewed source. Imported text remains data,
  and analysis output cannot write instructions, code, skills, or memory.
- The private competitors/contrary-signals read model records competitive
  research state and seed-review provenance separately from complaint evidence.
  It cannot label a synthetic or reviewed-seed-only record source-backed;
  source-backed status requires a confirmed non-synthetic observation with
  retained source/evidence identifiers plus an observation time. Migration
  `0059` forces each non-synthetic observation through an active source item,
  matching retained evidence, an independently approved `competitor-research`
  purpose, and an editor/owner review guard. The read model exposes only the
  bounded paraphrase and provenance metadata; raw provider payloads remain
  outside the table and web contract.
- Migration `0063` stores competitor feature comparisons as a bounded JSONB
  matrix with explicit `fixture`, `reviewed-seed`, `source-observation`, or
  `mixed` provenance. Production seeds are limited to reviewed-seed entries;
  source-backed entries must identify retained competitive observations. The
  public and private UI renders the normalized status, notes, and identifiers
  only, so imported provider content cannot become executable instructions or
  repository guidance through this surface.
- Migration `0033` makes opportunity-seed assumptions an explicit workspace
  boundary. Seed content is validated before insertion, immutable after create,
  and transitions through `unreviewed` -> `reviewed` -> `approved` only through
  editor/owner actors; only owners can approve or withdraw. Audit/outbox
  receipts contain the seed identifier and content hash, not the seed text.
  Analysis start and persistence both require the approved stored hash/version,
  so a caller cannot inline or substitute seed assumptions.
- Migration `0034` makes automatic analysis an explicit reviewed handoff:
  collection workflow inputs may name only an approved seed review, the
  handoff stores identifiers and derived hashes rather than complaint content,
  and the worker reconstructs active policy/evidence lineage before starting
  Temporal. Handoff claims are skip-locked and stale claims are reclaimable;
  a handoff cannot activate a connector or bypass complaint confirmation.
- Migration `0035` makes source-deletion invalidation visible in the mutable
  opportunity projection. Propagation clears current score/plan pointers and
  records bounded invalidation metadata only when no completed active analysis
  remains; a later analysis on a new collection run may reactivate the same
  opportunity. Immutable clusters, score snapshots, and lineage remain
  traceable, and deletion never triggers an unreviewed source recollection.
- Migration `0036` also permits a same-run repair only after a new active
  analysis output is linked to the opportunity. The analysis must be built from
  active, confirmed, policy-allowed evidence; deleted records remain excluded
  and visible as coverage gaps. No source acquisition or policy bypass is
  introduced by this recovery path.
- Migration `0037` queues that repair in the deletion transaction with the
  source tombstone, collection run, opportunity, and immutable seed review
  lineage. The worker blocks an unapproved or mismatched seed, retries only
  bounded readiness/dispatch failures, reclaims server-clock-stale
  `dispatching` claims, terminalizes exhausted claims, and starts Temporal
  idempotently; it never re-fetches a source record or accepts caller-supplied
  complaint text.
- Migration `0062` extends the same forced-RLS row with a correction identity
  and a deferred trigger that queues one deterministic repair after the
  correction invalidation is committed. The correction path reuses the active
  evidence and approved-seed gates; it cannot create a source tombstone or
  bypass review.
- Migration `0038` places an authenticated production collection start behind
  a security-definer admission function. The function verifies the active
  private non-fixture workspace and owner/editor membership, serializes one
  workspace's rate bucket and active-job/reservation count under an advisory
  lock, and stores only hashed idempotency/input digests. Replays do not
  consume another slot; workflow initialization consumes the reservation, and
  bounded maintenance purges terminal or expired rows. Initialization fails
  closed and rolls back if the reservation cannot be consumed on either the
  existing-job or insert path. The limits are fixed in the reviewed migration
  rather than accepted from request input.
- Migration `0051` extends that same function for the direct CFPB command. The
  command must establish the transaction-local `appsea-worker` principal on
  the `appsea_service` runtime role and target an active private non-fixture
  workspace. It shares the rate/concurrency counters, reserves and consumes a
  digest/input admission immediately before the external request, and fails
  closed without a service principal; it is not an unauthenticated second
  ingress path.
- Migration `0042` applies the same fail-closed boundary to the manual
  production-analysis route. The route binds the authenticated owner/editor
  to a digest-only reservation before contacting Temporal; the worker consumes
  that reservation in the same transaction as analysis-run creation and
  releases it on terminal failure or completion. The run stores an immutable
  user/service actor, the insert trigger verifies user membership, and
  consumed/released digests replay without another admission slot. The
  separate ledger cannot authorize collection or source access.
- Migration `0039` places the external fetch itself behind a forced-RLS,
  digest-only collection lease. Acquisition requires the current active source,
  policy version, and matching operator approval review; retries replay the
  stored observed timestamp. The persistence repository asserts the lease and
  policy inside the same transaction that writes the collection result, locking
  the lease row through commit; release happens only after commit. Uncertain
  quota settlement or inactive leases remain explicit reconciliation states.
  Runtime code has no direct lease-table write grant.
- Migrations `0040` and `0041` place full-snapshot deletion inference behind a
  policy-gated, forced-RLS job and immutable identifier-only page checkpoints.
  The CFPB worker never stages narratives, preserves malformed/capped traversal
  warnings across retries, and cannot enqueue tombstones unless a warning-free
  short page was observed. Final identifier comparison, lease assertion, and
  tombstone insertion share one transaction; scheduler claims do not require a
  raw caller idempotency key.
- Migration `0045` adds a separate source-reconciliation admission boundary.
  Authenticated owner/editor requests are checked inside the same transaction
  as the durable job insert, with workspace-scoped five-start/15-minute and
  one-active-job limits. The job stores an immutable user or `appsea-worker`
  actor; the direct worker command must establish the service principal and an
  active private non-fixture workspace. The source-policy trigger remains a
  separate gate, so admission cannot activate a connector or bypass review.
- Source-item acquisition policy and evidence display representation are relationally enforced.
- Fixture report generation keeps retained observations, deterministic score
  inference, contrary evidence, recommendation, and source coverage in separate
  validated fields; private reads additionally require active source/evidence
  rows and synthetic or explicitly redacted evidence.
- Production report and plan payloads are object-backed and decoded through
  workspace-bound references before private reads or export. Reports and plans
  have separate role-checked approval transitions; plan approval additionally
  requires a ready package and an approved linked report.
- Source quota windows are global and mutable only through security-definer
  functions that re-check the active approved policy; reservation keys are
  hashed and workspace-scoped. The runtime role cannot rewrite counters.
- Cross-workspace maintenance enumerates active IDs only through the narrowly
  granted `appsea.list_active_workspaces_for_maintenance()` function, owned by
  the migration role; direct runtime workspace reads remain forced-RLS
  fail-closed.
- Deletion propagation uses skip-locked tombstone claims with server-clock
  stale-lease recovery, bounded retry scheduling, and exhausted terminal
  failure. It preserves the first tombstone link, clears raw source references,
  redacts normalized evidence, replaces stored report/plan payloads with
  deletion markers, and marks reports/plans unavailable. Active
  source/evidence/report/plan payloads and terminal tombstone fields are
  immutable after insert/transition. Migration `0043` queues complete
  artifact/report/plan references for invalidated production analyses; the
  object worker marks them deleted, waits for immutable retention, and purges
  with bounded stale-claim recovery. The signed S3-compatible adapter rejects
  redirects, validates content hashes, and uses conditional sidecar writes;
  provider encryption, backups, workspace closure, and export deletion require
  separate reviewed deployment workers;
  stale-claim ownership processing rows require a non-null lease start, while
  migration `0044` keeps retryable failures inspectable and blocks re-entry
  after the attempt budget is exhausted. Stale-claim ownership races outside
  this queue still need a claim-token design.
- `appsea.users`, `appsea.auth_sessions`, and `appsea.workspace_memberships` store only
  scrypt password hashes and SHA-256 session-token hashes. The web boundary uses an
  `HttpOnly`, `SameSite=Lax` cookie and revokes sessions durably. Production uses
  a fixed HTTPS origin and a `__Host-` cookie; login/signup attempt buckets are
  hashed and rate-limited durably in PostgreSQL, with a bounded cleanup job.
  High-risk owner mutations require an explicit password verification that
  writes only a 15-minute `last_reauthenticated_at` timestamp on the session;
  the password and timestamp never enter read models or logs. The private
  account-security route exposes only bounded identifier/timestamp summaries;
  per-session revocation first resolves the current token to the same user and
  cannot target the current session.
- Private API and page reads authorize membership in the same transaction before
  setting `appsea.workspace_id`; a caller cannot select a workspace by changing a
  request parameter alone. Public leaderboard routes remain database-free fixture
  routes.
- The private workspace cost summary repeats membership authorization inside a
  read-only transaction, then aggregates only immutable ledger amounts. It keeps
  currencies separate, uses exact micro-unit strings, bounds the period, and
  never returns source/run identifiers or database errors.
- Migration `0049` makes a settled source-quota reservation without a completed
  production result an explicit forced-RLS reconciliation case. Workspace
  inspection repeats membership authorization and exposes only bounded source,
  policy, run, reservation, record/cost, and timestamp fields. The backing table
  has no direct runtime grants. Only the standalone `appsea_maintenance` role
  may resolve a case; a linked resolution must match the exact completed
  production run, while a voided resolution records that no result exists.
  Neither resolution changes quota history or permits a re-fetch.
- Migration `0050` adds an explicit source-recollection lineage boundary. A
  request must name a completed tombstone in the same workspace and source and
  must fetch exactly one source-native record. Workflow, run, and source-item
  links are immutable; synthetic rows are rejected; the active-row index keeps
  deleted history separate from the new observation. The exact CFPB route emits
  no deletion tombstone, and no maintenance, quota-reconciliation, or retry
  path can invoke re-collection automatically.
- Workspace member emails and role mutations are owner-only. Role changes and
  removals are authorized in the same RLS transaction, guarded in PostgreSQL by
  a serialized last-owner check, and recorded as identifier-only audit/outbox
  events. Migration `0025` adds owner-scoped workspace invitations with a
  hash-only token, encrypted delivery outbox, three-day expiry, pending-email
  uniqueness, revoke/accept state transitions, bounded claim leases, and
  identifier-only audit/outbox receipts. The delivery table has no direct
  runtime grant; only narrow security-definer claim/complete/fail functions are
  executable by the worker. Acceptance is limited to an existing account whose
  normalized email matches, and the database membership trigger preserves an
  owner actor while recording the accepting user. Invitation creation and
  revocation require the same web step-up as membership changes, and both API
  and worker paths have an explicit production kill switch. Migration `0088`
  adds the global `auth_identities` table, binds OIDC identity metadata to MFA
  challenges, and exposes only service-role security-definer touch/link/unlink
  functions. Direct identity writes and the generic event function are not
  executable by `PUBLIC`, `appsea_maintenance`, or `appsea_migrator`; the
  mutation functions also reject callers other than `appsea_service`. OIDC
  linking requires an existing account's password/MFA step-up, stores only the
  normalized issuer/subject and verified email claim, and removes identities on
  account closure. OIDC sign-in resolves only a linked subject; it never
  discovers or links an account by email. The web boundary enforces
  state/nonce/PKCE, discovery/JWKS issuer matching, RS256 signature, audience,
  freshness, and verified-email checks. The provider switch is disabled by
  default; provider approval, verified-email policy, delivery/DPA, retention,
  DNS/egress, and provider-backed step-up remain separate review gates. TOTP MFA is now a global-auth boundary: migration `0080` stores
  only encrypted enrollment material, hash-only recovery codes, expiring login
  challenges, and bounded audit events; migration `0081` adds a session-bound
  recent-MFA marker for password-gated high-risk mutations; password sign-in cannot mint
  a session until the challenge is consumed. Account recovery is a global-auth boundary:
  migration `0023` creates hash-only reset rows without runtime grants, while
  migration `0024` adds
  encrypted-token outbox rows, identifier-only security events, latest-only
  active-token semantics, and narrow `SECURITY DEFINER` functions. The runtime
  role can execute those functions but cannot select reset rows, read encrypted
  delivery material, or update `users.password_hash` directly. The web route
  returns the same generic response for known and unknown addresses. A separate
  worker sends signed, idempotent provider requests with redirect blocking; the
  token is delivered only in a reset URL fragment and the production flow is
  kill-switched until identity/provider/retention review is approved. The reset
  page is dynamically rendered behind the Next.js `proxy.ts` per-response CSP
  nonce boundary so hydration scripts do not require a static unsafe-inline
  allowance. Migration `0026` adds the account-closure boundary: the web route
  supplies the authenticated user and a typed confirmation after step-up, and
  the security-definer function blocks workspace owners before revoking
  sessions/reset material, discarding pending reset deliveries, anonymizing
  profile fields, and emitting a fixed security event. Memberships and shared
  research remain by design; this is not an object-store or backup purge.
- Migration `0066` adds a separate owner-only workspace archival boundary. The
  web route requires same-origin access and recent password step-up; the
  security-definer function repeats the authenticated owner check, locks the
  workspace, counts active workflow/run/handoff/lease/reconciliation/
  recomputation work, and returns a bounded blocker instead of archiving while
  work can still mutate state. A successful archive marks campaigns archived,
  clears refresh claims, revokes pending invitations, and records only
  identifier-only audit/outbox receipts. Forced-RLS reads then exclude the
  archived workspace. Evidence lineage, reports, plans, exports, object
  references, backups, and deletion obligations remain retained; purge is a
  separate reviewed retention boundary.
- Migration `0073_workspace_purge_intents.sql` adds the next explicit handoff:
  an owner with recent step-up and exact confirmation can call a security-
  definer function only after a server-side `database_ready` inventory. The
  forced-RLS request ledger snapshots bounded counts and external requirements,
  emits identifier-only audit/outbox receipts, and remains
  `awaiting_external_controls`; it cannot authorize object, export, backup, or
  database deletion. A separate owner cancellation function is equally
  non-destructive.
- Migration `0083_workspace_purge_manifests.sql` adds a separate,
  owner-only, archived-workspace manifest boundary. The security-definer
  function validates a sorted/deduplicated list of workspace-bound object URI
  and kind pairs, derives a deterministic manifest ID from the workspace and
  SHA-256 content hash, bounds expiry to seven days (the repository uses 24
  hours), and records only identifier/hash/count/expiry metadata in
  audit/outbox receipts. Forced RLS and direct-table revocation keep the
  manifest private. It is idempotent metadata for provider coordination; it
  never authorizes or performs database, object-store, export, or backup
  deletion.
- Migration `0067_field_level_evidence_redaction.sql` adds the privacy
  projection boundary. An authenticated owner/editor calls a narrow
  security-definer function after a recent web step-up; PostgreSQL repeats the
  membership check, validates the selected fields/reason, locks the active
  evidence/source item, and records an immutable redaction receipt plus
  identifier-only audit/outbox events. A transaction-local capability permits
  only that function to replace selected display fields; ordinary runtime
  attempts to change active payloads remain denied by the immutability trigger,
  which stays fail-closed. Read repositories union persisted masks across
  collection, opportunity/leaderboard, analysis, report, and coding-plan
  projections. Source identity, capture/policy lineage,
  and content hashes remain available for provenance. A text mask is rejected
  while a raw source object reference exists; source-policy deletion and
  cloud/backup purge remain separate reviewed operations.
- Report approval transitions stay inside the private workspace boundary:
  owners/editors can review drafts, only owners can approve or withdraw, and
  migration `0022` repeats the transition check in PostgreSQL while recording
  identifier-only audit/outbox receipts. Export returns only an approved,
  schema-validated report read model and never raw source payloads.
- Production role provisioning and migrations require reviewed infrastructure and explicit approval; the local bootstrap is not a deployment recipe.
- The current local/CI web and research paths still use `appsea_service`, while
  scheduled maintenance lease calls use the separate, non-inheriting
  `appsea_maintenance` role from `APPSEA_MAINTENANCE_DATABASE_URL`. Production
  must still split authentication, research, and maintenance data-work roles
  before handling real accounts or source data.
- Production workflow activities cannot auto-create fixture workspaces; those
  workspaces must be provisioned and authorized ahead of time. Local/test runs
  retain the convenience auto-provisioning path. A database trigger also rejects
  direct workflow inserts for inactive or non-fixture workspaces.

## Maintenance scheduler boundary

- Migration `0046` stores one global lease per fixed scheduler name. Only the
  standalone `appsea_maintenance` role can call the security-definer acquire,
  renew, and owner/token-checked release functions; `appsea_service` cannot
  execute them or select/mutate lease rows directly.
- Lease expiry and takeover use PostgreSQL `clock_timestamp()`, not caller
  timestamps. Every acquisition has a unique token, and same-owner retries
  cannot overwrite an active lease. A renewal failure is a fixed failure code
  and must stop the pass before a successful completion claim.
- Migration `0052` adds `appsea.assert_maintenance_scheduler_lease`, callable
  only by `appsea_service`. It validates the private scheduler identity with
  server time and holds the advisory and lease-row locks through the enclosing
  transaction. Source quota, deletion, admission, lease purge, auth retention,
  and delivery state transitions use this fence. A stale token therefore fails
  before a selected SQL mutation can commit. The lease remains a duplicate-run
  guard for the rest of maintenance and for external delivery: source HTTP
  requests, provider sends, object-store mark/purge, and snapshot reconciliation
  are not atomic with PostgreSQL and still require bounded idempotent recovery.
  The `0047` run-metrics table is reachable only through maintenance-role
  security-definer record/list/purge functions. It stores a generated run ID,
  owner, fixed state/failure code, bounded duration, and validated numeric
  counters; it cannot store lease tokens, source text, credentials, or raw
  exception messages. Migration `0082` adds v2 lease/metrics functions for the
  three alert scans and the durable alert drain while retaining released
  migration history; the current coordinator role is trusted across the
  allowlisted scheduler names. Production may isolate scheduler credentials
  further if a compromise of one maintenance process must not starve another.
- Migration `0064` adds a separate `SECURITY DEFINER` projection for
  recomputation-alert inspection. It validates active workspace context and
  bounded limits, returns only state/attempt/timestamp observations, and is
  executable only by `appsea_maintenance`; it does not grant direct table
  reads to the service or maintenance role and cannot claim or dispatch jobs.
- Migration `0065` adds the same maintenance-only boundary for cost-alert
  aggregates. It returns currency totals only for a bounded period and row
  limit; the worker compares one explicitly configured currency without
  exchange-rate inference, ledger identifiers, or admission mutation.
- The worker's operational alert sender reuses the already redacted event
  payload, signs it with a separate HMAC secret, rejects redirects, and sends a
  stable idempotency key across bounded transient retries. It never includes
  source text, workspace identifiers, credentials, database URLs, or raw
  exception messages. Production preflight requires an HTTPS non-loopback
  endpoint; endpoint ownership, rotation, and incident response remain
  deployment controls. Migration `0082` persists the redacted payload in a
  maintenance-owned outbox before the send, limits it to an allowlisted scalar
  envelope, and exposes only security-definer enqueue/claim/complete/fail/purge
  functions. Runtime and maintenance roles cannot select the outbox directly;
  stale claims, bounded retries, terminal exhaustion, and retention purge are
  server-clock operations. The provider effect remains outside the database
  transaction and requires external idempotency/recovery.

## Temporal boundary

- The workflow bundle contains deterministic orchestration and type-only activity
  contracts; database clients, Node APIs, report generation, and source payloads
  remain in worker activities.
- Workflow inputs carry identifiers, budgets, and hashes only. Raw idempotency
  keys, complaint text, evidence, artifacts, plans, and exception messages are
  excluded from history and logs. Authenticated starts carry a bounded user
  actor (service starts use `appsea-worker`); PostgreSQL verifies workspace
  owner/editor membership and terminal audit events copy the immutable actor.
- Manual production-analysis starts carry the same immutable actor plus a
  separate digest/input admission reservation. The worker must consume that
  reservation before creating a user-attributed run; missing or expired
  reservations fail closed, while terminal/released digests replay.
- Production analysis workflow version `production-analysis-v2` carries only
  workspace, collection, analysis, seed-review, digest, and timestamp
  identifiers. The worker reconstructs the reviewed artifact inside the
  persistence activity from workspace-bound rows, so complaint excerpts and
  source payloads cannot enter Temporal history. New starts carry only the
  strict `appsea-temporal-history-memo-v1` version marker. The visibility-only
  legacy-history checker classifies tagged v2, tagged v1, and unknown metadata
  without fetching history; a reviewed manifest is required for visible legacy
  executions before the v1 worker can be removed. Archive/deletion remains a
  separately approved deployment operation.
- Production analysis retention is anchored to the server-observed activity
  timestamp, not caller-supplied `requestedAt`; the persistence repository also
  rejects materially future timestamps. This prevents a caller from extending
  object retention by submitting a date far in the future.
- Analysis finalization rechecks and locks the active, current, unexpired source
  policy, requires allowed or restricted commercial use, and verifies confirmed,
  redacted evidence plus the policy display representation before linking any
  report or plan output.
- Production source connectors receive a worker-owned lease preflight callback
  and invoke it immediately before each CFPB or Stack Exchange request. A
  denied callback fails closed, releases the durable quota reservation, and
  sends no source request. The persistence transaction still locks and
  rechecks the lease; the preflight and provider socket call are not one atomic
  transaction, so deployment must prove revocation handling and network failure
  recovery.
- Activity errors are converted to fixed retryable/non-retryable failure types;
  imported content cannot choose a retry policy, execute code, or edit guidance.
- The fixture Temporal endpoint is loopback-only and unauthenticated. The
  long-lived worker and web client share a fail-closed endpoint contract:
  production requires a non-loopback address, namespace, API key, and pinned
  CA. Namespace/task-queue authorization, retention/encryption, HA, backups,
  worker identity, and monitoring still require deployment proof before use.
- PostgreSQL terminal transitions and composite lineage constraints remain the
  commit authority. The non-cancellable persistence safe point and reconciliation
  path prevent cancellation or response loss from creating a false success or a
  duplicate run.
