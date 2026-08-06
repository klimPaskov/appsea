# Production-readiness audit — 2026-08-06

Status: not production-ready. This audit supersedes the 2026-08-04 audit and
records the source-policy handoffs, deterministic CFPB and Stack Exchange
review manifests,
quota-headroom, source-freshness, source-health alert, and
operational-alert-status and source-policy permission-evidence tranches through
migrations `0111` and `0112`.

## Surface status

Classification used in this audit:

- **Complete in the repository:** contracts, the fixture worker → analysis →
  score → report/plan pipeline, private API governance, deterministic
  provenance/scoring, sparse web routes, source-policy registry, owner-import
  v2 boundary, runtime skill/memory gates, Tauri boundary compilation, and
  guidance/memory alignment have executable package or CI proof.
- **Partial:** PostgreSQL, durable workflows, analysis/scoring, reports,
  authentication, website/desktop boundary, and observability are implemented
  as production-shaped seams but still need deployment or external controls.
- **Blocked:** public complaint-source activation is blocked by independent
  legal/privacy/security/commercial review; cloud/provider operation and signed
  desktop release evidence remain external gates. Local dependency-backed
  persistence, recovery, and authenticated private-workspace HTTP smoke now
  pass on this host.
- **Missing from the production claim:** no model gateway, live calibration,
  broad competitor/contrary search, signed desktop release, hosted dependency
  proof, or provider-backed purge/incident operation is represented as done.

The runtime security boundary is explicit: skills move through proposal,
evaluation, approval, and activation records; runtime memory is attributable,
scoped, reviewable, and never instruction-capable; imported content cannot
write code, guidance, permissions, or memory; and autonomous source
activation, credential/auth/retention changes, production migrations/deploys,
and security-sensitive self-merges are prohibited.

| Requirement                                 | Evidence in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Remaining gate                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations       | One hundred twelve checksummed forward migrations, forced-RLS repositories, source/evidence/complaint/cluster/competitor/opportunity/score/report/plan/workflow lineage, auth/MFA/OIDC boundaries, audit history, purge intent, maintenance-only source-health projections, scalar operational-alert status, and actor-bound release of still-reserved owner-import admissions after staging failure. Local fresh-install, populated-upgrade, role/RLS, and backup/restore proofs pass on 2026-08-06.                                                                                                                                                                                | Provider role provisioning, encrypted backups, HA/PITR, restore/failover drills, production credentials, and approved key rotation remain deployment work.                                                                                                                                         |
| Durable workflows and idempotent jobs       | Fixture, collection, analysis, campaign refresh, recomputation, maintenance, cancellation, leases, bounded retries, sanitized histories, graceful shutdown, and worker-replacement boundaries are implemented and covered by local/CI checks.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Authenticated Temporal namespace/task-queue ACLs, deployed scheduler ownership, HA/restore drills, and legacy-history retention operation.                                                                                                                                                         |
| Approved complaint sources                  | Tenant-private `manual-owner-import-v2` is the only active non-fixture path. CFPB and Stack Exchange have typed policy, quota, provenance, deletion, and fixture boundaries; immutable reviewed policy payloads now cross into connector construction, and deterministic review manifests package first-party evidence without activation. Both third-party sources remain disabled. Stack Exchange's draft records the current first-party AUP blocker, unknown commercial permission, and a policy-declared permission-evidence requirement enforced by migration `0111`.                                                                                                          | Independent legal/privacy/security/commercial-use/retention approval and activation evidence for public research, plus express written consent or a commercial exception for Stack Exchange's intended automated use recorded in the immutable approval row. No public market coverage is claimed. |
| Complaint analysis and scoring              | Deterministic normalization, deduplication, classification/entity snapshots, narrow clustering, cluster review, competitor/contrary fields, versioned v0.2/v1 scoring, correction invalidation, recomputation, factor provenance, and synthetic quality gates are tested.                                                                                                                                                                                                                                                                                                                                                                                                            | Semantic near-duplicate/entity/author handling, live calibration, broad permitted competitor/contrary research, and source-backed observations.                                                                                                                                                    |
| Reports and coding-agent packages           | Provenance-aware reports, visible coverage gaps, approval/export governance, object references, six-file plan manifests, private reads, and idempotent identifier-only `report.exported`/`plan.exported` Activity receipts after successful hydration are implemented.                                                                                                                                                                                                                                                                                                                                                                                                               | Encrypted cloud object storage, lifecycle/versioning, export/workspace purge, backup deletion verification, and deployed controls.                                                                                                                                                                 |
| Authentication and private workspaces       | Password sessions, membership/RLS, step-up, TOTP/recovery-code MFA, session/account controls, invitations/recovery kill switches, archival, scoped read-only MCP, governance approvals, and disabled-by-default OIDC are implemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Provider identity/delivery/DPA/retention/revocation approval, DNS/egress enforcement, provider-backed step-up, live key rotation, and production identity operations.                                                                                                                              |
| Website and desktop boundary                | Sparse dark fixture-disclosed leaderboard, canonical `/leaderboard` plus root alias, private opportunity/research/report/plan/source routes, and a bounded Tauri web boundary exist. Local HTTP checks return 200 for the public and opportunity routes; the local headless capture command covers 1280/1024/768/480, checked-in public plus authenticated private captures include the mobile header overflow and password step-up fixes, and both public/private captures now fail on scalar runtime-error, missing-title/main, or horizontal-overflow findings; `pnpm verify:local-stack` exercises authenticated private pages and report/plan readback on the real local stack. | Signed installers, updater trust, notarization, hosted-origin review, platform installation tests, and release runbook remain open.                                                                                                                                                                |
| Observability, cost, security, and recovery | Health/readiness, server-clock leases, maintenance metrics, quota/recompute/cost/source-health alerts, signed bounded delivery, the sequential six-child `alerts:loop` supervisor, scalar-only outbox status inspection, hardened Compose service, security audit, retention/tombstone flows, backup/restore helper, and worker replacement proof are implemented. Local `pnpm verify:worker:recovery` and `pnpm verify:local-stack` pass with real PostgreSQL/Temporal/MinIO.                                                                                                                                                                                                       | Operated scheduler/alert endpoint ownership, provider billing/recovery/incident routing, multi-instance drills, hosted deployment proof, and the GitHub CI payment gate.                                                                                                                           |
| Guidance, memory, and provenance            | `AGENTS.md`, active plan, docs, memory, native skills, source policies, tests, and completion reports preserve synthetic disclosure, visible coverage gaps, and the untrusted-import boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Continue guidance checkpoints; no completion claim is justified while external gates and capture proof remain open.                                                                                                                                                                                |

## Validation evidence

The current repository proof includes:

- `pnpm verify` passing with 56 Turbo tasks, including package lint,
  typecheck, test, build, fixture/plan/analysis generation, research-quality,
  web smoke, release-static, and repository checks.
- Affected contracts, database, and worker package tests passing after the
  source-health, outbox-status, and source-policy-manifest tranches (112, 181,
  and 141 worker tests respectively; the focused contract and database suites
  also pass).
- The worker suite now includes the alert-supervisor order, continue-after-failure,
  bounded-backoff, shutdown, environment-bound, outbox-status, CFPB, and Stack
  Exchange policy-manifest tests (141 tests passing),
  and `pnpm verify:release -- --static` passes with the required `alerts`
  Compose service.
- `pnpm security:audit`, `pnpm memory:check`, `pnpm format:check`, and
  `pnpm repo:check` passing.
- `pnpm verify:persistence` and `pnpm verify:persistence:fresh` passing: the
  PostgreSQL lifecycle now passes all 55 integration tests after the source
  health projection and fixture deduplication repair.
- `pnpm verify:backup-restore` passing: all 112 migrations restore into a
  disposable database and forced-RLS/runtime privilege checks pass.
- `pnpm verify:worker:recovery` passing: a real worker replacement completes
  the fixture effect once and preserves sanitized Temporal history.
- `pnpm verify:local-stack` passing: loopback PostgreSQL, Temporal, and MinIO
  readiness, authenticated owner import, durable collection, production-shaped
  analysis, private report/plan pages, and cleanup all pass.
- Direct local HTTP checks returning `200` for `/`, the public opportunity
  routes, and `/api/health/live`; `/api/health/ready` returns `503` when the
  local PostgreSQL dependency is absent, which is the intended fail-closed
  behavior.
- `pnpm ui:capture` passing against the local built web server, producing the
  public leaderboard and opportunity-route captures at 1280, 1024, 768, and
  480 pixels. The 480 capture was inspected after fixing the clipped sign-in
  action; desktop captures retain the desktop layout. Public review captures
  are checked in under `artifacts/ui-reference-loop/2026-08-06/`.
- `pnpm ui:capture:private` passing against the disposable local stack,
  producing nine authenticated workspace/account routes at the same four
  viewport sizes. The capture found and fixed the read-only PostgreSQL lock
  mismatch in the account-security route and the mobile password step-up grid;
  private review PNGs and a secret-free placeholder manifest are checked in
  under `artifacts/ui-reference-loop/2026-08-06/`.
- The export repository tests prove approved report/plan paths record only
  scalar audit metadata after object hydration and that an unapproved plan
  exits before the audit insert. The PostgreSQL integration lifecycle now
  asserts report and plan export receipts, actor attribution, and manifest
  metadata; the local fresh run executed that proof successfully.

The root `pnpm verify` command does not replace the supplemental persistence,
backup, local-stack, or worker-replacement gates. Those commands remain
separate repository/CI evidence; all four supplemental gates passed locally on
2026-08-06 after Docker Desktop was started. Hosted GitHub runs remain
payment-gated and still provide no current hosted deployment evidence.

The latest private `main` push run (`31065010546`, commit `48ec38d`) confirms
the hosted gate: every job was rejected before startup with GitHub's
payments/spending-limit annotation, so it provides no PostgreSQL, Temporal,
container, or desktop execution evidence.

## Deliberate simplifications and blockers

- No third-party source is activated. The CFPB and Stack Exchange policy
  drafts remain pending independent review; their manifests are review
  handoffs, not legal approvals. Stack Exchange additionally requires a
  first-party written-consent/commercial-exception record because of its
  current AUP; owner import is tenant-private and cannot establish public
  market coverage.
- Complaint classification, entity resolution, deduplication, and ranking are
  deterministic reviewed code; no model gateway, semantic author estimation,
  or live calibration is claimed.
- The deep-research gate is a fail-closed evidence checklist, not a broad
  search engine. Source-backed competitor/contrary breadth remains open.
- Local object-store adapters and local Temporal prove repository contracts,
  and the Compose topology now includes the alert supervisor, but these checks
  do not prove cloud encryption, HA, provider backup/restore, or operated
  deployment ownership.
- Report/object/export/backup purge is a metadata-only, non-destructive handoff
  in this repository; cloud deletion and retention verification are not done.
- The research-quality benchmark is synthetic regression evidence only; it is
  not live calibration, market evidence, or a public-demand estimate.
- UI validation in this environment uses direct local HTTP, static contract
  tests, local headless public and authenticated captures, and the real-stack
  authenticated HTTP smoke. The private capture records only scalar layout
  audit results; no user-browser inspection or browser debugging was used.
- Signed Windows/macOS installers, updater trust, notarization, hosted origin
  review, and platform installation validation remain open.

This audit is completion evidence for the repository tranches through `0112`,
including the operational-alert supervisor, status-inspection, CFPB and Stack
Exchange policy-manifest handoffs, local public and authenticated UI reference-loop
tranche, the repaired manual-import connector policy handoff, and fresh local
persistence/stack proof.
It is not a claim that AppSea is production-ready or that real market research
is available.
