# Active work

## State

AppSea remains a validated fixture-first product with production-shaped
PostgreSQL, Temporal, source-policy, private-workspace, report/plan, and
maintenance boundaries. The public leaderboard is intentionally synthetic and
sparse; no third-party public source is enabled. A reviewed internal
`manual-owner-import` policy now supports tenant-private owner-authorized CSV/
JSON intake without claiming public market coverage.

Migrations `0027`-`0089` cover policy evidence, collection checkpoints,
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
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

New production-analysis v2 executions carry only the reviewed, non-sensitive
history memo. `pnpm worker:workflow:analysis:history:check` inspects Temporal
visibility metadata without fetching history and requires a reviewed manifest
for visible legacy/unknown executions; it never performs archive or deletion.

The long-lived worker has an idempotent SIGINT/SIGTERM lifecycle. The new
`pnpm verify:worker:recovery` drill proves local/CI process replacement: a
separate fixture client observes a persisted checkpoint, the first worker is
stopped during persistence, and a replacement resumes the same execution with
one job/run/output/checkpoint/cost effect, distinct outbox rows, and
sanitized history. Its
pause is bounded and production-rejected; hosted restore/failover and topology
proof remain open.

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

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

The current tranche adds `packages/connectors/src/manual-import.ts`,
`packages/db/src/manual-import-repository.ts`, migration `0089`, private
`/api/workspaces/:workspaceId/imports` routes, and the manual source policy and
runbook plus the private `/workspace/:workspaceId/imports` owner screen. Uploads
are bounded at 2 MiB/5,000 rows, normalized and PII-scrubbed;
Temporal receives only a batch identifier. Batch consumption is committed with
collection persistence, and owner deletion clears staged payloads and emits
tombstones for existing downstream deletion propagation. URL import is
intentionally deferred to avoid SSRF and unreviewed third-party acquisition.
Integration coverage now exercises owner staging/replay, service consumption,
deletion payload clearing, RLS, and tombstones; local Docker is unavailable.

## Validated commands

- GitHub Actions run `30841762532` passed for `c703747`; the hosted worker
  replacement drill verified one job/run, seven checkpoints, one cost row,
  and two distinct outbox rows after process loss.
- Dependency security hardening locks patched Next.js/PostCSS/`fast-uri`/sharp
  versions and adds `pnpm security:audit`; the production audit reports zero
  vulnerabilities. GitHub Actions run `30819616149` passed audit, verification,
  fresh PostgreSQL, and fresh Temporal checks.
- Production runtime packaging and the staged Tauri shell pass their hosted
  build/boundary checks; provider provisioning, image signing, hosted-origin,
  updater, notarization, installation, and deployment evidence remain open.

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

- No third-party public source is active; fixture rankings and owner-import
  evidence are not public market research.
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
- Deployed Temporal cancellation, restore, and hosted crash-drill evidence are
  not claimed; the repository-level process replacement proof is now present.
- Signed Windows/macOS release evidence remains open.
