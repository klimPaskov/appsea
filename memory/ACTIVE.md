# Active work

## State

The fixture product, PostgreSQL persistence, durable workflow, connector,
authenticated private workspace, report/plan approval/export, recovery, and
workspace invitations are implemented. Migration
`0027_source_policy_approval_boundary.sql` now records operator-only source
policy draft/approval evidence. The first non-fixture collection checkpoint
persists approved CFPB items, redacted evidence, unreviewed complaints,
tombstones, coverage gaps, and audit/outbox lineage with idempotent replay.
Migrations `0028_production_collection_workflow_projection.sql`,
`0029_source_retention_enforcement.sql`, `0034_production_analysis_handoffs.sql`,
`0035_opportunity_availability_repair.sql`,
`0036_same_run_analysis_recovery.sql`, and
`0037_production_analysis_recompute_jobs.sql`
and `0038_production_workflow_ingress_admission.sql` now add the production collection
job/checkpoint projection, policy trigger, bounded policy-derived retention
tombstone enqueue, hashed idempotency, terminal reconciliation, and user/service
actor attribution, and deletion-triggered recomputation dispatch state;
the workflow/client/activity boundary is package-tested but not deployed.
Migration `0038_production_workflow_ingress_admission.sql` adds a fixed,
database-serialized per-workspace production start rate/concurrency gate before
Temporal, consumes short-lived reservations during workflow initialization, and
purges terminal or expired admissions through source maintenance. Next is
infrastructure hardening: Temporal provisioning, role separation, automatic
re-collection, non-fixture outputs, and identity-provider approval. Fixture and
production collection routes are Temporal gateways; signup workspaces remain
non-fixture by design.

The 2026-07-26 analysis checkpoint composes validated non-fixture collection
data into deterministic clusters, score, report, and coding package; it is
test-only. Migration `0030` and `PostgresProductionAnalysisRepository` persist
lineage, projections, and content-addressed references with replay and
deletion invalidation. Cloud storage, purge, and deployment proof remain open.

Foundation (2026-07-11 through 2026-07-25): PostgreSQL
18/RLS/provenance, deterministic fixture analysis/sparse leaderboard,
auth/workspaces, retry-safe fixture Temporal boundary. Provider
delivery, MFA/OIDC, production identity, infrastructure, and Docker-backed
integration remain open.

Implemented production checkpoint (2026-07-25): contracts, approved-policy
source gate, non-fixture collection persistence, provenance/coverage/tombstones,
private evidence/status reads, durable workflow projection, actor attribution,
retention/deletion propagation, deterministic analysis/report/plan persistence,
reviewed-seed handoff, complaint review, and plan approval/export. Migrations
`0027` through `0037` provide those boundaries; `0031` accepts the existing
`deleted:<tombstone>` URI marker. Cloud storage, purge, recomputation alerting,
explicit re-collection, and deployed scheduling remain open. No source is
approved or live.

## Validated commands

- `pnpm verify` passed 2026-08-01: packages, samples, smoke, repo checks
- 2026-08-01 ingress-admission focus: 198 contract/db/worker/web suite tests passed;
  the integration suite now contains PostgreSQL admission serialization,
  replay, rate, concurrency, and purge coverage but remains Docker-blocked
- Direct TypeScript, ESLint, Prettier, memory, and focused recomputation checks pass; the handoff
  focus passed 62, the private status focus 59, and contracts/db/worker/web suites passed 165. Seed SVG
  generated; raster awaits `cairosvg`; Temporal suites remain blocked by missing
  `protobufjs`
- `pnpm verify:persistence` and `pnpm verify:workflows` attempted on
  2026-07-25 and 2026-08-01; both are blocked by the unavailable Docker
  Desktop Linux engine pipe (`//./pipe/dockerDesktopLinuxEngine`)

## Next production tranche

1. Legal/privacy/security approval and activation of the CFPB connector policy.
2. Provision the production Temporal boundary and add Docker-backed repository/
   activity crash/retry proof for the production collection workflow.
3. Provider/identity approval, verified recovery/invitation delivery, and
   deploy/operate validated auth/source maintenance jobs.
4. Explicit re-collection after deletion and general report/export
   workflows; the current seed editor is JSON-backed and needs richer revision
   UX.
5. Operational monitoring, cost controls, production database/Temporal
   provisioning, and security review.

## Current blockers

- No real source is approved or enabled in the repository; the CFPB path is
  policy-gated and its production collection command has no active deployment.
- No production database/Temporal deployment exists. Local fixture workflow is
  not production infrastructure; identity delivery, role separation, purge,
  and deployment validation remain.
- Account recovery and invitation delivery remain disabled pending provider, identity, DPA/retention, key-rotation, monitoring, and failure-drill approval; invitations accept existing accounts only.
- Deletion propagation invalidates dependent production analysis runs and
  evidence/report/plan projections, and migration `0035` invalidates/de-ranks
  affected mutable opportunity projections; migration `0037` queues
  active-evidence recomputation, while explicit re-collection, cloud object
  storage, exports, and backup purge remain open.
- The production collection workflow is locally package-tested and PostgreSQL-
  idempotent, but no production Temporal deployment or integration proof exists;
  an optional approved-seed completion now queues analysis for a worker
  handoff. Cloud object-storage handling, recomputation alerting,
  explicit re-collection, and
  scheduled reconciliation remain open; a settled quota without a persisted
  result requires operator reconciliation.
- Production workflow admission is implemented in migration `0038` with five
  starts per 15 minutes, two active jobs, a five-minute reservation TTL, and
  bounded maintenance purge. Deployment authorization, scheduler ownership,
  and Docker-backed concurrency proof remain open.
- Migration 0029 retention selection and propagation still have only static
  assertions until the Docker-backed integration suite is available.
- Windows/macOS packaging remains open.
