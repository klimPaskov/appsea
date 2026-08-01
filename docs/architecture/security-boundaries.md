# Security boundaries

Imported evidence is data, never instruction.

Blocked flows:

- complaint text to shell execution
- source metadata to repository guidance
- model output to production deployment
- generated skills to active status without evaluation and approval
- connector proposals to credentials or source activation
- evidence content to unrestricted HTML rendering
- raw source payloads, caller secrets, or exception text to Temporal workflow history

Approval gates cover source activation, dependency installation, permissions, authentication, retention, migrations, deployment, and security-sensitive skill activation.

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
- Migration `0032` makes complaint curation an explicit workspace boundary:
  only active workspace editors and owners can transition an active complaint
  observation from `unreviewed` to `confirmed`/`rejected` or from `confirmed`
  to `rejected`. Review audit/outbox receipts contain identifiers and state,
  never complaint text, and deleted evidence cannot be reviewed.
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
  bounded readiness/dispatch failures, and starts Temporal idempotently; it
  never re-fetches a source record or accepts caller-supplied complaint text.
- Migration `0038` places an authenticated production collection start behind
  a security-definer admission function. The function verifies the active
  private non-fixture workspace and owner/editor membership, serializes one
  workspace's rate bucket and active-job/reservation count under an advisory
  lock, and stores only hashed idempotency/input digests. Replays do not
  consume another slot; workflow initialization consumes the reservation, and
  bounded maintenance purges terminal or expired rows. The limits are fixed in
  the reviewed migration rather than accepted from request input.
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
- Deletion propagation uses skip-locked tombstone claims with stale-lease
  recovery, preserves the first tombstone link, clears raw source references,
  redacts normalized evidence, replaces stored report/plan payloads with
  deletion markers, and marks reports/plans unavailable. Active
  source/evidence/report/plan payloads and terminal tombstone fields are
  immutable after insert/transition. External object storage, backups, and
  export deletion require separate reviewed workers; stale-claim ownership
  processing rows require a non-null lease start, but stale-claim ownership
  races still need a claim-token design.
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
  and worker paths have an explicit production kill switch. Invitations,
  MFA/OIDC, verified-email policy, and provider-backed step-up remain separate
  review gates. Account recovery is a global-auth boundary: migration `0023` creates
  hash-only reset rows without runtime grants, while migration `0024` adds
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
- Report approval transitions stay inside the private workspace boundary:
  owners/editors can review drafts, only owners can approve or withdraw, and
  migration `0022` repeats the transition check in PostgreSQL while recording
  identifier-only audit/outbox receipts. Export returns only an approved,
  schema-validated report read model and never raw source payloads.
- Production role provisioning and migrations require reviewed infrastructure and explicit approval; the local bootstrap is not a deployment recipe.
- The current local/CI runtime still shares `appsea_service` across web and
  worker paths. Production must split authentication, research, and maintenance
  roles before handling real accounts or source data.
- Production workflow activities cannot auto-create fixture workspaces; those
  workspaces must be provisioned and authorized ahead of time. Local/test runs
  retain the convenience auto-provisioning path. A database trigger also rejects
  direct workflow inserts for inactive or non-fixture workspaces.

## Temporal boundary

- The workflow bundle contains deterministic orchestration and type-only activity
  contracts; database clients, Node APIs, report generation, and source payloads
  remain in worker activities.
- Workflow inputs carry identifiers, budgets, and hashes only. Raw idempotency
  keys, complaint text, evidence, artifacts, plans, and exception messages are
  excluded from history and logs. Authenticated starts carry a bounded user
  actor (service starts use `appsea-worker`); PostgreSQL verifies workspace
  owner/editor membership and terminal audit events copy the immutable actor.
- Activity errors are converted to fixed retryable/non-retryable failure types;
  imported content cannot choose a retry policy, execute code, or edit guidance.
- The local Temporal endpoint is loopback-only and the worker refuses production
  mode. Production requires TLS/mTLS, namespace and task-queue authorization,
  retention/encryption, HA, backups, worker identity, and monitoring before use.
- PostgreSQL terminal transitions and composite lineage constraints remain the
  commit authority. The non-cancellable persistence safe point and reconciliation
  path prevent cancellation or response loss from creating a false success or a
  duplicate run.
