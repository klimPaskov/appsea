# Active work

## State

AppSea remains a validated fixture product with production-shaped PostgreSQL,
Temporal, source-policy, private-workspace, report/plan, and maintenance
boundaries. The public leaderboard is intentionally synthetic and sparse; no
real source is enabled.

Migrations `0027`-`0085` cover policy evidence, collection checkpoints,
deletion/recomputation repair, leases, admissions, campaign orchestration and
cancellation, source reconciliation, analysis history, report/plan governance,
cost and alert projections, object references, workspace archival/purge intent/
manifest,
field-level evidence redaction, agent access tokens, and global-auth TOTP MFA.
Migration `0081` adds a session-bound MFA step-up marker. Password-gated
high-risk mutations require recent password step-up plus a fresh MFA proof when
MFA is enabled; this covers account/session, membership/invitation, archival,
purge-intent, evidence-redaction, and agent-token issue/revoke. The MCP surface
remains read-only.

The fixture workflow is the complete persisted path. Production collection and
identifier-only analysis v2 are policy-gated, durable, and replay-safe, but
CFPB and Stack Exchange remain disabled or unregistered pending independent
approval. Reports and coding plans preserve provenance, visible coverage gaps,
approval state, synthetic disclosure, and object-store references.

New production-analysis v2 executions carry only the reviewed, non-sensitive
history memo. `pnpm worker:workflow:analysis:history:check` inspects Temporal
visibility metadata without fetching history and requires a reviewed manifest
for visible legacy/unknown executions; it never performs archive or deletion.

The long-lived worker now installs an idempotent SIGINT/SIGTERM lifecycle before
opening dependencies. The first signal stops new handoff/recomputation scans,
requests Temporal worker shutdown, stops the heartbeat, awaits the scan drain,
emits the bounded stop event, and closes PostgreSQL/Temporal connections.
Repeated signals do not repeat cleanup. This is a repository boundary; a
deployed supervisor drain window and crash/replacement drill remain unproven.

Authentication uses scrypt password hashes, revocable opaque sessions,
membership-before-RLS, password reauthentication, TOTP enrollment/login,
hash-only recovery codes, MFA step-up, recovery/invitation outboxes, owner-safe
account closure, archival, and scoped read-only agent tokens. Provider identity,
verified email, delivery/DPA, key rotation, and deployed identity operations
remain external gates.

Workers have server-clock leases, fenced SQL mutations, bounded retries,
reconciliation cases, deletion propagation, source/object retention queues,
campaign refresh/orchestration, cancellation recovery, maintenance metrics, and
signed alert delivery. Migration `0082` adds a scalar-only operational-alert
outbox with deterministic enqueue, stale-claim recovery, bounded retry and
exhaustion, retention purge, and a durable `alerts:deliver` drain. Deployment
scheduler ownership, incident routing, provider billing, cloud/backup purge,
and production topology remain open.

Migrations `0083`-`0085` add an archived-owner, forced-RLS purge-manifest
boundary, repair PostgreSQL 18 archival qualification, and keep its private
read function compatible with read-only transactions.
`PostgresAuthRepository.prepareWorkspacePurgeManifest` inventories sorted,
deduplicated object URI/kind pairs from persisted source/report/plan and
production-analysis references, hashes the canonical workspace/object list,
and persists a deterministic 24-hour manifest with identifier-only
audit/outbox receipts. The private members page and
`/api/workspaces/:workspaceId/purge-manifest` require owner membership, recent
password step-up, recent MFA step-up, and the exact confirmation phrase. The
manifest contains no bodies or credentials and never authorizes deletion;
provider object/export/backup retention and a destructive workflow remain open.

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

## Validated commands

- Prior tranches passed the aggregate repository, fresh PostgreSQL, and fresh
  Temporal CI gates; local Docker Desktop remains unavailable for reruns.
- The operational-alert outbox slice passes contracts (93), database (137),
  and worker (116) tests plus affected typechecks and lints locally. Migration
  `0082` integration coverage exercises maintenance-role function access,
  idempotent enqueue, stale retry/reclaim, completion, direct-table denial, and
  v2 alert scheduler names. GitHub Actions run `30793442326` is green for
  commit `4fa2fb5`, including aggregate verification/build, fresh PostgreSQL
  persistence, and fresh Temporal workflow gates. Local Docker Desktop remains
  unavailable.
- The purge-manifest slice passes contracts (94), database (138), and web (147)
  focused suites plus affected typechecks and lints locally. Migration `0083`
  adds archived-owner integration coverage for deterministic replay, read
  authorization, and identifier-only receipts; migration `0084` repairs the
  PostgreSQL 18 archival predicate discovered by that fixture. Fresh CI then
  exposed the read-only `FOR SHARE` check; migration `0085` removes that lock
  from the private read function. GitHub Actions run `30800490289` is green
  for verify/build, fresh PostgreSQL persistence, and fresh Temporal workflow
  checks on commit `a20bb1d`. Local Docker Desktop remains unavailable.
- CI now runs full `pnpm verify` (fixture/sample/build/smoke/repository), with
  `contents: read`, stale-run cancellation, and 30-minute job bounds. GitHub
  run `30810550754` is green for `54a045e`, including fresh PostgreSQL/Temporal;
  only a non-failing Node.js 20 action-runtime deprecation was annotated.

## Next production tranche

1. Obtain independent CFPB and competitor/contrary-evidence source approvals.
2. Provision role-separated PostgreSQL and authenticated Temporal; run restore,
   graceful replacement/crash, retry/cancellation, legacy-history, and backup
   drills with a configured worker drain window.
3. Approve OIDC/verified identity, delivery/DPA, MFA key rotation, provider
   step-up, and explicit contracts for high-impact mutations without a
   password-step-up boundary.
4. Deploy encrypted object storage, lifecycle/versioning, export/workspace and
   backup purge, pricing/billing controls, alert endpoint rotation, and
   incident routing.
5. Review HTTPS, secret storage, rate limits, token rotation, Temporal
   namespace controls, scheduler ownership, and the read-only MCP boundary.
6. Complete signed Windows/macOS Tauri release validation.

## Current blockers

- No real source is active; fixture rankings are not market research.
- Production DB/Temporal, role separation, HA, backups, scheduler ownership,
  endpoint operation, provider recovery/incident routing, alerting, billing, and
  deployment validation remain. The repository outbox and drain are implemented
  but do not make the external provider transactional.
- Recovery/invitations are provider-kill-switched; OIDC, verified identity,
  delivery/DPA, key rotation, provider-backed step-up, and high-impact action
  contracts without a password boundary remain open.
- Cloud/object/export/backup purge and automatic source re-collection remain
  separate reviewed operations; workspace archival, purge intent, and the
  metadata-only manifest do not delete research.
- One-/multi-source cancellation and recomputation are durable repository
  boundaries, and the worker now has an idempotent signal-driven drain path,
  but deployed Temporal cancellation, graceful replacement, and crash-drill
  evidence are not claimed.
- Windows/macOS release remains open.
