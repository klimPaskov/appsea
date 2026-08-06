# Active work

## State

Audit: `docs/status/production-readiness-audit-2026-08-06.md`.
`pnpm verify` and local PostgreSQL/Temporal/MinIO smoke pass through migration
`0119`; public/private captures pass against the disposable stack. The
leaderboard remains sparse.

AppSea remains fixture-first with production-shaped PostgreSQL, Temporal,
source-policy, private-workspace, report/plan, and maintenance boundaries. The
public leaderboard is synthetic and sparse; no third-party public source is
enabled. Reviewed `manual-owner-import-v2` supports tenant-private
owner-authorized CSV/JSON without claiming public market coverage; v1 is
historical.

Migrations `0027`-`0119` cover policy, deletion/leases, orchestration,
analysis/report/plan governance, cost/alerts, object refs, archival/purge
intent, redaction, agent tokens, MFA, complete reviews, shared collectibility,
and policy-impact expiry. OIDC and deployment operations remain gated.

Fixture is the persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Stack Exchange also has a first-party
AUP/written-consent blocker. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

Authentication uses scrypt sessions, membership/RLS, MFA/governance step-up,
closure/archival, and scoped read-only agent tokens. OIDC, delivery, retention,
egress, and deployment operations remain external.

Workers have server-clock leases, fenced mutations, retries, recovery, metrics,
and signed alerts; `alerts:loop` supervises scans, delivery, and outbox status.
Operated scheduler, billing, cloud purge, and provider topology remain open.

Imported complaints, pages, reports, and model output are untrusted data; they
cannot update code, skills, instructions, permissions, or repository memory.

Manual owner-import (migrations `0089`, `0102`, `0103`, and `0104`) is the active non-fixture
path: bounded normalized, PII-scrubbed tenant-private CSV/JSON, with only a
batch ID in Temporal. Production connectors require the durable quota ledger;
the bounded in-memory map is test-only. Local smoke covers intake; URL fetching
and public sources remain disabled. Confirmed competitive observations are
carried only into the next explicit reviewed production analysis; lineage keeps
observation/evidence hashes, restricted claim text is masked, and rejection or
source deletion invalidates active outputs without auto-recompute.
Scoring preserves `opportunity-score-v0.2.0` and adds reviewed-input balanced
`opportunity-score-v1.0.0` with risk, confidence, coverage, freshness, and
explanations. Synthetic quality benchmarks and the versioned regression gate
remain regression evidence only. Every v1 factor binds to retained evidence or
the immutable seed-review prefix; strict new writes and analysis reject legacy
pre-provenance rows.
`pnpm verify:release` checks Compose, hardened images, and fail-closed
preflight; the production gate also requires a bounded
`APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS` (30–900 seconds) and Compose maps it to
the worker stop-grace window. Remote namespace/task-queue authorization and
hosted replacement/crash evidence remain external.

Owner-import ingress reserves the workspace-scoped production admission before
persisting rows; rejected requests leave no staged payloads, and a server-owned
five-minute TTL bounds uncertain Temporal starts. Route/repository tests cover
the fail-closed ordering.

Forward migrations `0113`–`0119` harden owner-import retention, reviewer
independence, collectibility, lineage, policy-impact expiry, pointer repair,
and current-policy private reads/exports. Policy decay retains objects until a
later source deletion; provider scheduler ownership and external retention
remain release gates.

The campaign `dateRange` contract is enforced across web admission, refresh,
Temporal input, worker reconstruction, snapshots, and source-appropriate
filtering (including owner-import published/captured fallback). Filtered runs
emit coverage warnings; legacy snapshots remain replayable. Private reads show
query and window beside coverage gaps.

Complaint analysis v0.2.0 now detects bounded instruction-like imported text,
retains its evidence/provenance, sets deterministic `manipulationRisk` and
`policyFlags`, labels private rows for review, and adds an artifact coverage
gap. No content is executed or copied into repository controls; this additive
JSONB projection requires no migration. See
`docs/status/imported-content-safety-completion-report-2026-08-06.md`.

The provider-neutral `@appsea/model-gateway` boundary is now wired into the
production-analysis activity. Workspace-bound requests carry only tenant
identity plus fixed system/developer prompts and an explicit
`untrusted-data` segment, route/model/prompt allowlists, secret/PII-like
redaction, instruction refusal, bounded budgets, bounded local replay identity,
homogeneous batch checks, structured validation, and non-sensitive summaries
are covered by package tests. The worker records only a `model-gateway-v1`
snapshot; deterministic and human-corrected complaint analyses remain
authoritative. External providers remain disabled because model-use approval is
not a caller-supplied request field; malware, provider/DPA/egress, durable
idempotency/cost settlement, and calibration remain blockers.

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
7. Review the model-use policy and provider controls before any external model
   route is enabled; add malware scanning and calibration evidence first.

## Current blockers

- No third-party public source is active; fixture rankings and owner-import
  evidence are not public market research.
- GitHub CI run `31065010546` for `48ec38d` was payment-gated before startup;
  hosted reruns remain external.
- Competitive lineage/report enrichment is locally integration-tested through
  `0112`; the workflow remains manual-rerun and tenant-private.
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
- External model use is not approved: the repository has only the deterministic
  fallback gateway boundary; model provider credentials, egress, malware,
  retention/training terms, durable cost settlement, and calibration remain
  external review gates.
