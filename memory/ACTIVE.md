# Active work

## State

Current audit: `docs/status/production-readiness-audit-2026-08-06.md`.
`pnpm verify` passes; Docker fresh/backup proof and authenticated private UI
captures remain blocked. Public/local opportunity captures are checked in under
`artifacts/ui-reference-loop/2026-08-06/`. No production claim is justified.

AppSea remains a validated fixture-first product with production-shaped
PostgreSQL, Temporal, source-policy, private-workspace, report/plan, and
maintenance boundaries. The public leaderboard is intentionally synthetic and
sparse; no third-party public source is enabled. A reviewed internal
`manual-owner-import-v2` policy now supports tenant-private owner-authorized
CSV/JSON intake without claiming public market coverage; v1 remains historical.

Migrations `0027`-`0110` cover policy, deletion/leases, orchestration,
analysis/report/plan governance, cost/alerts, object refs, archival/purge
intent, redaction, agent tokens, and TOTP MFA. OIDC/MCP remain gated.

Fixture is the persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

Production opportunities remain `candidate` until an explicit deep-research
gate proves source-backed competitor/contrary coverage. Migration `0100` repairs
legacy non-synthetic `researched` rows; `0101` persists the append-only,
owner-reviewed gate with provenance/stale reads while fixture state stays
synthetic. Gaps remain visible after pass. Competitors exposes checklist review:
editors submit; owners promote/withdraw. API owns evidence/snapshot/membership/
step-up; UI never activates sources.
Report/plan approval is editor/owner-gated; readiness is server-owned.
Approved report/plan JSON exports now append deterministic, identifier-only
`report.exported`/`plan.exported` receipts after object hydration/redaction;
private Activity exposes the scalar receipt. Provider retention, revocation, and
purge remain external.

`pnpm verify:worker:recovery` proves worker replacement with one-time effects
and sanitized history; hosted restore/failover/topology remain open.

Authentication uses scrypt sessions, membership/RLS, MFA/governance step-up,
closure/archival, and scoped read-only agent tokens. OIDC, delivery, retention,
egress, and deployment operations remain external.

Workers have server-clock leases, fenced mutations, retries, recovery, metrics,
and signed alerts; `alerts:loop` supervises scans, delivery, and a separate
bounded outbox-status read in Compose; operated
scheduler, billing, cloud purge, and provider topology remain open.

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
Local-stack checks pass when Docker is available; hosted restore/HA/failover
remain external.

Scoring preserves `opportunity-score-v0.2.0` and adds reviewed-input balanced
`opportunity-score-v1.0.0` with risk, confidence, coverage, freshness, and
explanations. Synthetic quality benchmarks and the versioned regression gate
remain regression evidence only. Every v1 factor binds to retained evidence or
the immutable seed-review prefix; strict new writes and analysis reject legacy
pre-provenance rows.
`pnpm verify:release` checks Compose, hardened images, and fail-closed
preflight; remote namespace/task-queue authorization remains external.

The public leaderboard is regression-tested as sparse with fixture disclosure;
private opportunity tabs, decision/cluster review, step-up, idempotency, and
lineage checks remain server/database-owned. Fixtures and MCP stay read-only;
auth JSON mutations cap streaming bodies at 32 KiB and return `413` before
parsing oversized requests. Migrations `0105`/`0106` provide append-only
decision and cluster review ledgers with stale/hash/redaction-safe gates.

Source-registry tranches add bounded health/freshness, quota headroom, and
maintenance-only alert inspection; `pnpm worker:alerts:status` adds a separate
bounded outbox status read. They are private/read-only projections;
payloads, credentials, reservations, activation, settlement, and public
coverage remain outside the boundary. Owner-import freshness stays unknown.

The 2026-08-06 policy handoff carries immutable reviewed JSON from
`readCollectible` into source constructors; collection fails closed without it.
Database-owned activation fields remain mutable.

## Validated commands

Repository tests, type checks, builds, fixture/plan generation, and web smoke
pass. Docker backup/restore and hosted provisioning/deployment evidence remain
open.

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
- Competitive lineage/report enrichment is locally unit-tested, but fresh
  PostgreSQL RLS, rejection-trigger, and deletion-propagation execution still
  await Docker or hosted CI; the workflow remains manual-rerun and tenant-private.
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
