# Active work

## State

AppSea remains a validated fixture-first product with production-shaped
PostgreSQL, Temporal, source-policy, private-workspace, report/plan, and
maintenance boundaries. The public leaderboard is intentionally synthetic and
sparse; no third-party public source is enabled. A reviewed internal
`manual-owner-import` policy now supports tenant-private owner-authorized CSV/
JSON intake without claiming public market coverage.

Migrations `0027`-`0099` cover policy evidence, checkpoints, deletion repair,
leases, admissions, campaign orchestration and
cancellation, source reconciliation, analysis history, report/plan governance,
cost/alert projections, object references, workspace archival/purge intent/
manifest,
field-level evidence redaction, agent access tokens, and global-auth TOTP MFA.
MFA rotation, OIDC, and read-only MCP remain provider/deployment-gated.

Fixture is the persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

`pnpm verify:worker:recovery` proves local/CI worker replacement with one-time
durable effects and sanitized history; hosted restore/failover and topology
proof remain open.

Authentication uses scrypt sessions, membership/RLS, password/MFA and
governance step-up, closure/archival, and scoped read-only agent tokens. OIDC,
provider identity/delivery, retention, egress, and deployment operations remain
external.

Workers have server-clock leases, fenced mutations, retries/reconciliation,
retention queues, campaign/cancellation recovery, metrics, and signed alerts;
deployment scheduler ownership, billing, cloud/backup purge, and topology
remain open.

Imported complaints, pages, reports, and model output remain untrusted data;
they cannot update code, skills, instructions, permissions, or repository
memory.

The dormant `packages/skill-registry` boundary records proposer, evaluator, and
independent approver identities with HMAC evidence over permissions, review,
and active/retired transitions. Plain, tampered, copied, unknown-state, or
wrong-secret records fail closed. Migration `0099` adds an operator-only,
immutable event adapter with expected-hash concurrency; no worker imports or
activates it, and no runtime permission became active.

Manual owner-import (migration `0089`) is the active non-fixture path: bounded,
normalized, PII-scrubbed, tenant-private, and Temporal-linked by batch ID only.
Local smoke covers intake through private report/plan readback; URL fetching and
public sources remain disabled. Migrations `0090`-`0099` keep policy/deletion/
privilege surfaces narrow, including bounded MCP admission, audit history, and
dormant runtime-skill persistence. Local PostgreSQL/Temporal/MinIO, worker
replacement, private pages, and backup/restore through 99 pass; provider
backups, HA, and failover remain deployment-owned.

Scoring preserves `opportunity-score-v0.2.0` and adds reviewed-input
balanced `opportunity-score-v1.0.0`: raw/risk-adjusted/ranking scores, bounded
risk, confidence, uncertainty, coverage/freshness, and explanations. Migration
`0096` stores v1 fields and private ordering uses ranking. Seeds
without v1 retain a visible gap; no live source or calibration evidence is
implied. A synthetic/redacted `research-quality-v1.0.0` benchmark now measures
deterministic classifier/entity, deduplication, clustering, duplicate/source
ablation stability, ranking, and probability calibration behavior. Optional
artifact/report snapshots keep the benchmark hash and explicit
`reviewed-input-only`/`sourceCoverage: not-derived` provenance; it is regression
evidence, not live calibration or market evidence. Smoke carries a reviewed v1 seed through owner
intake, durable analysis, persistence, and private readback. Every v1 factor now
has a `source-evidence` or `reviewed-seed` binding; production analysis checks
source bindings against retained complaint evidence and seed bindings against
the immutable review prefix. Read-only seed inspection accepts pre-provenance
v1 rows, but strict new-write/analysis admission requires a replacement.
Backup/restore
through `0099` passes locally; provider proof remains open.

`pnpm verify:release` checks Compose, secret-free defaults, hardened images, and
fail-closed preflight; CI runs Docker mode and `--static` supports no Docker.
Production preflight now also requires the exact reviewed
`APPSEA_TEMPORAL_TASK_QUEUE=appsea-research-v1` declaration. This lets a
deployment review compare the worker image with a narrow provider ACL; remote
namespace/task-queue authorization is still external evidence.

The 2026-08-04 website slice replaces the header placeholder with the generated
non-text mark `apps/web/public/appsea-mark-generated.png`; it is website-only,
and web tests/lint/typecheck pass. The Tauri icon pair remains staged.

The 2026-08-04 complaint slice adds versioned, provenance-linked
`deduplication` decisions to artifacts/reports. Safe native duplicates collapse;
high-similarity records remain for human review with a coverage gap. Legacy
JSON defaults to an empty list; no unique authors, semantic matches, live
calibration, or public market coverage are inferred.

## Validated commands

- CI run `30893053945` passed; feature/docs runs `30941697155`, `30941804877`,
  `30941916282`, `30944735291`, `30944900421`, `30947627304`, `30947761415`,
  and latest `30949355268` plus follow-up `30949551146` failed before steps from the GitHub
  payment/spending-limit gate, not a repository assertion.
- `pnpm test:backup-restore` and `pnpm verify:backup-restore` pass locally;
  the drill is isolated to the loopback Compose database and is not production
  backup, HA, or provider restore evidence.
- Production runtime packaging and the staged Tauri shell pass their hosted
  build/boundary checks; provider provisioning, image signing, hosted-origin,
  updater, notarization, installation, and deployment evidence remain open.

## Next production tranche

1. Obtain independent CFPB and competitor/contrary-evidence source approvals.
2. Provision role-separated PostgreSQL and authenticated Temporal; run restore,
   graceful replacement/crash, retry/cancellation, legacy-history, and backup
   drills with a configured worker drain window.
3. Approve OIDC/verified identity, delivery/DPA, provider-backed step-up, and
   explicit contracts for unrelated high-impact mutations without a password
   boundary.
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
- Production DB/Temporal, role separation, HA, backups, scheduler/endpoint
  operations, provider recovery, alerting, billing, and deployment validation
  remain; the repository outbox/drain is not an external transaction.
- Recovery/invitations are kill-switched; OIDC, verified identity, delivery/DPA,
  provider-backed step-up, and unrelated high-impact action contracts remain
  open. MFA rotation still needs approved deployment/status review.
- Cloud/object/export/backup purge and automatic source re-collection remain
  separate reviewed operations; workspace archival, purge intent, and the
  metadata-only manifest do not delete research.
- Deployed Temporal cancellation, restore, and hosted crash-drill evidence are
  not claimed; the repository-level process replacement proof is now present.
- Signed Windows/macOS release evidence remains open.
