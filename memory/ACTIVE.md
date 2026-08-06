# Active work

## State

Audit: `docs/status/production-readiness-audit-2026-08-06.md`.
`pnpm verify` passes; fresh PostgreSQL, backup/restore, worker-replacement, and
real local-stack proofs passed on 2026-08-06. Authenticated private captures
pass against the disposable local stack and are checked in.
`/leaderboard` and `/` share sparse view;
`pnpm ui:capture` audits public 1280/1024/768/480 captures under
`artifacts/ui-reference-loop/2026-08-06/`; `pnpm ui:capture:private` covers
nine private routes; audit fails on runtime error, missing main, or overflow.
Claim open.

AppSea remains fixture-first with production-shaped PostgreSQL, Temporal,
source-policy, private-workspace, report/plan, and maintenance boundaries. The
public leaderboard is synthetic and sparse; no third-party public source is
enabled. Reviewed `manual-owner-import-v2` supports tenant-private
owner-authorized CSV/JSON without claiming public market coverage; v1 is
historical.

Migrations `0027`-`0113` cover policy, deletion/leases, orchestration,
analysis/report/plan governance, cost/alerts, object refs, archival/purge
intent, redaction, agent tokens, and TOTP MFA. OIDC/MCP remain gated.

Fixture is the persisted path. Production collection and
analysis v2 are policy-gated/replay-safe; CFPB and Stack Exchange remain
disabled pending independent approval. Stack Exchange also has a first-party
AUP/written-consent blocker. Reports/plans preserve provenance,
coverage gaps, approval state, synthetic disclosure, and object references.

Production opportunities remain `candidate` until an explicit deep-research
gate proves source-backed competitor/contrary coverage. Migrations `0100`/
`0101` repair legacy states and persist the owner-reviewed gate with stale
reads; gaps remain visible. Competitors exposes checklist review, while API
owns evidence/snapshot/membership/step-up and UI never activates sources.
Report/plan approval is editor/owner-gated; readiness is server-owned and
provider retention/revocation/purge remain external.

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

The owner-import web ingress now reserves the existing workspace-scoped,
idempotent production workflow admission before persisting normalized batch
rows. Rate/concurrency-rejected requests therefore do not leave staged payloads;
fresh reservations are released when staging fails, while the server-owned
five-minute reservation TTL bounds failures before Temporal startup. Route and
repository tests cover the fail-closed ordering.

Migration `0113` closes the owner-import staging-retention gap. The leased
source-maintenance pass now uses the immutable batch policy snapshot and a
fenced security-definer function to purge expired staged/consumed normalized
payloads, write a fixed audit receipt, mark the batch deleted, and queue exact
source-item tombstones from the completed run snapshot. `manualImportBatchesPurged`
is bounded and observable; fresh integration and backup/restore proofs pass
through `0113`. Provider scheduler ownership and external retention/deletion
operations remain release gates.

The campaign `dateRange` contract is now enforced rather than descriptive:
web admission, scheduled refresh/orchestration, sanitized Temporal input,
worker activity reconstruction, and immutable collection snapshots carry the
validated inclusive bounds. CFPB applies its bounds to `date_received` intake
dates, Stack Exchange to question creation, and owner imports to published
time with captured-time fallback; fixture collection follows its publication
timestamp. Filtered results emit coverage warnings, and exact tombstone
re-collection explicitly reports that the campaign window was not applied.
Legacy snapshots remain replayable without the additive field. Tests cover
request URLs, filtering-before-limit, warnings, and workflow forwarding.
Private collection reads/page render query and window beside coverage gaps.

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
