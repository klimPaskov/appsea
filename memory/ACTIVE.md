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
`0037_production_analysis_recompute_jobs.sql`,
`0038_production_workflow_ingress_admission.sql`, and
`0039_source_collection_leases.sql` now add the production collection
job/checkpoint projection, policy trigger, bounded policy-derived retention
tombstone enqueue, hashed idempotency, terminal reconciliation, and user/service
actor attribution, and deletion-triggered recomputation dispatch state;
the workflow/client/activity boundary is package-tested but not deployed.
Migration `0038` gates collection starts, `0039` binds external fetches to
policy leases, and `0040`/`0041` add identifier-only snapshot reconciliation.
CFPB remains disabled; deployed scheduler ownership, policy approval, and
infrastructure hardening remain open. Next: Temporal provisioning, role
separation, re-collection, non-fixture outputs, and identity-provider approval.
Fixture and production collection routes are Temporal gateways; signup workspaces remain
non-fixture by design.

Migration `0042_production_analysis_ingress_admission.sql` adds the reviewed
manual-analysis boundary. The private route binds an authenticated owner/editor,
reserves only an idempotency digest and workflow input hash before Temporal, and
the worker consumes/releases the reservation with analysis-run persistence.
Analysis runs store an immutable user/service actor; consumed or released
digests replay without another slot, while expired reservations may be
reclaimed. Source maintenance purges stale analysis admissions and reports a
bounded counter. The database-backed integration proof is present but remains
Docker-blocked in this environment.

Migration `0043_production_analysis_object_purge.sql` queues complete
artifact/report/plan refs on invalidation. The repository marks, waits for
retention, and purges with stale recovery/bounded retries; local orphan bodies
are cleaned after sidecar loss. Cloud encryption/versioning, backups, closure,
exports, and Docker integration proof remain open.

On 2026-08-01, the production analysis Temporal envelope was versioned to
`production-analysis-v2`. New starts carry only workspace, collection, analysis,
seed-review, timestamp, and digest identifiers. `apps/worker` reconstructs the
policy-validated artifact from workspace-bound rows inside the persistence
activity, preserving the no-raw-source-in-history boundary. The old v1 shape is
not accepted for new starts; legacy executions need a drain/retention plan.

Retention uses server-observed activity time rather than caller `requestedAt`,
and the repository rejects materially future timestamps. Final lineage locks
the active, current, unexpired policy, requires allowed/restricted commercial
use, and rechecks confirmed redacted evidence before linking outputs.
Collection initialization fails closed without one.

Open security follow-ups are cloud object/backup deletion verification, stale
recomputation claims, retryable tombstone propagation, and authenticated
source-CLI admission.
Collection persistence now locks and rechecks the lease in its write transaction;
these remain production-readiness blockers.

## Validated commands

- `pnpm verify` passed 2026-08-01: packages, samples, smoke, repo checks
- 2026-08-01 ingress-admission focus: 248 contract/db/workflow/worker/web suite tests passed;
  the integration suite now contains PostgreSQL admission serialization,
  replay, rate, concurrency, and purge coverage but remains Docker-blocked
- 2026-08-01 source-lease focus: contracts, db, and worker suites passed; the
  PostgreSQL lease replay/policy fixture is present but Docker-blocked
- 2026-08-01 lease-atomicity follow-up: production collection persistence now
  locks/rechecks the policy lease in the same transaction as the write; db and
  worker focused suites passed
- 2026-08-01 snapshot-reconciliation focus: migration `0041`, repository page
  checkpoints, warning-preserving retries, CFPB identifier-only traversal, and
  bounded direct/resume worker commands passed contracts/db/connectors/worker
  suites; PostgreSQL integration remains Docker-blocked
- Direct TypeScript, ESLint, Prettier, memory, and recomputation checks pass;
  the seed SVG is generated; raster awaits `cairosvg`, and Docker-backed
  Temporal suites remain blocked by the unavailable engine.
- `pnpm verify:persistence` and `pnpm verify:workflows` attempted on
  2026-07-25 and 2026-08-01; both are blocked by the unavailable Docker
  Desktop Linux engine pipe (`//./pipe/dockerDesktopLinuxEngine`)
- 2026-08-01 object-purge focus: contracts, object-store, db, and worker suites
  passed; the real PostgreSQL trigger/RLS integration test is present but
  remains Docker-blocked.

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
  not production infrastructure; identity delivery, role separation, cloud/
  backup/closure purge, and deployment validation remain.
- Account recovery and invitation delivery remain disabled pending provider, identity, DPA/retention, key-rotation, monitoring, and failure-drill approval; invitations accept existing accounts only.
- Deletion propagation invalidates dependent production analysis runs and
  evidence/report/plan projections, and migration `0035` invalidates/de-ranks
  affected mutable opportunity projections; migration `0037` queues
  active-evidence recomputation, while explicit re-collection, cloud object
  storage, exports, workspace closure, and backup purge remain open.
- The production collection workflow is locally package-tested and PostgreSQL-
  idempotent, but no production Temporal deployment or integration proof exists;
  an optional approved-seed completion now queues analysis for a worker
  handoff. Cloud object-storage handling, recomputation alerting,
  explicit re-collection, and deployed reconciliation scheduling remain open; a
  settled quota without a persisted result requires operator reconciliation.
- Production workflow admission is implemented in migration `0038` with five
  starts per 15 minutes, two active jobs, a five-minute reservation TTL, and
  bounded maintenance purge. Deployment authorization, scheduler ownership,
  and Docker-backed concurrency proof remain open.
- Migration 0029 retention selection and propagation still have only static
  assertions until the Docker-backed integration suite is available.
- Windows/macOS packaging remains open.
