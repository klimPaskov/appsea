# Active work

## State

Audit: `docs/status/production-readiness-audit-2026-08-09.md` (8/22); checks
pass, Docker unavailable. `pnpm verify`/local smoke through `0119`; static
guard targets `0123`; DB proof remains `0119`.
AppSea is fixture-first with production persistence, workflows,
source policy, private workspaces, reports/plans, and maintenance; the public
leaderboard is synthetic and no source enabled. Reviewed
`manual-owner-import-v3` supports tenant-private owner CSV/JSON without public
market claims. Optional author keys become workspace-scoped opaque SHA-256
fingerprints; raw identity is never staged, and reports disclose gaps.

Migrations `0027`-`0123` cover policy, deletion/leases, orchestration,
analysis/report/plan governance, cost/alerts, object refs, archival/purge,
redaction, agent/MFA/review, collectibility, and policy-impact expiry.

Fixture is the persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Stack Exchange also has a first-party
AUP/written-consent blocker. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

Authentication uses scrypt sessions, membership/RLS, MFA/governance step-up,
closure/archival, and scoped read-only agent tokens. OIDC, delivery, egress,
retention, and deployment remain external. Workers have leases, fencing,
retries, recovery, metrics, and alerts;
`alerts:loop` supervises scans/delivery. Scheduler, billing, cloud purge, and
provider ops remain open.

Imported complaints, pages, reports, and model output are untrusted data and
cannot update code, skills, instructions, permissions, or repository memory.

Manual owner-import (`0089`, `0102`–`0104`) is the active non-fixture path:
bounded, normalized, PII-scrubbed tenant-private CSV/JSON with batch ID
in Temporal. Durable quota ledgers gate connectors; the in-memory map is
test-only. Confirmed competitor observations enter only the next reviewed
analysis with hash lineage and masked restricted claims; rejection/deletion
invalidates active outputs without auto-recompute.
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

Owner-import ingress reserves admission before persistence; rejected requests
leave no staged payloads and a server-owned five-minute TTL bounds uncertain
Temporal starts.

Forward migrations `0113`–`0119` harden owner-import retention, reviewer
independence, collectibility, lineage, policy impact, pointer repair, and
current-policy reads/exports. Policy decay retains objects until source
deletion; provider scheduler ownership and external retention remain gates.

Campaign `dateRange` is enforced across admission, refresh, Temporal input,
reconstruction, snapshots, and source filtering (including owner-import
published/captured fallback). Filtered runs emit coverage warnings; private
reads show query/window beside gaps and legacy snapshots remain replayable.

Complaint analysis v0.5.0 flags instruction-like imported text with
`manipulationRisk`/`policyFlags`, preserves provenance, labels private rows and
adds a coverage gap. It retains explicitly framed
results, consequences, workarounds, user cues, bounded market-signal hints,
source ctx substitute/competitor names; reports/plans/private evidence now expose
source-context only; not source-backed claims or score inputs. See:
`docs/status/imported-content-safety-completion-report-2026-08-06.md`.

`@appsea/model-gateway` is wired into production analysis with workspace-bound
fixed prompts, an explicit `untrusted-data` segment, allowlists, redaction,
instruction refusal, bounded replay/budgets, validation, and non-sensitive
summaries. The worker records only a `model-gateway-v1` snapshot; deterministic
and human-corrected analyses remain authoritative. External providers stay
disabled pending model-use, malware, DPA/egress, durable cost, and calibration
review.

Private report/plan history is cursor-bounded and policy/deletion/redaction
gated; selected reads and exports remain approval-aware. A real-Postgres
incomplete-run case is authored, but Docker execution is pending. Migrations
`0120`/`0121` persist Markdown objects and purge lineage; `0122` adds the
reviewed owner-import author-fingerprint path and deletion/redaction clearing;
`0123` projects identity-free source-policy approval roles and permission gaps.
MCP history is metadata-only; bounded on-demand ZIP v1 is implemented with
representation-specific audit receipts. Plan ZIPs retain the six compatibility
files and add a complete 08_spec-compatible `package/` directory assembled
from hydrated/redacted models, with explicit coverage gaps. Provider purge
remains explicit follow-up work.

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
