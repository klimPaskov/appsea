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
`0035_opportunity_availability_repair.sql`, and
`0036_same_run_analysis_recovery.sql`
now add the production collection
job/checkpoint projection, policy trigger, bounded policy-derived retention
tombstone enqueue, hashed idempotency, terminal reconciliation, and user/service
actor attribution;
the workflow/client/activity boundary is package-tested but not deployed. Next
is infrastructure hardening: Temporal provisioning, role separation, deletion
automatic recomputation/re-collection, non-fixture outputs, and identity-provider approval. Fixture and
production collection routes are Temporal gateways; signup workspaces remain
non-fixture by design.

The 2026-07-26 analysis checkpoint composes validated, redacted non-fixture
collection data into deterministic clusters, a seeded score, report, and coding
package. `pnpm analysis:sample` exercises a test-only offline payload; no
connector or public UI is activated. Migration `0030` and
`PostgresProductionAnalysisRepository` persist lineage, projections, and
content-addressed artifact/report/plan references with replay and deletion
invalidation. The post-collection workflow/activity, private reads, and the
separate plan approval/export boundary are package-tested. Cloud storage,
purge, and deployment proof remain open.

Foundation (2026-07-11 through 2026-07-25): PostgreSQL
18/RLS/provenance, deterministic fixture analysis/sparse leaderboard,
auth/workspaces, retry-safe fixture Temporal boundary. Provider
delivery, MFA/OIDC, production identity, infrastructure, and Docker-backed
integration remain open.

Implemented on 2026-07-25 (production collection checkpoint):

- additive production collection contracts preserve the fixture artifact
  boundary and require source/policy/request/display-mode alignment
- migration `0027_source_policy_approval_boundary.sql` creates immutable
  source-policy review evidence and exposes draft registration/approval only to
  `appsea_migrator`; runtime workers can read approved snapshots but cannot
  activate sources
- `PostgresSourcePolicyRepository` verifies stored policy hashes and derives an
  effective approved runtime policy without mutating the draft payload
- `PostgresProductionCollectionRepository` validates active non-fixture
  workspaces and approved policy snapshots, persists source/evidence/complaint
  lineage, queues deletion tombstones, records coverage gaps, and emits
  identifier-only audit/outbox completion receipts with idempotent replay
- `pnpm worker:source:policy:cfpb` is the explicit operator draft/approval
  wrapper; `pnpm worker:source:cfpb` is the bounded collection command
- private page/API reads expose source coverage and policy-allowed evidence at
  `/workspace/:workspaceId/research/:runId` and its production API route
- production collection Temporal workflow/client/activity boundaries use a
  separate PostgreSQL job/checkpoint projection, source-policy trigger,
  idempotent collection safe point, actor attribution, and workspace-bound
  status reads; no source is approved or live
- migration `0029_source_retention_enforcement.sql` queues bounded,
  policy-derived retention tombstones and reuses deletion propagation;
  purge/object storage and automatic recomputation scheduling remain open;
  migration `0035` now invalidates/de-ranks stale mutable opportunity
  projections after source deletion and `0036` permits an explicit same-run
  active-evidence re-analysis before reactivation
- production analysis contracts, normalization/deduplication/clustering,
  explicit reviewed-seed scoring, policy/evidence provenance, generic
  report/package composition, deterministic report/plan object encoding,
  idempotent post-collection persistence plus an approved-seed handoff queue,
  private active output reads, private collection handoff status, and
  non-fixture plan approval/export are implemented; cloud storage and
  recomputation remain open. Migration `0031` keeps the active plan URI contract
  strict while explicitly accepting the `deleted:<tombstone>` marker written by
  the existing source-deletion propagation path.
- migration `0032` adds editor/owner complaint review transitions and private
  collection confirm/reject actions. Migrations `0033`/`0034` add immutable
  approved seed reviews, private seed routes, and a crash-reclaimable automatic
  analysis handoff; migration `0035` repairs the mutable opportunity projection
  after source deletion and `0036` protects explicit same-run re-analysis.
  Automatic recomputation, explicit re-collection, and deployed scheduling
  remain open.

## Validated commands

- `pnpm verify` passed 2026-07-26: packages, samples, smoke, repo checks
- Direct TypeScript, ESLint, Prettier, memory, checks pass; the handoff
  focus passed 62, the private status focus 59, and contracts/db/worker/web suites passed 165. Seed SVG
  generated; raster awaits `cairosvg`; Temporal suites remain blocked by missing
  `protobufjs`
- `pnpm verify:persistence` and `pnpm verify:workflows` attempted on
  2026-07-25; both are blocked by the unavailable Docker Desktop Linux engine
  pipe (`//./pipe/dockerDesktopLinuxEngine`)

## Next production tranche

1. Legal/privacy/security approval and activation of the CFPB connector policy.
2. Provision the production Temporal boundary and add Docker-backed repository/
   activity crash/retry proof for the production collection workflow.
3. Provider/identity approval, verified recovery/invitation delivery, and
   deploy/operate validated auth/source maintenance jobs.
4. Automatic recomputation, explicit re-collection after deletion, and general report/export
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
  affected mutable opportunity projections; automatic recomputation,
  explicit re-collection, cloud object storage, exports, and backup purge remain open.
- The production collection workflow is locally package-tested and PostgreSQL-
  idempotent, but no production Temporal deployment or integration proof exists;
  an optional approved-seed completion now queues analysis for a worker
  handoff. Cloud object-storage handling, automatic recomputation,
  explicit re-collection, and
  scheduled reconciliation remain open; a settled quota without a persisted
  result requires operator reconciliation.
- Migration 0029 retention selection and propagation still have only static
  assertions until the Docker-backed integration suite is available.
- Windows/macOS packaging remains open.
