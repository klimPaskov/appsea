# Active work

## State

AppSea remains a validated fixture-first product with production-shaped
PostgreSQL, Temporal, source-policy, private-workspace, report/plan, and
maintenance boundaries. The public leaderboard is intentionally synthetic and
sparse; no third-party public source is enabled. A reviewed internal
`manual-owner-import` policy now supports tenant-private owner-authorized CSV/
JSON intake without claiming public market coverage.

Migrations `0027`-`0095` cover policy evidence, checkpoints,
deletion/recomputation repair, leases, admissions, campaign orchestration and
cancellation, source reconciliation, analysis history, report/plan governance,
cost and alert projections, object references, workspace archival/purge intent/
manifest,
field-level evidence redaction, agent access tokens, and global-auth TOTP MFA.
MFA rotation, OIDC, and read-only MCP remain provider/deployment-gated;
previous-key removal still requires operator review.

The fixture workflow is the complete persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

Production-analysis v2 carries only a reviewed history memo; the history-check
command inspects visibility metadata and never archives or deletes history.

The `pnpm verify:worker:recovery` drill proves local/CI process replacement: a
separate fixture client observes a persisted checkpoint, the first worker is
stopped during persistence, and a replacement resumes the same execution with
one job/run/output/checkpoint/cost effect, distinct outbox rows, and
sanitized history. Its
pause is bounded and production-rejected; hosted restore/failover and topology
proof remain open.

Authentication uses scrypt hashes, revocable sessions, membership-before-RLS,
password step-up, TOTP/recovery codes, owner-safe closure, archival, and scoped
read-only agent tokens. The private owner Agent access page issues/revokes
least-privilege tokens; raw credentials remain one-time and later reads
metadata-only. Members have a read-only Usage page for exact cost and quota
cases; maintenance resolution stays outside the browser. OIDC remains disabled
by default and provider identity, delivery/DPA, retention, egress, and
deployment operations remain external.

Workers have server-clock leases, fenced SQL mutations, bounded retries,
reconciliation, deletion/source/object retention queues, campaign
refresh/orchestration, cancellation recovery, maintenance metrics, and signed
alert delivery. Migration `0082` adds the scalar operational-alert outbox and
durable drain. Deployment scheduler ownership, incident routing, provider
billing, cloud/backup purge, and production topology remain open.

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

Manual owner-import (migration `0089`) is the active non-fixture path: uploads
are bounded, normalized, PII-scrubbed, tenant-private, and represented in
Temporal by batch ID only. Local smoke covers owner intake, durable completion,
reviewed analysis, private report/plan readback, and the visible public-market
gap; URL fetching and public sources remain disabled. Migrations `0090`-`0095`
keep policy validation, deletion state, source privileges, quota columns, and
analysis finalization narrow; the shared web path decoder validates encoded
workspace/detail identifiers exactly once; the private members readiness read
uses only the lease columns it needs; legacy plan rows remain readable but
cannot start analysis.
Migration `0091` preserves `consumed_at` when an already-consumed owner
batch is later deleted, matching its deletion trigger.
Migration `0092` makes the service-role read privileges for campaign source
validation explicit for `sources` and its reviewed policy tables.
Migration `0093` qualifies source-quota reservation columns so PostgreSQL does
not resolve them against function OUT parameters. Migration `0094` grants the
worker its narrow finalization update for `research_runs.artifact_snapshot`.
Migration `0095` grants the authenticated runtime only `workspace_id` and
`state` on `source_collection_leases` so the private members purge-readiness
projection can count active leases without exposing lease lifecycle data.
Fresh local PostgreSQL persistence, Temporal restart, and worker replacement
checks now pass across all 95 migrations. The local private-stack smoke also
renders every private workspace page with encoded identifiers.

`pnpm verify:release` checks Compose, secret-free defaults, hardened images, and
fail-closed preflight; CI runs Docker mode and `--static` supports no Docker.
Production preflight now also requires the exact reviewed
`APPSEA_TEMPORAL_TASK_QUEUE=appsea-research-v1` declaration. This lets a
deployment review compare the worker image with a narrow provider ACL; remote
namespace/task-queue authorization is still external evidence.

## Validated commands

- GitHub Actions run `30893053945` passed for `b67a51b`; release-boundary,
  fresh PostgreSQL/Temporal, local-stack, worker, container, and Windows/macOS
  checks were green. Hosted run `30917740935` for `b99ffd7` failed before any
  job steps in every matrix job because of the GitHub account
  payment/spending-limit gate, not because of a repository assertion.
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
   namespace/task-queue ACLs and worker identity, scheduler ownership, and the
   read-only MCP boundary.
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
