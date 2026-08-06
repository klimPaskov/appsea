# Private research workspaces

The public AppSea leaderboard is a sparse, synthetic fixture surface. Private research packages live behind a workspace session and are not mixed into that public ranking.

## Access

- Signup creates a private workspace and makes the new user its owner.
- Sign-in accepts a bounded email/password input and issues an opaque session token in an `HttpOnly`, `SameSite=Lax` cookie.
- An optional OIDC provider can be enabled only through reviewed deployment
  configuration. Existing accounts may explicitly link one verified
  `(issuer, subject)` identity after password/MFA step-up; provider email
  equality never links accounts. Provider sign-in looks up only a previously
  linked identity and never creates an account or auto-links by email. The
  state/nonce/PKCE and ID-token verification boundary is documented in
  [`auth-oidc.md`](../runbooks/auth-oidc.md).
- Accounts can enroll TOTP MFA from `/account/security` after a recent password step-up. The encrypted secret is never returned after enrollment; ten recovery codes are shown once and stored only as hashes. When MFA is enabled, password sign-in creates a short-lived challenge and no session cookie is issued until a current TOTP or one-time recovery code succeeds.
- Sessions expire after 30 days and can be revoked at sign-out. Read models never include passwords, password hashes, or session tokens.
- Authenticated users can inspect active sessions at `/account/security`; each session exposes only a stable identifier and timestamps. Revoking another session requires same-origin password reauthentication, while the current session cannot be revoked from that page.
- Account closure is available from `/account/security` after the same password step-up and a typed `DELETE MY ACCOUNT` confirmation. It revokes sessions/reset material and anonymizes the profile but retains shared workspace research; closure is blocked until the user transfers every owned workspace.
- Login and signup attempts use hashed PostgreSQL buckets; the scheduled
  `auth:retention` worker command removes stale buckets and expired/revoked
  sessions in bounded batches.
- Account recovery is available as a separate, provider-neutral flow at
  `/forgot-password` and `/reset-password`. Requests reveal neither account
  existence nor token material and queue a single-use reset through the global
  auth outbox. Delivery is disabled in production until the email/identity
  policy and provider gateway are reviewed; reset links use a short-lived URL
  fragment and consuming one signs out all existing sessions.
- High-risk owner membership mutations require an explicit password step-up.
  `POST /api/auth/reauthenticate` verifies the password without storing it and
  marks the active session as recently reauthenticated for 15 minutes; stale
  mutations receive `428 Recent reauthentication required`.
- Deep-research gate reviews use the same password/MFA step-up boundary. Editors
  may submit a bounded not-ready checklist for a private production opportunity;
  only an owner may pass or withdraw it. The API stores no raw source content,
  derives current confirmed observation/source/evidence identifiers, and marks a
  passed gate stale when the bound analysis snapshot or retained evidence
  changes.
- When MFA is enabled, the same high-risk password-gated mutations—including
  account closure, session revocation, member/invitation changes, workspace
  archival, purge-intent request/cancel, evidence redaction, report/plan
  approval, opportunity-seed review, production complaint review/correction,
  competitor observation create/review, and coding-agent token issue/revoke—
  also require a fresh MFA step-up. The same-origin
  `POST /api/auth/mfa/step-up` endpoint consumes one current TOTP or recovery
  code and writes only a fifteen-minute session marker; stale mutations
  receive `428 Recent MFA verification required`. Accounts without enabled MFA
  retain the password-only compatibility path.
- Every workspace read checks membership before setting the database workspace context. A workspace ID in a URL is not an authorization grant.
- Private collection and opportunity evidence pages retain provenance and show an explicit review marker when complaint analysis detects instruction-like source text. Those observations remain visible as evidence and coverage gaps; imported content never becomes an instruction for the application or an agent.
- Workspace owners can inspect the private member roster at `/workspace/:workspaceId/members` and
  through `GET /api/workspaces/:workspaceId/members`. Member emails are exposed only to an owner.
  Owners can change a member between `owner`, `editor`, and `viewer`, or remove a member through
  same-origin `PATCH` and `DELETE` requests. The database guard serializes owner-count checks and
  refuses to demote or remove the last owner.
- Membership creation, role changes, and removals write private audit and outbox events containing
  identifiers and roles, not passwords, session tokens, or complaint content. The database trigger
  owns this receipt path so direct runtime SQL cannot silently bypass it.
- Owners can create, list, and revoke three-day invitations for existing AppSea accounts at
  `/workspace/:workspaceId/members`. Invitation acceptance is available at `/invite` and requires
  the signed-in account email to match the invitation. Owners must complete the same 15-minute
  password step-up before creating or revoking an invitation. Invitation delivery is a separate,
  provider-neutral worker/outbox boundary and remains disabled in production until email/identity,
  provider, privacy, and security review is approved; invitations never grant owner access.
- Owners can archive an active workspace from `/workspace/:workspaceId/members` after the same
  password step-up and a typed `ARCHIVE WORKSPACE` confirmation. `DELETE
/api/workspaces/:workspaceId` stops new research and refresh work, archives campaigns, revokes
  pending invitations, and records identifier-only audit/outbox receipts. The database function
  blocks the transition while workflow, run, handoff, lease, reconciliation, or recomputation work
  is active and returns a bounded count for retry. Archival retains evidence, reports, plans,
  provenance, exports, object references, and backups; destructive workspace/object/backup/export
  purge is a separate reviewed retention operation. Once the owner-only purge-readiness inventory
  reaches `database_ready`, the same step-up can record a durable
  `awaiting_external_controls` intent through `POST /api/workspaces/:workspaceId/purge-request`
  with the exact `REQUEST WORKSPACE PURGE` confirmation. The intent snapshots the readiness
  evidence and writes identifier-only audit/outbox receipts; it does not delete data or authorize
  provider-side deletion. Owners can inspect it with `GET` and cancel it with `DELETE` plus
  `CANCEL WORKSPACE PURGE`. Repeating an active request is idempotent. Cloud object-store,
  export-retention, backup verification, and a separately reviewed destructive workflow remain
  external requirements.
- Owners and editors can expand `Privacy redaction` on a collection evidence row after the same
  password step-up. They select one or more narrative/entity/locator fields and a reason; the
  strict API binds the evidence to the run and complaint and records an immutable receipt. Private
  collection, opportunity/leaderboard, analysis, report, and coding-plan reads show stable masks while source IDs, capture/policy
  provenance, and content hashes remain available for traceability. A narrative mask cannot be
  applied while a raw source object reference remains. Source deletion, object-store/export purge,
  backups, and downstream re-analysis are separate reviewed operations.
- Workspace owners can stage an authorized CSV/JSON export at
  `/api/workspaces/:workspaceId/imports` after selecting a private production
  campaign that includes `manual-owner-import`. The endpoint bounds the upload,
  ignores unknown fields, scrubs common PII/secret patterns, discards raw bytes,
  and starts a durable identifier-only collection workflow. Batch metadata is
  private; owner deletion clears staged rows and creates deletion tombstones.
  Owner imports are not public market coverage, and AppSea never fetches their
  URL fields.
- Workspace owners can manage scoped, expiring read-only coding-agent tokens at
  `/workspace/:workspaceId/agent-access`. The page is a convenience over the
  existing token API: it lets an owner select least-privilege MCP scopes, shows
  a new raw token only once, and lists only token metadata afterwards. Creation
  and revocation retain the same same-origin, password-step-up, MFA,
  workspace-owner, hash-only persistence, and expiry controls as the API. The
  endpoint remains read-only and cannot activate sources, start workflows,
  mutate research, or change policy.
- Private workspace members can inspect exact recorded cost totals and settled
  source-quota reconciliation cases at `/workspace/:workspaceId/usage`. The
  page keeps currencies separate, shows estimated versus actual ledger totals,
  and never resolves, refunds, or re-fetches a quota case; maintenance-role
  operations remain outside the browser boundary.

## Research detail

Private opportunity routes expose overview, evidence/coverage, competitors/contrary-signals, report, and coding-plan pages. Evidence is filtered to source representations allowed for display, deletion-state active rows only, and explicit synthetic/redaction labels. The competitors page carries a validated competitive-research coverage record: fixture data is synthetic, production seed assumptions are reviewed-seed-only, and source-backed status requires a confirmed non-synthetic observation with permitted source and retained evidence identifiers. Fixture persistence now generates a versioned deterministic report that keeps observations, score inference, contrary evidence, recommendation, and source coverage separate; the report is linked to its coding plan. Source coverage gaps remain visible; missing access is not presented as absence of demand.

The competitors page also shows the deep-research gate status, compact snapshot
lineage, blockers, and visible coverage gaps. A passed gate is a reviewed
readiness decision, not a claim that every source or competitor was covered;
fixture and unapproved-source records cannot pass it.

Research campaigns are the private configuration boundary at
`/workspace/:workspaceId/campaigns` and the corresponding workspace API. All
members can list/read campaigns; owners and editors can create a validated
`campaign-v1` draft with a bounded source allowlist, evidence limit, refresh
policy, display mode, and USD budget. The read model resolves each source to
its lifecycle/policy state, permitted purpose, synthetic flag, review/expiry
timestamps, and coverage notes. A pending or unavailable policy is shown as a
gap. Draft creation writes identifier-only audit/outbox receipts but never
starts a workflow or activates a connector; collection admission rechecks
policy, quota, deletion, and budget constraints. The private read model also
shows the next due time, durable claim/dispatch state, and bounded failure
summary for non-manual refresh policies. Existing fixture/workflow campaign
JSON remains readable through a legacy compatibility shape.

The workspace home links to a read-only source registry at
`/workspace/:workspaceId/sources` with the corresponding private API. Members
can inspect current policy readiness, quotas, retention/deletion duties, and
coverage notes without seeing policy payloads, reviewer identities, hashes, or
activation controls. A production source is marked collectible only when its
current active policy is approved, unexpired, and backed by an independent
review; fixture sources remain explicitly synthetic.
Owners and editors can start a one-source production collection from the same
page or `POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`. The
server derives all collection inputs from the stored campaign, checks approved
purpose/display mode and any approved seed review, and admits the digest before
contacting Temporal. Pending policy remains a visible gap; multi-source runs
remain separate reviewed work. Automatic refresh is dispatched only by the
lease-backed source-maintenance worker after the current source policy is
approved and collectible. Deployment-level Temporal, scheduler ownership, and
CFPB approval remain open.

Private members can inspect cursor-paginated production runs for a campaign at
`GET /api/workspaces/:workspaceId/campaigns/:campaignId/runs` or through the
campaign page. The endpoint accepts a bounded `limit` and opaque cursor and
returns `data` plus `nextCursor`; the dedicated private history page advances
older one-source and multi-source pages independently. The workflow-status
page shows only safe state, checkpoint, source/policy identifiers, counters,
and timestamps; completed runs link to the existing source evidence and
coverage page. Idempotency hashes, raw source payloads, and caller secrets
never appear in this history.

The completed collection evidence page also shows the persisted query and
inclusive source-date window (or an explicit unbounded scope) beside its
coverage gaps and collection warnings. This keeps a filtered run's scope
visible without treating records outside the window as evidence of absence.

After a completed private collection, an owner or editor can choose an approved
seed review on the collection page and start the downstream analysis explicitly.
The start request contains only the collection/analysis identifiers, approved
seed identifier, timestamp, and idempotency envelope; the server reconstructs
the analysis input from workspace-bound rows. The private analysis-status page
at `/workspace/:workspaceId/research/analysis/:analysisRunId` reads a safe
projection from Temporal when available and PostgreSQL when the workflow is
temporarily unavailable. It exposes state, checkpoint, bounded attempt count,
availability, identifiers, failure summary, and timestamps only. Workflow
identifiers are accepted only when their workspace prefix matches the session,
and hashes, object references, source payloads, and seed content never appear
in the page or status API.

Workspace members can inspect bounded cross-run operational cost accounting at
`GET /api/workspaces/:workspaceId/costs`. The read model keeps currencies and
cost types separate, reports exact micro-unit strings, defaults to a 30-day
window, and accepts at most a 365-day period. It is private operational data,
not billing or payment functionality.

Workspace members can also inspect settled source requests that lack a
completed production result at
`GET /api/workspaces/:workspaceId/research/quota-reconciliation`. The read is
bounded and no-store. Resolution is deliberately outside the member API: the
standalone `appsea_maintenance` role must verify an exact completed run or
record an explicit no-result decision, and neither action refunds quota or
authorizes a source re-fetch.

Reviewed non-fixture analysis outputs use the same private routes after a
completed collection: artifact, report, and plan payloads are read from
workspace-bound object references. Reports and plans each have separate
editor/owner approval transitions, and only approved object-backed payloads can
be exported through the private JSON routes.

Collections started with an approved seed expose a bounded `analysisHandoff`
status on the private collection read model/API. It contains state, retry
metadata, timestamps, and safe failure summaries only; collections without an
automatic seed return `analysisHandoff: null` and use the explicit reviewed
analysis-start route.

The fixture workflow gateway is available at `POST /api/workspaces/:workspaceId/research/fixture`
and `GET /api/workspaces/:workspaceId/research/fixture/:workflowId`. Starts require an
owner/editor membership, a fixture-only workspace, a strict path/body workspace match,
and the same-origin check. The web boundary overwrites any caller-supplied actor with
the authenticated user; service/fixture starts are explicitly recorded as
`appsea-worker` in the durable job and terminal audit event. Signup-created workspaces
are currently non-fixture, so they cannot start synthetic research until an explicitly
fixture-enabled workspace is provisioned.

Owner-safe account closure is implemented as a profile/authentication operation; workspace-data,
object-store, backup, and export deletion remain separate retention work. Production
identity-provider policy remains open. Recovery and invitation mechanics are implemented behind reviewed provider/identity kill switches; external
OIDC provider approval, verified-email policy, provider-backed step-up
integration, key rotation, and explicit contracts for unrelated high-impact
mutations without a password-step-up boundary remain open. The
current password step-up is an application boundary, not a substitute for a production identity
provider. The current invitation simplification intentionally excludes new-account creation and
email verification until that identity policy is approved.
