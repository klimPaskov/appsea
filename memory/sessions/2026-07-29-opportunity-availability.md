# Opportunity availability repair

- Date: 2026-07-29
- Migration `0035_opportunity_availability_repair.sql` adds bounded
  `opportunities.availability_state`, `invalidated_at`, and
  `invalidation_reason` metadata with an availability guard.
- Deletion propagation now invalidates/de-ranks mutable opportunity projections
  whose completed production analysis used the deleted source record, clears
  current score/plan pointers, and preserves immutable clusters, scores, and
  lineage. It leaves an opportunity active when a newer completed active
  analysis still exists.
- A later production analysis on a new collection run reactivates the same
  opportunity. Automatic re-collection is intentionally not introduced.
- Private opportunity list/detail reads filter invalidated projections. Source
  maintenance exposes `deletionOpportunitiesInvalidated` separately from total
  affected objects.
- Focused contracts/database/worker/private-web tests passed (10 files, 95
  tests); affected TypeScript and ESLint checks passed, and Prettier formatted
  the tranche. Docker-backed migration integration remains unavailable.
