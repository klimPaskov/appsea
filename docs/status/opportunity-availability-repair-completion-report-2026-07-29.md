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
  `invalidated` availability projection with bounded invalidation metadata and
  a guard that requires a new collection run before reactivation.
- Deletion propagation invalidates an opportunity only when a completed
  production analysis using the deleted source record is invalidated and no
  newer completed active analysis remains. It clears current score and plan
  pointers but preserves immutable clusters, score snapshots, and lineage.
- A later completed production analysis updates the same opportunity from its
  new collection run and reactivates the projection. Deletion never starts an
  unreviewed source collection.
- Private opportunity list/detail reads filter invalidated projections, so stale
  complaint counts and scores cannot remain rankable. Source maintenance reports
  the count of invalidated opportunity projections separately from total affected
  objects.

## Validation

- Focused Vitest passed: contracts, database migration/deletion/analysis/auth
  helpers, worker maintenance/observability, and affected private web routes,
  10 files and 95 tests.
- TypeScript passed for `packages/contracts`, `packages/db`, and `apps/worker`
  after the migration and maintenance contract changes.
- ESLint and Prettier passed for the affected source/tests.
- Docker-backed PostgreSQL fresh/populated integration remains unavailable in
  this environment; the integration migration expectations now include `0035`.

## Remaining gaps

- Complaint and cluster recomputation after deletion is still not automatic.
- Re-collection requires an explicit approved source policy, collection run, and
  reviewed seed; source deletion cannot silently launch one.
- Production Temporal, object storage/backups purge, scheduler/alerts, and
  legal/privacy/security approval remain release gates.
