# Owner-import competitive observation completion report

Date: 2026-08-05

## Delivered

- Added forward-only migrations `0102_manual_owner_import_v2.sql` and
  `0103_competitor_observation_contrary_purpose.sql`. The immutable
  `manual-owner-import-v1` snapshot remains valid for history while current
  collection uses the independently reviewed `manual-owner-import-v2`
  snapshot.
- Added private `competitor-research` and `contrary-evidence` purposes to v2.
  The policy remains owner-attested, excerpt-only, quota-bounded, tombstone-
  aware, and explicitly non-public.
- Added a stable private competitor-target projection and an evidence-linked
  observation form on the Competitors route. New claims start `unreviewed` and
  still require the existing step-up, membership, source-policy, evidence, and
  editor/owner review boundaries.
- Added migration `0104_production_analysis_competitor_lineage.sql`, which
  persists the exact confirmed observation snapshot consumed by a production
  analysis with forced-RLS lineage and both observation/evidence content hashes.
  The worker reconstructs this snapshot from PostgreSQL inside the persistence
  activity; stale review, policy, relation, deletion, or hash state fails closed.
- Enriched the private evidence-backed report and deterministic six-file plan
  with the confirmed competitive snapshot and visible coverage gaps. Claims
  from metadata-only or aggregate-only representations are withheld while
  identifiers and provenance remain inspectable. Rejection invalidates linked
  active analyses/opportunity reads; the next explicit reviewed run is required.
- Extended evidence-redaction and source-deletion invalidation joins to include
  competitive lineage, and updated contracts, tests, source-policy/runbook,
  architecture docs, current status, known gaps, plan, and project memory.
- The legacy portable `schemas/research_report.schema.json` remains unchanged:
  runtime report objects are governed by the versioned TypeScript
  `opportunityReportSchema`; the legacy snake_case schema is retained for
  historical/package compatibility and is not the persistence boundary.

## Evidence

- `pnpm --filter @appsea/contracts test` — 106 passed.
- `pnpm --filter @appsea/connectors test` — 29 passed.
- `pnpm --filter @appsea/db exec vitest run src --testTimeout=30000` — 165 passed.
- `pnpm --filter @appsea/research test` — 20 passed.
- `pnpm --filter @appsea/reports test` — 8 passed.
- `pnpm --filter @appsea/web test` — 203 passed.
- `pnpm --filter @appsea/workflows test` — 31 passed.
- `pnpm --filter @appsea/worker test` — 124 passed.
- `pnpm lint` — passed for all packages.
- Focused contracts, database, research, reports, worker, and web typechecks —
  passed.

## Remaining gates

Fresh PostgreSQL/Temporal/backup integration proof through migration `0104`
could not be rerun in this environment because Docker Desktop's
`dockerDesktopLinuxEngine` named pipe is unavailable. The migration remains
forward-only and statically covered by the database migration test; live RLS,
rejection-trigger, and deletion-propagation execution still require Docker or
hosted CI. No third-party public source was activated, this slice does not
establish public market coverage, and no automatic recompute was introduced.
