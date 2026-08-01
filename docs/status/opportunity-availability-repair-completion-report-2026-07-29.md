# Opportunity availability repair completion report

- Date: 2026-07-29
- Scope: source-deletion invalidation of mutable opportunity projections,
  private active-only reads, maintenance observability, and migration/documentation
  alignment
- Status: implemented as a production-shaped local/CI slice; PostgreSQL
  deployment, Docker-backed migration proof, source approval, and automatic
  re-collection remain open

## Behavior

- Migration `0035_opportunity_availability_repair.sql` adds an `active` or
  `invalidated` availability projection with bounded invalidation metadata.
- Deletion propagation invalidates an opportunity only when a completed
  production analysis using the deleted source record is invalidated and no
  newer completed active analysis remains. It clears current score and plan
  pointers but preserves immutable clusters, score snapshots, and lineage.
- A later completed production analysis from a new collection run, or an
  explicit reviewed re-analysis over the remaining active evidence, updates
  the same opportunity and reactivates the projection. Deletion never starts
  an unreviewed source collection.
- Private opportunity list/detail reads filter invalidated projections, so stale
  complaint counts and scores cannot remain rankable. Source maintenance reports
  the count of invalidated opportunity projections separately from total affected
  objects.
- Migration `0036_same_run_analysis_recovery.sql` allows a reviewed analysis over
  the remaining active evidence to re-cluster and reactivate the same opportunity
  after its new output is linked. It does not re-collect deleted records.
- Migration `0037_production_analysis_recompute_jobs.sql` now queues that
  active-evidence repair in the deletion transaction, preserves a blocked state
  for withdrawn seeds, and lets the durable worker dispatch only after approval.

## Validation

- Focused Vitest passed: contracts, database migration/deletion/analysis/auth
  helpers, worker maintenance/observability, and affected private web routes,
  10 files and 95 tests.
- TypeScript passed for `packages/contracts`, `packages/db`, and `apps/worker`
  after the migration and maintenance contract changes.
- ESLint and Prettier passed for the affected source/tests.
- Docker-backed PostgreSQL fresh/populated integration remains unavailable in
  this environment; the integration migration expectations now include `0036`.

## Remaining gaps

- Automatic recomputation dispatch is implemented through migration `0037` and
  the durable worker; operators can still use the private reviewed analysis
  route for an explicit repair. Deployed scheduler/alert ownership remains open.
- Re-collection requires an explicit approved source policy, collection run, and
  reviewed seed; source deletion cannot silently launch one.
- Production Temporal, object storage/backups purge, scheduler/alerts, and
  legal/privacy/security approval remain release gates.
