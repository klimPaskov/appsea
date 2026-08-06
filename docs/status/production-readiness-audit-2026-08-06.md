# Production-readiness audit — 2026-08-06

Status: not production-ready. This audit supersedes the 2026-08-04 audit and
records the source-policy handoff, quota-headroom, source-freshness, and
source-health alert tranches through migration `0109`.

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
  legal/privacy/security/commercial review; cloud/provider operation and
  authenticated UI capture proof are also blocked in this environment.
- **Missing from the production claim:** no model gateway, live calibration,
  broad competitor/contrary search, signed desktop release, hosted dependency
  proof, or provider-backed purge/incident operation is represented as done.

The runtime security boundary is explicit: skills move through proposal,
evaluation, approval, and activation records; runtime memory is attributable,
scoped, reviewable, and never instruction-capable; imported content cannot
write code, guidance, permissions, or memory; and autonomous source
activation, credential/auth/retention changes, production migrations/deploys,
and security-sensitive self-merges are prohibited.

| Requirement                                 | Evidence in this repository                                                                                                                                                                                                                                                                                           | Remaining gate                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations       | One hundred nine checksummed forward migrations, forced-RLS repositories, source/evidence/complaint/cluster/competitor/opportunity/score/report/plan/workflow lineage, auth/MFA/OIDC boundaries, audit history, purge intent, and maintenance-only source-health projections.                                         | Docker-backed fresh/upgrade/backup proof is unavailable on this host because the Docker Desktop Linux engine pipe is down. Provider role provisioning, encrypted backups, HA/PITR, restore/failover drills, production credentials, and approved key rotation remain deployment work. |
| Durable workflows and idempotent jobs       | Fixture, collection, analysis, campaign refresh, recomputation, maintenance, cancellation, leases, bounded retries, sanitized histories, graceful shutdown, and worker-replacement boundaries are implemented and covered by local/CI checks.                                                                         | Authenticated Temporal namespace/task-queue ACLs, deployed scheduler ownership, HA/restore drills, and legacy-history retention operation.                                                                                                                                            |
| Approved complaint sources                  | Tenant-private `manual-owner-import-v2` is the only active non-fixture path. CFPB and Stack Exchange have typed policy, quota, provenance, deletion, and fixture boundaries; immutable reviewed policy payloads now cross into connector construction, but both remain disabled.                                      | Independent legal/privacy/security/commercial-use/retention approval and activation evidence for public research. No public market coverage is claimed.                                                                                                                               |
| Complaint analysis and scoring              | Deterministic normalization, deduplication, classification/entity snapshots, narrow clustering, cluster review, competitor/contrary fields, versioned v0.2/v1 scoring, correction invalidation, recomputation, factor provenance, and synthetic quality gates are tested.                                             | Semantic near-duplicate/entity/author handling, live calibration, broad permitted competitor/contrary research, and source-backed observations.                                                                                                                                       |
| Reports and coding-agent packages           | Provenance-aware reports, visible coverage gaps, approval/export governance, object references, six-file plan manifests, private reads, and idempotent identifier-only `report.exported`/`plan.exported` Activity receipts after successful hydration are implemented.                                                | Encrypted cloud object storage, lifecycle/versioning, export/workspace purge, backup deletion verification, and deployed controls.                                                                                                                                                    |
| Authentication and private workspaces       | Password sessions, membership/RLS, step-up, TOTP/recovery-code MFA, session/account controls, invitations/recovery kill switches, archival, scoped read-only MCP, governance approvals, and disabled-by-default OIDC are implemented.                                                                                 | Provider identity/delivery/DPA/retention/revocation approval, DNS/egress enforcement, provider-backed step-up, live key rotation, and production identity operations.                                                                                                                 |
| Website and desktop boundary                | Sparse dark fixture-disclosed leaderboard, private opportunity/research/report/plan/source routes, and a bounded Tauri web boundary exist. Direct localhost HTTP checks return 200 for the public and opportunity routes; readiness correctly fails closed without PostgreSQL.                                        | The reference loop still lacks checked-in authenticated desktop/mobile captures and comparison evidence. Signed installers, updater trust, notarization, hosted-origin review, platform installation tests, and release runbook remain open.                                          |
| Observability, cost, security, and recovery | Health/readiness, server-clock leases, maintenance metrics, quota/recompute/cost/source-health alerts, signed bounded delivery, the sequential `alerts:loop` supervisor and hardened Compose service, security audit, retention/tombstone flows, backup/restore helper, and worker replacement proof are implemented. | Docker-backed recovery execution, operated scheduler/alert endpoint ownership, provider billing/recovery/incident routing, multi-instance drills, hosted deployment proof, and the GitHub CI payment gate.                                                                            |
| Guidance, memory, and provenance            | `AGENTS.md`, active plan, docs, memory, native skills, source policies, tests, and completion reports preserve synthetic disclosure, visible coverage gaps, and the untrusted-import boundary.                                                                                                                        | Continue guidance checkpoints; no completion claim is justified while external gates and capture proof remain open.                                                                                                                                                                   |

## Validation evidence

The current repository proof includes:

- `pnpm verify` passing with 56 Turbo tasks, including package lint,
  typecheck, test, build, fixture/plan/analysis generation, research-quality,
  web smoke, release-static, and repository checks.
- Affected contracts, database, and worker package tests passing after the
  source-health alert tranche (112, 181, and 127 tests respectively).
- The worker suite now includes the alert-supervisor order, continue-after-failure,
  bounded-backoff, shutdown, and environment-bound tests (131 tests passing),
  and `pnpm verify:release -- --static` passes with the required `alerts`
  Compose service.
- `pnpm security:audit`, `pnpm memory:check`, `pnpm format:check`, and
  `pnpm repo:check` passing.
- Direct local HTTP checks returning `200` for `/`, the public opportunity
  routes, and `/api/health/live`; `/api/health/ready` returns `503` when the
  local PostgreSQL dependency is absent, which is the intended fail-closed
  behavior.
- The export repository tests prove approved report/plan paths record only
  scalar audit metadata after object hydration and that an unapproved plan
  exits before the audit insert. The PostgreSQL integration lifecycle now
  asserts report and plan export receipts, actor attribution, and manifest
  metadata; Docker remains required to execute that proof here.

The root `pnpm verify` command does not replace the supplemental persistence,
backup, local-stack, or worker-replacement gates. Those commands remain
separate repository/CI evidence; the fresh persistence and backup gates were
attempted here and stopped at the unavailable Docker engine, while the direct
local-web checks above were used instead of browser inspection.

The following checks were not executed to completion because the host lacks
the Docker Desktop Linux engine pipe:

- `pnpm verify:persistence:fresh`
- `pnpm verify:backup-restore`

The SQL integration suites and backup/restore drill remain present in the
repository and must be rerun when Docker is available. Hosted GitHub runs are
also payment-gated.

## Deliberate simplifications and blockers

- No third-party source is activated. The CFPB and Stack Exchange policy
  drafts remain pending independent review; owner import is tenant-private and
  cannot establish public market coverage.
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
- UI validation in this environment is direct local HTTP and static contract
  testing only. The required authenticated screenshot/compare loop remains a
  documented release gap; no browser-debugging or user-browser inspection was
  used.
- Signed Windows/macOS installers, updater trust, notarization, hosted origin
  review, and platform installation validation remain open.

This audit is completion evidence for the repository tranches through `0109` and
the operational-alert supervisor tranche.
It is not a claim that AppSea is production-ready or that real market research
is available.
