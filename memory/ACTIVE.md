# Active work

## State

AppSea remains a validated fixture product with production-shaped PostgreSQL,
Temporal, source-policy, private-workspace, report/plan, and maintenance
boundaries. The public leaderboard is intentionally synthetic and sparse; no
real source is enabled.

Migrations `0027`-`0081` cover policy evidence, collection checkpoints,
deletion/recomputation repair, leases, admissions, campaign orchestration and
cancellation, source reconciliation, analysis history, report/plan governance,
cost and alert projections, object references, workspace archival/purge intent,
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

Authentication uses scrypt password hashes, revocable opaque sessions,
membership-before-RLS, password reauthentication, TOTP enrollment/login,
hash-only recovery codes, MFA step-up, recovery/invitation outboxes, owner-safe
account closure, archival, and scoped read-only agent tokens. Provider identity,
verified email, delivery/DPA, key rotation, and deployed identity operations
remain external gates.

Workers have server-clock leases, fenced SQL mutations, bounded retries,
reconciliation cases, deletion propagation, source/object retention queues,
campaign refresh/orchestration, cancellation recovery, maintenance metrics, and
signed alert delivery. Deployment scheduler ownership, incident routing,
provider billing, cloud/backup purge, and production topology remain open.

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

## Validated commands

- `pnpm verify` passed 2026-08-03 for the MFA step-up tranche; it covered
  package lint/typecheck/test/build, fixture worker, sample plan, smoke web,
  and repository checks. GitHub Actions run `30786965857` for commit
  `b9cb95e` also passed aggregate verification, fresh PostgreSQL persistence,
  and fresh Temporal workflow gates.
- The prior MFA step-up tranche passed contracts (89), db (135), and web (144)
  focused suites plus affected typechecks and lints. The current
  conditional-MFA route slice passes the web suite (144), web typecheck, and
  web lint locally; GitHub Actions run `30786965857` passed the aggregate,
  fresh PostgreSQL, and fresh Temporal gates for commit `b9cb95e`.
- PostgreSQL and Temporal fresh integration is staged but local Docker is
  blocked by the unavailable Docker Desktop Linux engine pipe. Remote CI is the
  authoritative fresh-install/upgrade and workflow proof; that remote gate is
  green for commit `b9cb95e`.
- The history-safety slice passes contracts (92), workflows (30), and worker
  (110) tests plus affected typechecks/lint locally. The external Temporal
  checker, archive/retention operation, and deployment proof remain pending.
  GitHub Actions run `30788668850` is green for commit `bf1756e` across
  aggregate verification, fresh PostgreSQL persistence, and fresh Temporal
  workflow gates.

## Next production tranche

1. Obtain independent CFPB and competitor/contrary-evidence source approvals.
2. Provision role-separated PostgreSQL and authenticated Temporal; run restore,
   crash/retry/cancellation, legacy-history, and backup drills.
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
  endpoint operation, alerting, billing, and deployment validation remain.
- Recovery/invitations are provider-kill-switched; OIDC, verified identity,
  delivery/DPA, key rotation, provider-backed step-up, and high-impact action
  contracts without a password boundary remain open.
- Cloud/object/export/backup purge and automatic source re-collection remain
  separate reviewed operations; workspace archival and purge intent do not
  delete research.
- One-/multi-source cancellation and recomputation are durable repository
  boundaries, but deployed Temporal cancellation and crash-drill evidence are
  not claimed.
- Windows/macOS release remains open.
