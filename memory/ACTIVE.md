# Active work

## State

AppSea remains a validated fixture product with production-shaped PostgreSQL,
Temporal, source-policy, private-workspace, report/plan, and maintenance
boundaries. The public leaderboard is intentionally synthetic and sparse; no
real source is enabled.

Migrations `0027`-`0088` cover policy evidence, collection checkpoints,
deletion/recomputation repair, leases, admissions, campaign orchestration and
cancellation, source reconciliation, analysis history, report/plan governance,
cost and alert projections, object references, workspace archival/purge intent/
manifest,
field-level evidence redaction, agent access tokens, and global-auth TOTP MFA.
Migration `0081` adds a session-bound MFA step-up marker. Password-gated
high-risk mutations require recent password step-up plus a fresh MFA proof when
MFA is enabled; this covers account/session, membership/invitation, archival,
purge-intent, evidence-redaction, and agent-token issue/revoke. The MCP surface
remains read-only. Migration `0086` versions encrypted TOTP ciphertext with a
current/previous-key deployment window; successful TOTP verification and
pending-enrollment confirmation rewrap to the current key, while
`pnpm worker:auth:mfa:rotation:status` reports count-only current/previous/
unknown rows. `pnpm worker:auth:mfa:rotation:rewrap` now performs one
lease-owned, bounded dormant-account batch with fail-closed unknown-version
handling and identifier-only audit events. Previous-key removal still requires
operator review and live deployment evidence.

The fixture workflow is the complete persisted path. Production collection and
identifier-only analysis v2 are policy-gated, durable, and replay-safe, but
CFPB and Stack Exchange remain disabled or unregistered pending independent
approval. Reports and coding plans preserve provenance, visible coverage gaps,
approval state, synthetic disclosure, and object-store references.

New production-analysis v2 executions carry only the reviewed, non-sensitive
history memo. `pnpm worker:workflow:analysis:history:check` inspects Temporal
visibility metadata without fetching history and requires a reviewed manifest
for visible legacy/unknown executions; it never performs archive or deletion.

The long-lived worker has an idempotent SIGINT/SIGTERM lifecycle: it stops new
scans, requests Temporal shutdown, drains heartbeat/scan work, emits a bounded
stop event, and closes PostgreSQL/Temporal connections. Deployment drain and
crash/replacement proof remain unproven.

Authentication uses scrypt password hashes, revocable opaque sessions,
membership-before-RLS, password reauthentication, TOTP enrollment/login,
hash-only recovery codes, MFA step-up, recovery/invitation outboxes, owner-safe
account closure, archival, and scoped read-only agent tokens. Migration `0088`
adds disabled-by-default OIDC identities: explicit step-up-protected
issuer/subject link/unlink, strict state/nonce/PKCE plus RS256/verified-email
checks, linked-only sign-in, and local-MFA challenge handoff. The identity
binding survives the MFA handoff in the database, and sign-in telemetry runs
only after a session is issued. Provider approval, verified email, delivery/
DPA, account-lifetime retention/revocation, DNS/egress, provider-backed
step-up, and deployed identity operations remain external gates. MFA key
rotation is a reviewed deployment procedure rather than an automatic operation.

Workers have server-clock leases, fenced SQL mutations, bounded retries,
reconciliation, deletion/source/object retention queues, campaign
refresh/orchestration, cancellation recovery, maintenance metrics, and signed
alert delivery. Migration `0082` adds the scalar operational-alert outbox and
durable drain. Deployment scheduler ownership, incident routing, provider
billing, cloud/backup purge, and production topology remain open.

Migrations `0083`-`0087` add the forced-RLS purge manifest, PostgreSQL 18
archival/read repairs, versioned MFA ciphertext, and identifier-only rewrap
event. The manifest is a deterministic 24-hour metadata handoff, never a delete
authorization; provider object/export/backup purge remains open.

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

## Validated commands

- OIDC commit `90f0cf2` passed GitHub Actions run `30838396204`, including the
  fresh PostgreSQL migration `0088` install/upgrade proof, fresh Temporal,
  aggregate verify/security audit, container smoke, and Windows desktop jobs.
- Dependency security hardening locks patched Next.js/PostCSS/`fast-uri`/sharp
  versions and adds `pnpm security:audit`; the production audit reports zero
  vulnerabilities. GitHub Actions run `30819616149` passed audit, verification,
  fresh PostgreSQL, and fresh Temporal checks.
- Production runtime packaging now has `Dockerfile.web` (Next standalone)
  and `Dockerfile.worker` (durable worker/preflight/migration/maintenance)
  images plus `infra/production/compose.yaml`. Compose gates long-lived
  services on the one-shot preflight, keeps migrations explicit, defaults web
  binding to loopback, and uses non-root/read-only/capability-dropped
  services. GitHub Actions run `30822047661` passed both image builds and
  Compose validation for commit `bd713ee`; external provider provisioning,
  image signing/registry, and source-policy activation remain blockers. Run
  `30827192223` passed web liveness/health smoke and fail-closed worker
  preflight without production settings.
- Desktop shell has a Tauri hook, Rust lockfile, Windows icon, minimal
  capability, restrictive CSP, and Windows CI compile. Run `30824653661`
  passed for `98ef62e`; bundling remains disabled; hosted-origin, updater,
  signing, notarization, installation, and security evidence remain open.

## Next production tranche

1. Obtain independent CFPB and competitor/contrary-evidence source approvals.
2. Provision role-separated PostgreSQL and authenticated Temporal; run restore,
   graceful replacement/crash, retry/cancellation, legacy-history, and backup
   drills with a configured worker drain window.
3. Approve OIDC/verified identity, delivery/DPA, provider-backed step-up, and
   explicit contracts for high-impact mutations without a
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
  delivery/DPA, provider-backed step-up, and high-impact action contracts
  without a password boundary remain open. MFA key rotation is implemented in
  code and migration, but production still needs an approved deployment/status
  review before removing the previous key.
- Cloud/object/export/backup purge and automatic source re-collection remain
  separate reviewed operations; workspace archival, purge intent, and the
  metadata-only manifest do not delete research.
- Deployed Temporal cancellation, graceful replacement, and crash-drill
  evidence are not claimed.
- Signed Windows/macOS release evidence remains open.
